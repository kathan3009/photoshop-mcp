#!/usr/bin/env node
// photoshop-mcp — local MCP server that drives a running Photoshop (macOS).
// MCP client → this server (stdio) → osascript → Photoshop ExtendScript. Tools are defined in src/tools.mjs.
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PsError } from './src/bridge.mjs';
import { TOOLS, newSession, runTool } from './src/tools.mjs';
import { PKG } from './src/paths.mjs';

const ALLOW_EXEC = process.env.PS_MCP_ALLOW_EXEC === '1';

const INSTRUCTIONS = `You are editing the user's real Photoshop documents. Work like a careful retoucher:

1. Look first. ps_status, then ps_snapshot for structure, then ps_render to SEE the image (what it is, subject, light, mood). For color work also ps_analyze (histogram, clipping, color cast, sample skin/sky/neutrals). Zoom with ps_render crop when details matter.
2. Plan in one or two sentences before editing.
3. Edit non-destructively: adjustment layers (ps_adjustment) instead of pixel edits, smart filters (ps_filter default), masks instead of erasing, new layers instead of painting on existing ones. Group a look's layers (ps_layer_op group) so the user can toggle it.
4. To affect only part of the image: make a selection first (ps_selection subject / rect / ellipse, then feather), then create the adjustment — the selection becomes its mask.
5. Verify after each meaningful change: ps_render (and ps_analyze for tone/color). If it got worse, ps_history undo 1 — every tool call is exactly one undo step — and try different values. Don't stack bad edits.
6. Use ps_batch for multi-step builds: one round trip, one undo step, all-or-nothing.
7. Refer to layers by id. Ids are stable; names can repeat. The session stays on one document (the first one you work on, or the last you open/create/activate) even if the user clicks to another file; pass docId to target a different one.
8. Never save over the user's file unless they explicitly ask (ps_document save requires overwrite: true for that). Export copies to new paths instead. Never close documents with unsaved user work.
9. A safety checkpoint (history snapshot + disk copy of unsaved work) is taken automatically before your first edit; ps_history revert returns to it.
10. If a tool reports Photoshop is busy, a dialog is probably open — ask the user to dismiss it instead of retrying in a loop.
11. Report honestly: what you changed (with values), what you tried and undid, and anything that failed.`;

const session = newSession();
const server = new McpServer({ name: 'photoshop', version: PKG.version }, { instructions: INSTRUCTIONS });

for (const tool of TOOLS) {
  if (tool.gated && !ALLOW_EXEC) continue;
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: z.object(tool.shape).strict(),
      annotations: { readOnlyHint: !!tool.readOnly, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const { result, notes } = await runTool(tool, args, { parsed: true, session });
        const content = [];
        if (tool.name === 'ps_render') {
          const data = (await readFile(result.path)).toString('base64');
          content.push({ type: 'image', data, mimeType: result.path.endsWith('.png') ? 'image/png' : 'image/jpeg' });
        }
        content.push({ type: 'text', text: JSON.stringify(result) });
        if (notes.length) content.push({ type: 'text', text: `Notes: ${notes.join(' ')}` });
        return { content };
      } catch (err) {
        const msg = err instanceof PsError ? err.message : String(err?.stack || err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
