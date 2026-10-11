// Setup checks shared by `photoshop-mcp doctor` and `psctl doctor`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { callOp, photoshopRunning, LOG_DIR } from './bridge.mjs';
import { versionTested, TESTED_VERSIONS, CHECKPOINT_DIR } from './tools.mjs';
import { SERVER, SKILL_LINK, SKILL_SRC, CLIENT_CONFIGS, SERVER_NAME, BIN_DIR } from './paths.mjs';

const sh = (cmd, args) => { try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };

export function installedPhotoshopVersion() {
  if (!existsSync('/Applications')) return null;
  for (const d of readdirSync('/Applications').filter((x) => /^Adobe Photoshop/.test(x)).sort().reverse()) {
    const v = sh('defaults', ['read', join('/Applications', d, `${d}.app`, 'Contents/Info'), 'CFBundleShortVersionString']);
    if (v) return v;
  }
  return null;
}

// Which MCP clients point at a photoshop-mcp server right now (this checkout, or the desktop app's bundled copy).
const OURS = /photoshop-mcp[^"'\n]*server\.mjs|Photoshop MCP\.app/;
export function registrations() {
  const out = {};
  const cc = sh('claude', ['mcp', 'get', SERVER_NAME]);
  out['claude-code'] = cc && OURS.test(cc) ? (cc.includes('PS_MCP_ALLOW_EXEC=1') ? 'yes (ps_exec enabled)' : 'yes') : null;
  for (const [id, c] of Object.entries(CLIENT_CONFIGS)) {
    if (!existsSync(c.file)) { out[id] = null; continue; }
    const text = readFileSync(c.file, 'utf8');
    const m = text.match(new RegExp(`${SERVER_NAME}[\\s\\S]{0,600}`));
    out[id] = m && OURS.test(m[0]) ? 'yes' : null;
  }
  return out;
}

export async function doctor({ print = true } = {}) {
  const checks = [];
  const add = (ok, label, detail = '') => checks.push({ ok, label, detail });
  add(process.platform === 'darwin', 'macOS', process.platform);
  add(Number(process.versions.node.split('.')[0]) >= 18, 'Node 18+', process.versions.node);
  const installed = installedPhotoshopVersion();
  add(!!installed, 'Photoshop installed', installed || 'not found in /Applications');
  if (installed) add(versionTested(installed), 'Version covered by the test suite', versionTested(installed) ? installed : `${installed} — tested: ${TESTED_VERSIONS.join(', ')}; run npm test`);
  const running = await photoshopRunning();
  add(running, 'Photoshop running', running ? '' : 'launch it to use the tools');
  if (running) {
    try {
      const { result } = await callOp('status', {}, { timeoutS: 20, tool: 'doctor' });
      add(true, 'Automation permission + scripting', `Photoshop ${result.version}, ${result.documents.length} open document(s)`);
      const dirty = result.documents.filter((d) => d.unsavedChanges).map((d) => d.name);
      add(true, 'Unsaved documents', dirty.length ? dirty.join(', ') : 'none');
    } catch (e) { add(false, 'Automation permission + scripting', e.message); }
  }
  const regs = registrations();
  const any = Object.values(regs).some(Boolean);
  add(any, 'Registered with an MCP client', any
    ? Object.entries(regs).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')
    : 'run: photoshop-mcp setup');
  add(existsSync(SKILL_LINK), 'Agent skill installed', existsSync(SKILL_LINK) ? (lstatSync(SKILL_LINK).isSymbolicLink() ? 'symlink' : 'dir') : `ln -s ${SKILL_SRC} ${SKILL_LINK}`);
  const onPath = !!sh('which', ['psctl']);
  add(true, 'psctl on PATH', onPath ? sh('which', ['psctl']) : `no — add ${BIN_DIR} to PATH or run node ${join(SKILL_SRC, '..', 'cli.mjs')}`);
  add(true, 'Logs', LOG_DIR);
  add(true, 'Checkpoints', CHECKPOINT_DIR);
  if (print) for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
  return { ok: checks.every((c) => c.ok), checks };
}
