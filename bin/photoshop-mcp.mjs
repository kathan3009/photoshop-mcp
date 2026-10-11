#!/usr/bin/env node
// photoshop-mcp — one entry point for people:
//   photoshop-mcp setup [--exec] [--client claude-code,claude-desktop,cursor,codex] [--no-skill] [--no-bin]
//   photoshop-mcp doctor
//   photoshop-mcp uninstall
//   photoshop-mcp            (no arguments: run the MCP server on stdio — what the clients launch)
import { PKG } from '../src/paths.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };

const HELP = `photoshop-mcp ${PKG.version} — drive the Photoshop running on this Mac from Claude and other MCP clients.

  photoshop-mcp setup        register with Claude Code / Claude Desktop / Cursor / Codex, link the skill + psctl
      --exec                 also enable the ps_exec ExtendScript escape hatch
      --client <list>        only these clients (comma-separated; default: all that are installed)
      --no-skill --no-bin    skip the agent skill / the ~/.local/bin links
  photoshop-mcp doctor       check Photoshop, permissions and registrations
  photoshop-mcp uninstall    remove the registrations and links
  photoshop-mcp serve        run the MCP server on stdio (same as no arguments)

CLI for the same tools: psctl --help`;

try {
  if (cmd === undefined || cmd === 'serve') await import('../server.mjs');
  else if (cmd === 'setup') {
    const { setup, CLIENTS } = await import('../src/setup.mjs');
    const clients = opt('client') ? opt('client').split(',').map((s) => s.trim()) : CLIENTS;
    const bad = clients.filter((c) => !CLIENTS.includes(c));
    if (bad.length) throw new Error(`Unknown client(s): ${bad.join(', ')}. Choose from ${CLIENTS.join(', ')}.`);
    await setup({ exec: flag('exec'), clients, skill: !flag('no-skill'), bin: !flag('no-bin') });
    const { doctor } = await import('../src/doctor.mjs');
    process.exitCode = (await doctor()).ok ? 0 : 1;
  } else if (cmd === 'doctor') {
    const { doctor } = await import('../src/doctor.mjs');
    process.exitCode = (await doctor()).ok ? 0 : 1;
  } else if (cmd === 'uninstall') {
    const { uninstall } = await import('../src/setup.mjs');
    await uninstall();
  } else if (cmd === '--version' || cmd === '-v') console.log(PKG.version);
  else if (cmd === 'help' || cmd === '--help' || cmd === '-h') console.log(HELP);
  else { console.error(`Unknown command "${cmd}".\n\n${HELP}`); process.exitCode = 2; }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
