// Tests MCP startup/tool discovery without opening or editing Photoshop.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
const home = mkdtempSync(join(tmpdir(), 'photoshop-mcp-source-smoke-'));
const client = new Client({ name: 'source-smoke', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'server.mjs')], env: { HOME: home, PATH: '/usr/bin:/bin', PS_MCP_LOG: 'off' } });
const timer = setTimeout(() => { transport.close().catch(() => {}); }, 15000);
try {
  await client.connect(transport);
  if (client.getServerVersion()?.version !== pkg.version) throw new Error('Server version mismatch');
  const { tools } = await client.listTools();
  for (const name of ['ps_status', 'ps_render', 'ps_document', 'ps_history']) {
    if (!tools.some((tool) => tool.name === name)) throw new Error(`Missing ${name}`);
  }
  console.log(`Source MCP handshake passed: version ${pkg.version}, ${tools.length} tools.`);
} finally {
  clearTimeout(timer);
  await client.close();
  rmSync(home, { recursive: true, force: true });
}
