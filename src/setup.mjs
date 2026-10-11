// `photoshop-mcp setup` / `uninstall`: register the server with the MCP clients on this Mac, link the agent
// skill and the CLI. Edits to config files are minimal (one key) and a .bak copy is kept.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, symlinkSync, unlinkSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, SERVER, CLI, SKILL_SRC, SKILL_LINK, BIN_DIR, CLIENT_CONFIGS, SERVER_NAME } from './paths.mjs';

// GUI apps (Claude Desktop, Cursor) don't see nvm/brew PATH entries, so configs need an absolute node path.
// Prefer a stable symlink (/opt/homebrew/bin/node) over the versioned binary it points at, which changes on upgrade.
function nodeBinary() {
  const real = (p) => { try { return realpathSync(p); } catch { return null; } };
  const mine = real(process.execPath);
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node', process.env.NVM_SYMLINK_CURRENT && join(process.env.NVM_SYMLINK_CURRENT, 'bin/node')].filter(Boolean)) {
    if (real(p) === mine) return p;
  }
  return process.execPath;
}
const NODE = nodeBinary();
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

export function serverEntry(exec) {
  const entry = { command: NODE, args: [SERVER] };
  if (exec) entry.env = { PS_MCP_ALLOW_EXEC: '1' };
  return entry;
}

function backup(file) { if (existsSync(file)) copyFileSync(file, `${file}.bak`); }

// ---- per-client registration (each returns a one-line status)

function claudeCode(exec, remove) {
  if (!has('claude')) return remove ? null : 'Claude Code CLI not found — skipped (install from https://claude.com/claude-code, then re-run setup)';
  try { run('claude', ['mcp', 'remove', SERVER_NAME, '-s', 'user']); } catch {}
  if (remove) return 'removed';
  const args = ['mcp', 'add', SERVER_NAME, '--scope', 'user'];
  if (exec) args.push('-e', 'PS_MCP_ALLOW_EXEC=1');
  run('claude', [...args, '--', NODE, SERVER]);
  return 'registered (user scope)';
}

function jsonClient(id, exec, remove) {
  const c = CLIENT_CONFIGS[id];
  const present = existsSync(c.file) || (c.app && existsSync(c.app));
  if (!present) return remove ? null : `${c.label} not installed — skipped`;
  let cfg = {};
  if (existsSync(c.file)) {
    try { cfg = JSON.parse(readFileSync(c.file, 'utf8') || '{}'); }
    catch { return `${c.label}: ${c.file} is not valid JSON — left alone. Add this manually: ${JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry(exec) } })}`; }
  }
  cfg.mcpServers = cfg.mcpServers || {};
  if (remove) {
    if (!cfg.mcpServers[SERVER_NAME]) return null;
    delete cfg.mcpServers[SERVER_NAME];
  } else cfg.mcpServers[SERVER_NAME] = serverEntry(exec);
  mkdirSync(dirname(c.file), { recursive: true });
  backup(c.file);
  writeFileSync(c.file, JSON.stringify(cfg, null, 2) + '\n');
  return remove ? 'removed' : `registered in ${c.file} (restart ${c.label})`;
}

function codex(exec, remove) {
  const c = CLIENT_CONFIGS.codex;
  if (!existsSync(dirname(c.file))) return remove ? null : 'Codex CLI not installed — skipped';
  const text = existsSync(c.file) ? readFileSync(c.file, 'utf8') : '';
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const block = `${header}\ncommand = ${JSON.stringify(NODE)}\nargs = [${JSON.stringify(SERVER)}]\n${exec ? `\n[mcp_servers.${SERVER_NAME}.env]\nPS_MCP_ALLOW_EXEC = "1"\n` : ''}`;
  // Replace our own block (from a previous setup) and nothing else.
  const re = new RegExp(`\\n?\\[mcp_servers\\.${SERVER_NAME}\\][\\s\\S]*?(?=\\n\\[(?!mcp_servers\\.${SERVER_NAME}\\.)|$)`, 'g');
  const stripped = text.replace(re, '').replace(/\n{3,}/g, '\n\n');
  if (remove) {
    if (stripped === text) return null;
    backup(c.file); writeFileSync(c.file, stripped);
    return 'removed';
  }
  backup(c.file);
  writeFileSync(c.file, `${stripped.replace(/\s*$/, '')}\n\n${block}`);
  return `registered in ${c.file}`;
}

// ---- skill + CLI links

function link(target, at) {
  mkdirSync(dirname(at), { recursive: true });
  if (existsSync(at) || isLink(at)) {
    if (!isLink(at)) return `${at} exists and is not a symlink — left alone`;
    unlinkSync(at);
  }
  symlinkSync(target, at);
  return `linked ${at} → ${target}`;
}
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
function unlink(at, target) {
  if (!isLink(at)) return null;
  if (readlinkSync(at) !== target) return null;   // someone else's link
  unlinkSync(at);
  return `removed ${at}`;
}

export const CLIENTS = ['claude-code', 'claude-desktop', 'cursor', 'codex'];

export async function setup({ exec = false, clients = CLIENTS, skill = true, bin = true, log = console.log } = {}) {
  if (process.platform !== 'darwin') throw new Error('photoshop-mcp runs on macOS only (it drives Photoshop over AppleScript).');
  log(`photoshop-mcp setup — server: ${SERVER}${exec ? ' (ps_exec enabled)' : ''}\n`);
  const report = (label, status) => { if (status) log(`• ${label}: ${status}`); };
  for (const id of clients) {
    if (id === 'claude-code') report('Claude Code', claudeCode(exec, false));
    else if (id === 'codex') report('Codex CLI', codex(exec, false));
    else report(CLIENT_CONFIGS[id].label, jsonClient(id, exec, false));
  }
  if (skill) report('Agent skill', link(SKILL_SRC, SKILL_LINK));
  if (bin) {
    report('psctl', link(CLI, join(BIN_DIR, 'psctl')));
    report('photoshop-mcp', link(join(ROOT, 'bin/photoshop-mcp.mjs'), join(BIN_DIR, 'photoshop-mcp')));
    if (!(process.env.PATH || '').split(':').includes(BIN_DIR)) log(`  add to your shell profile: export PATH="${BIN_DIR}:$PATH"`);
  }
  log(`\nFor any other MCP client, add:\n${JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry(exec) } }, null, 2)}\n`);
  log('Next: open Photoshop, then ask your agent to "run ps_status". macOS will ask once to allow controlling Photoshop — allow it.\n');
}

export async function uninstall({ log = console.log } = {}) {
  const report = (label, status) => { if (status) log(`• ${label}: ${status}`); };
  report('Claude Code', claudeCode(false, true));
  report('Claude Desktop', jsonClient('claude-desktop', false, true));
  report('Cursor', jsonClient('cursor', false, true));
  report('Codex CLI', codex(false, true));
  report('Agent skill', unlink(SKILL_LINK, SKILL_SRC));
  report('psctl', unlink(join(BIN_DIR, 'psctl'), CLI));
  report('photoshop-mcp', unlink(join(BIN_DIR, 'photoshop-mcp'), join(ROOT, 'bin/photoshop-mcp.mjs')));
  log('Done. Logs and checkpoints under ~/Library were left in place.');
}
