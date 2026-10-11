// Bridge: Node → osascript → Photoshop ExtendScript. Shared by the MCP server and the psctl CLI.
import { execFile } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LIB = ['prelude.jsx', 'ops.jsx']
  .map((f) => readFileSync(new URL(`../jsx/${f}`, import.meta.url), 'utf8'))
  .join('\n');

export const DEFAULT_TIMEOUT_S = Number(process.env.PS_MCP_TIMEOUT_S || 120);
export const LOG_DIR = process.env.PS_MCP_LOG_DIR || join(homedir(), 'Library/Logs/photoshop-mcp');

export class PsError extends Error {
  constructor(message, code = 'photoshop_error') {
    super(message);
    this.code = code;
  }
}

const applescript = (timeoutS) => [
  'on run argv',
  `with timeout of ${timeoutS} seconds`,
  'tell application id "com.adobe.Photoshop" to do javascript (item 1 of argv)',
  'end timeout',
  'end run',
];

// JSON is a valid ES3 literal except for raw U+2028/2029, which ES3 treats as line breaks.
const jsLiteral = (v) => JSON.stringify(v ?? {}).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

// Ops that switch, create or close documents manage the active document themselves.
const DOC_CHANGING = new Set(['document']);

function buildScript(op, args, docId) {
  return `${LIB}
(function () {
  var prefs = app.preferences, ru = prefs.rulerUnits, tu = prefs.typeUnits, dd = app.displayDialogs;
  var prevDoc = null, acted = null;
  prefs.rulerUnits = Units.PIXELS; prefs.typeUnits = TypeUnits.PIXELS; app.displayDialogs = DialogModes.NO;
  try {
    var fn = __ops[${JSON.stringify(op)}];
    if (!fn) throw new Error('Unknown op: ' + ${JSON.stringify(op)});
    var target = ${docId == null ? 'null' : Number(docId)};
    if (target !== null) {
      var t = null;
      for (var i = 0; i < app.documents.length; i++) if (app.documents[i].id === target) t = app.documents[i];
      if (!t) return __j({ ok: false, code: 'document_closed', error: 'The document this session was working on (id ' + target + ') is no longer open. Call ps_status, then ps_document {action: "activate", docId} to choose one.' });
      if (app.activeDocument.id !== target) { prevDoc = app.activeDocument; app.activeDocument = t; }
    }
    if (app.documents.length) acted = app.activeDocument.id;
    var result = fn(${jsLiteral(args)});
    var after = app.documents.length ? app.activeDocument.id : null;
    return __j({ ok: true, result: result, doc: ${DOC_CHANGING.has(op) ? 'after' : 'acted'} });
  } catch (e) {
    return __j({ ok: false, error: __errMsg(e), line: e.line, doc: acted });
  } finally {
    prefs.rulerUnits = ru; prefs.typeUnits = tu; app.displayDialogs = dd;
    // Put the user's view back on the document they were looking at.
    ${DOC_CHANGING.has(op) ? '' : 'if (prevDoc) { try { app.activeDocument = prevDoc; } catch (ignore) {} }'}
  }
})();`;
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr) }));
      else resolve(String(stdout));
    });
  });
}

export async function photoshopRunning() {
  try {
    await run('pgrep', ['-f', 'Adobe Photoshop[^/]*\\.app/Contents/MacOS/Adobe Photoshop'], 5000);
    return true;
  } catch {
    return false;
  }
}

async function responsive() {
  try {
    await run('osascript', ['-e', 'with timeout of 4 seconds', '-e', 'tell application id "com.adobe.Photoshop" to do javascript "1"', '-e', 'end timeout'], 6000);
    return true;
  } catch {
    return false;
  }
}

// Photoshop's own messages say what failed but not why; add the usual causes.
function explain(msg) {
  let m = msg;
  const na = m.match(/The command “([^”]+)” is not currently available/);
  if (na) m += ` — Photoshop refuses "${na[1]}" in the current state. Common causes: the target layer is the wrong type (e.g. text/shape/adjustment instead of pixel), hidden, locked, empty, or a mask/channel is targeted. Check the layer with ps_snapshot / ps_inspect.`;
  else if (/parameters for command “[^”]+” are not currently valid/.test(m)) m += ' — the command ran but rejected its inputs for this document/layer (wrong mode, empty area, or nothing to act on).';
  else if (/no additional information available|^-?\d+$/.test(m)) m += ' — Photoshop rejected the command without details; the target document/layer state usually does not allow it.';
  return m;
}

// ---------------------------------------------------------------- logging

let pruned = false;
function log(entry) {
  if (process.env.PS_MCP_LOG === 'off') return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(LOG_DIR, `${day}.jsonl`), JSON.stringify(entry) + '\n');
    if (!pruned) {
      pruned = true;
      const cutoff = Date.now() - 14 * 864e5;
      for (const f of readdirSync(LOG_DIR)) if (f.endsWith('.jsonl') && statSync(join(LOG_DIR, f)).mtimeMs < cutoff) unlinkSync(join(LOG_DIR, f));
    }
  } catch {}
}

// Files a call produced, so the desktop app can show renders and exports in its gallery.
const fileOf = (op, r) => (op === 'render' && r?.path ? { file: r.path, kind: 'render' } : op === 'document' && r?.saved ? { file: r.saved, kind: 'export' } : {});

const summarize = (args) => {
  const s = JSON.stringify(args ?? {}, (k, v) => (k === 'code' && typeof v === 'string' ? `<${v.length} chars>` : v));
  return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
};

// ---------------------------------------------------------------- calls

// Photoshop executes one script at a time; serialize every call.
let queue = Promise.resolve();
function enqueue(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

/**
 * Run a named op from jsx/ops.jsx inside Photoshop.
 * @returns {{result:any, doc:number|null}} result plus the id of the document it acted on.
 */
export function callOp(op, args, { docId = null, timeoutS = DEFAULT_TIMEOUT_S, tool = op, quiet = false } = {}) {
  return enqueue(async () => {
    const started = Date.now();
    const finish = (entry) => { if (!quiet) log({ ts: new Date(started).toISOString(), tool, op, docId, args: summarize(args), ms: Date.now() - started, ...entry }); };
    try {
      if (process.platform !== 'darwin') throw new PsError('photoshop-mcp currently supports macOS only.', 'unsupported_platform');
      if (!(await photoshopRunning())) throw new PsError('Photoshop is not running. Launch Photoshop and retry.', 'not_running');
      let out;
      try {
        out = await run('osascript', [...applescript(timeoutS).flatMap((l) => ['-e', l]), buildScript(op, args, docId)], (timeoutS + 10) * 1000);
      } catch (err) {
        const msg = err.stderr || err.message;
        if (/-1712|timed out/i.test(msg) || err.killed) {
          const alive = await responsive();
          throw new PsError(alive
            ? `Photoshop took longer than ${timeoutS}s for ${tool}. The operation may still finish; check ps_status before retrying.`
            : 'Photoshop is not responding — most likely a dialog is open or a long operation is running. Ask the user to dismiss any Photoshop dialog, then retry.', 'busy');
        }
        if (/-1743|not allowed/i.test(msg)) throw new PsError('macOS blocked automation. Allow this app to control Photoshop in System Settings → Privacy & Security → Automation.', 'automation_denied');
        if (/-609|-600|Connection is invalid|isn’t running/i.test(msg)) throw new PsError('Lost the connection to Photoshop — it quit or crashed. Relaunch Photoshop; unsaved work may be in its recovery files and in ~/Library/Application Support/photoshop-mcp/checkpoints.', 'connection_lost');
        throw new PsError(`osascript failed: ${msg.trim()}`, 'osascript_failed');
      }
      let parsed;
      try {
        parsed = JSON.parse(out.trim());
      } catch {
        throw new PsError(`Unexpected output from Photoshop: ${out.slice(0, 500)}`, 'bad_output');
      }
      if (!parsed.ok) throw new PsError(explain(parsed.error), parsed.code || 'photoshop_error');
      finish({ ok: true, doc: parsed.doc, ...(fileOf(op, parsed.result)) });
      return { result: parsed.result, doc: parsed.doc ?? null };
    } catch (err) {
      finish({ ok: false, code: err.code, error: String(err.message).slice(0, 1000) });
      throw err;
    }
  });
}
