#!/usr/bin/env node
// psctl — the same Photoshop tools as the MCP server, from a shell. Built for coding agents:
//   psctl status
//   psctl snapshot depth=2
//   psctl render out=/tmp/look.jpg maxSize=800
//   psctl set_layers layer=12 opacity=60
//   psctl batch @grade.json            (args from a file)
//   psctl run fix.jsx [docId=N]        (ExtendScript file, one undo step)
//   psctl checkpoint                   (safety snapshot + disk copy of unsaved work)
//   psctl doctor                       (check the setup)
//   psctl help adjustment              (schema + description)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { PsError, callOp } from './src/bridge.mjs';
import { TOOLS, getTool, runTool, newSession, CHECKPOINT_DIR } from './src/tools.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const SESSION_FILE = join(homedir(), 'Library/Caches/photoshop-mcp/cli-session.json');

function psPid() {
  try { return execFileSync('pgrep', ['-f', 'Adobe Photoshop[^/]*\\.app/Contents/MacOS/Adobe Photoshop']).toString().trim().split('\n')[0]; } catch { return null; }
}

// Checkpoints are once per document per Photoshop run; remember which docs are covered between CLI calls.
function loadSession() {
  let saved = {};
  try { saved = JSON.parse(readFileSync(SESSION_FILE, 'utf8')); } catch {}
  const pid = psPid();
  const same = saved.pid === pid;
  return { session: newSession({ checkpointed: same ? saved.checkpointed || [] : [], exports: same ? saved.exports || [] : [] }), pid };
}
function saveSession({ session, pid }) {
  try {
    mkdirSync(dirname(SESSION_FILE), { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify({ pid, checkpointed: [...session.checkpointed], exports: [...session.exports] }));
  } catch {}
}

function parseArgs(parts) {
  if (!parts.length) return {};
  if (parts.length === 1 && /^\s*[{[]/.test(parts[0])) return JSON.parse(parts[0]);
  if (parts.length === 1 && parts[0].startsWith('@')) return JSON.parse(readFileSync(parts[0].slice(1), 'utf8'));
  if (parts.length === 1 && parts[0] === '-') return JSON.parse(readFileSync(0, 'utf8'));
  const out = {};
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 1) throw new PsError(`Expected key=value, JSON, @file or -, got "${p}"`);
    const k = p.slice(0, i), v = p.slice(i + 1);
    try { out[k] = JSON.parse(v); } catch { out[k] = v; }
  }
  return out;
}

function usage() {
  const lines = TOOLS.map((t) => `  ${t.name.replace(/^ps_/, '').padEnd(14)} ${t.description.split('. ')[0]}`);
  console.log(`psctl <tool> [key=value ... | '<json>' | @file.json | -]
  run <file.jsx> [docId=N]  Run an ExtendScript file as one undo step
  checkpoint [docId=N]      Safety snapshot + disk copy of unsaved work
  doctor                    Check the setup
  help <tool>               Show a tool's arguments

${lines.join('\n')}`);
}

const print = ({ result, notes }) => {
  console.log(JSON.stringify(result, null, 2));
  for (const n of notes || []) console.error(`note: ${n}`);
};

try {
  if (!cmd || cmd === '--help' || cmd === '-h') usage();
  else if (cmd === 'doctor') {
    const { doctor } = await import('./src/doctor.mjs');
    process.exitCode = (await doctor()) ? 0 : 1;
  } else if (cmd === 'help') {
    const t = getTool(rest[0] || '');
    if (!t) usage();
    else console.log(`${t.name}: ${t.description}\n\n${JSON.stringify(z.toJSONSchema(z.object(t.shape)), null, 2)}`);
  } else if (cmd === 'checkpoint') {
    const { docId } = parseArgs(rest);
    const { result } = await callOp('checkpoint', { dir: CHECKPOINT_DIR, history: true, disk: true }, { docId: docId ?? null, timeoutS: 900, tool: 'checkpoint' });
    console.log(JSON.stringify(result, null, 2));
  } else {
    let t, args;
    if (cmd === 'run') {
      if (!rest[0]) throw new PsError('Usage: psctl run <file.jsx> [docId=N]');
      t = getTool('exec');
      args = { ...parseArgs(rest.slice(1)), code: readFileSync(rest[0], 'utf8'), label: `script ${rest[0]}` };
    } else {
      t = getTool(cmd);
      if (!t) throw new PsError(`Unknown tool "${cmd}". Run psctl --help.`);
      args = parseArgs(rest);
    }
    const state = loadSession();
    try { print(await runTool(t, args, { session: state.session })); }
    finally { saveSession(state); }
  }
} catch (err) {
  console.error(err instanceof PsError || err instanceof SyntaxError ? `error: ${err.message}` : err);
  process.exit(1);
}
