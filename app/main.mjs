// Photoshop MCP desktop app: bundles the server (so nobody installs Node), connects it to MCP clients with
// one click, and shows what the agent is doing in Photoshop — live activity, renders, exports, checkpoints —
// with a pause switch and undo/revert buttons. The server itself is the same code as the CLI/MCP package.
import { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, clipboard } from 'electron';
import { existsSync, readFileSync, readdirSync, statSync, watch, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = app.isPackaged ? join(process.resourcesPath, 'server') : join(HERE, '..');
const APP_SUPPORT = join(homedir(), 'Library/Application Support/photoshop-mcp');
const RENDERS = join(APP_SUPPORT, 'renders');
const SETTINGS = join(APP_SUPPORT, 'app-settings.json');
mkdirSync(RENDERS, { recursive: true });

// GUI apps start with a bare PATH; the server's doctor shells out to `claude`, and users have node in brew/nvm dirs.
const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin'), join(homedir(), '.npm-global/bin')];
try { for (const v of readdirSync(join(homedir(), '.nvm/versions/node'))) extra.push(join(homedir(), '.nvm/versions/node', v, 'bin')); } catch {}
process.env.PATH = [...extra, ...(process.env.PATH || '').split(':')].filter(Boolean).join(':');
process.env.PS_MCP_RENDER_DIR = RENDERS;   // must be set before tools.mjs is imported

const bridge = await import(pathToFileURL(join(SERVER_DIR, 'src/bridge.mjs')));
const tools = await import(pathToFileURL(join(SERVER_DIR, 'src/tools.mjs')));
const setup = await import(pathToFileURL(join(SERVER_DIR, 'src/setup.mjs')));
const doctor = await import(pathToFileURL(join(SERVER_DIR, 'src/doctor.mjs')));
const PKG = JSON.parse(readFileSync(join(SERVER_DIR, 'package.json'), 'utf8'));

// MCP clients launch the server through this very app binary running as Node — no separate Node install.
setup.useRuntime({ command: process.execPath, args: [join(SERVER_DIR, 'server.mjs')], env: { ELECTRON_RUN_AS_NODE: '1', PS_MCP_RENDER_DIR: RENDERS } });

const CLIENT_LABELS = { 'claude-code': 'Claude Code', 'claude-desktop': 'Claude Desktop', cursor: 'Cursor', codex: 'Codex CLI' };

// ---------------------------------------------------------------- settings

const readSettings = () => { try { return JSON.parse(readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
const writeSettings = (s) => writeFileSync(SETTINGS, JSON.stringify(s, null, 2));

// ---------------------------------------------------------------- data for the UI

const listFiles = (dir, pattern) => {
  try {
    return readdirSync(dir).filter((f) => pattern.test(f)).map((f) => {
      const p = join(dir, f), st = statSync(p);
      return { path: p, name: f, mtime: st.mtimeMs, size: st.size };
    }).sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
};

function activity(limit = 400) {
  const out = [];
  const days = listFiles(bridge.LOG_DIR, /\.jsonl$/).slice(0, 3);
  for (const d of days) {
    const lines = readFileSync(d.path, 'utf8').trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try { const e = JSON.parse(lines[i]); if (e.file && !existsSync(e.file)) delete e.file; out.push(e); } catch {}
    }
    if (out.length >= limit) break;
  }
  return out;
}

function gallery() {
  const renders = listFiles(RENDERS, /\.(jpg|png)$/i).slice(0, 120).map((f) => ({ ...f, kind: 'render' }));
  const seen = new Set();
  const exports = [];
  for (const e of activity(1000)) {
    if (e.kind === 'export' && e.file && !seen.has(e.file) && /\.(jpe?g|png)$/i.test(e.file)) {
      seen.add(e.file);
      try { const st = statSync(e.file); exports.push({ path: e.file, name: basename(e.file), mtime: st.mtimeMs, size: st.size, kind: 'export' }); } catch {}
    }
  }
  return { renders, exports };
}

async function photoshopState() {
  const running = await bridge.photoshopRunning();
  if (!running) return { running: false };
  try {
    const { result } = await bridge.callOp('status', {}, { timeoutS: 15, tool: 'app', quiet: true });
    return { running: true, version: result.version, documents: result.documents, active: result.activeDocument ? { name: result.activeDocument.name, width: result.activeDocument.width, height: result.activeDocument.height, history: result.activeDocument.history } : null };
  } catch (e) { return { running: true, error: e.message, code: e.code }; }
}

function photoshopApp() {
  try { return readdirSync('/Applications').filter((d) => /^Adobe Photoshop/.test(d)).sort().reverse().map((d) => join('/Applications', d, `${d}.app`)).find(existsSync) || null; } catch { return null; }
}

// ---------------------------------------------------------------- IPC

ipcMain.handle('state', async () => ({
  version: PKG.version,
  packaged: app.isPackaged,
  serverPath: join(SERVER_DIR, 'server.mjs'),
  photoshop: await photoshopState(),
  registrations: doctor.registrations(),
  paused: existsSync(tools.PAUSE_FILE),
  settings: { exec: false, openAtLogin: app.getLoginItemSettings().openAtLogin, ...readSettings() },
  clients: CLIENT_LABELS,
}));
ipcMain.handle('connect', (_e, id) => {
  const exec = !!readSettings().exec;
  const status = setup.connect(id, exec);
  if (id === 'claude-code') setup.setup({ clients: [], skill: true, bin: false, log: () => {} }).catch(() => {});
  return status || `${CLIENT_LABELS[id]} is not installed on this Mac`;
});
ipcMain.handle('disconnect', (_e, id) => setup.disconnect(id) || 'was not connected');
ipcMain.handle('copyJson', () => { const j = JSON.stringify({ mcpServers: { photoshop: setup.serverEntry(!!readSettings().exec) } }, null, 2); clipboard.writeText(j); return j; });
ipcMain.handle('doctor', () => doctor.doctor({ print: false }));
ipcMain.handle('activity', (_e, limit) => activity(limit));
ipcMain.handle('gallery', () => gallery());
ipcMain.handle('checkpoints', () => listFiles(tools.CHECKPOINT_DIR, /\.ps[db]$/));
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open', (_e, p) => shell.openPath(p));
ipcMain.handle('openExternal', (_e, u) => shell.openExternal(u));
ipcMain.handle('openPhotoshop', () => { const p = photoshopApp(); return p ? shell.openPath(p) : 'Photoshop not found in /Applications'; });
ipcMain.handle('pause', (_e, on) => { if (on) writeFileSync(tools.PAUSE_FILE, new Date().toISOString()); else if (existsSync(tools.PAUSE_FILE)) unlinkSync(tools.PAUSE_FILE); updateTray(); return on; });
ipcMain.handle('history', async (_e, action) => { const { result } = await bridge.callOp('history', { action, steps: 1 }, { timeoutS: 60, tool: 'app' }); return result; });
ipcMain.handle('settings', (_e, patch) => {
  const s = { ...readSettings(), ...patch };
  writeSettings(s);
  if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin, openAsHidden: true });
  return s;
});

// ---------------------------------------------------------------- window + tray

let win = null, tray = null, quitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 740, minWidth: 900, minHeight: 600, show: false,
    titleBarStyle: 'hiddenInset', backgroundColor: '#0e1016',
    webPreferences: { preload: join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  // --screenshot=/path.png [--tab=name]: capture the window for docs and quit (used by the build). Attached
  // before loadFile — in the packaged app the page can finish loading before whenReady's work is done.
  const shot = process.argv.find((a) => a.startsWith('--screenshot='));
  if (shot) {
    const tab = (process.argv.find((a) => a.startsWith('--tab=')) || '--tab=overview').slice(6);
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('ui:tab', tab);
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        writeFileSync(shot.slice(13), img.toPNG());
        quitting = true; app.quit();
      }, 3500);
    });
  }
  win.loadFile(join(HERE, 'renderer/index.html'));
  win.once('ready-to-show', () => { if (!process.argv.some((a) => a === '--hidden')) win.show(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // Push log changes to the renderer (debounced).
  let timer = null;
  try { watch(bridge.LOG_DIR, () => { clearTimeout(timer); timer = setTimeout(() => win?.webContents.send('activity:changed'), 300); }); } catch {}
  try { watch(RENDERS, () => { clearTimeout(timer); timer = setTimeout(() => win?.webContents.send('activity:changed'), 300); }); } catch {}
}

function updateTray() {
  if (!tray) return;
  const paused = existsSync(tools.PAUSE_FILE);
  tray.setToolTip(`Photoshop MCP${paused ? ' — edits paused' : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Photoshop MCP', click: () => { win?.show(); win?.focus(); } },
    { label: paused ? 'Resume edits' : 'Pause edits (kill switch)', click: () => { if (paused) unlinkSync(tools.PAUSE_FILE); else writeFileSync(tools.PAUSE_FILE, new Date().toISOString()); updateTray(); win?.webContents.send('activity:changed'); } },
    { type: 'separator' },
    { label: `Version ${PKG.version}`, enabled: false },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

app.whenReady().then(() => {
  mkdirSync(bridge.LOG_DIR, { recursive: true });
  createWindow();
  const icon = nativeImage.createFromPath(join(HERE, 'build/trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on('click', () => { win?.show(); win?.focus(); });
  updateTray();
});
app.on('activate', () => { win?.show(); });
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {});   // keep running in the menu bar
