const $ = (s) => document.querySelector(s);
const api = window.psmcp;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const when = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

let state = null;

// ---------------------------------------------------------------- tabs
function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'activity') loadActivity();
  if (name === 'gallery') loadGallery();
  if (name === 'checkpoints') loadCheckpoints();
  if (name === 'doctor') loadDoctor();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
api.onTab((t) => showTab(t));

// ---------------------------------------------------------------- overview / status
async function refreshState() {
  state = await api.state();
  $('#version').textContent = `v${state.version}${state.packaged ? '' : ' (dev)'}`;
  const ps = state.photoshop, dot = $('#ps-dot');
  dot.className = 'status-dot ' + (!ps.running ? 'bad' : ps.error ? 'warn' : 'ok');
  $('#ps-short').textContent = !ps.running ? 'Photoshop not running' : ps.error ? 'Photoshop busy' : `Photoshop ${ps.version}`;
  $('#ps-line').innerHTML = !ps.running
    ? 'Photoshop is not running — <a href="#" id="lnk-open-ps">open it</a>'
    : ps.error ? `Photoshop ${esc(ps.version || '')} — ${esc(ps.error)}`
    : ps.active ? `Photoshop ${esc(ps.version)} · ${esc(ps.active.name)} ${ps.active.width}×${ps.active.height} · ${ps.documents.length} open` : `Photoshop ${esc(ps.version)} · no document open`;
  $('#lnk-open-ps')?.addEventListener('click', (e) => { e.preventDefault(); api.openPhotoshop(); });
  const canEdit = ps.running && !ps.error && ps.active;
  $('#btn-undo').disabled = !canEdit; $('#btn-revert').disabled = !canEdit;
  $('#btn-pause').classList.toggle('on', state.paused);
  $('#btn-pause').textContent = state.paused ? 'Edits paused — resume' : 'Pause edits';
  $('#exec').checked = !!state.settings.exec;
  $('#login').checked = !!state.settings.openAtLogin;
  $('#server-path').textContent = `Server: ${state.serverPath}`;
  renderClients();
}

function renderClients() {
  const box = $('#clients'); box.innerHTML = '';
  for (const [id, label] of Object.entries(state.clients)) {
    const reg = state.registrations[id];
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<div class="name">${esc(label)} <span class="badge ${reg ? 'ok' : ''}">${reg ? 'connected' : 'not connected'}</span></div>
      <div class="state">${reg ? esc(reg) : hint(id)}</div>
      <div class="row"><button class="btn ${reg ? '' : 'primary'}" data-act="connect">${reg ? 'Reconnect' : 'Connect'}</button>${reg ? '<button class="btn" data-act="disconnect">Disconnect</button>' : ''}</div>`;
    card.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = '…';
      const msg = await (b.dataset.act === 'connect' ? api.connect(id) : api.disconnect(id));
      await refreshState();
      const c = [...box.children].find((x) => x.querySelector('.name').textContent.startsWith(label));
      if (c) c.querySelector('.state').textContent = msg;
    }));
    box.appendChild(card);
  }
}
const hint = (id) => ({ 'claude-code': 'Registers with the claude CLI (user scope).', 'claude-desktop': 'Adds to claude_desktop_config.json; restart Claude Desktop.', cursor: 'Adds to ~/.cursor/mcp.json; restart Cursor.', codex: 'Adds to ~/.codex/config.toml.' }[id]);

$('#btn-pause').addEventListener('click', async () => { await api.pause(!state.paused); refreshState(); });
$('#btn-undo').addEventListener('click', async () => { try { const r = await api.history('undo'); toast(`Undid: ${r.from}`); } catch (e) { toast(e.message, true); } refreshState(); });
$('#btn-revert').addEventListener('click', async () => { try { const r = await api.history('revert'); toast(`Reverted to ${r.revertedTo}`); } catch (e) { toast(e.message, true); } refreshState(); });
$('#btn-json').addEventListener('click', async () => { await api.copyJson(); toast('Copied the mcpServers JSON to the clipboard'); });
$('#btn-open-ps').addEventListener('click', () => api.openPhotoshop());
$('#exec').addEventListener('change', async (e) => { await api.settings({ exec: e.target.checked }); toast('Reconnect a client to apply'); });
$('#login').addEventListener('change', (e) => api.settings({ openAtLogin: e.target.checked }));

// ---------------------------------------------------------------- activity
let entries = [];
async function loadActivity() {
  entries = await api.activity(400);
  $('#activity-count').textContent = entries.filter((e) => e.ts.slice(0, 10) === new Date().toISOString().slice(0, 10)).length || '';
  drawActivity();
}
function drawActivity() {
  const q = $('#filter').value.toLowerCase();
  const list = $('#activity'); list.innerHTML = '';
  const rows = entries.filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q));
  if (!rows.length) { list.innerHTML = '<div class="empty">No activity yet. Ask your agent to run <code>ps_status</code>.</div>'; return; }
  for (const e of rows) {
    const d = document.createElement('div'); d.className = 'item' + (e.ok ? '' : ' err');
    d.innerHTML = `<span class="t">${time(e.ts)}</span><span class="tool">${esc(e.tool)}</span><span class="args" title="${esc(e.args)}">${esc(e.ok ? e.args : e.error)}</span><span class="ms">${e.ms} ms ${e.file ? `<button class="btn">${e.kind === 'export' ? 'Reveal' : 'View'}</button>` : ''}</span>`;
    if (e.file) d.querySelector('button').addEventListener('click', () => (e.kind === 'export' ? api.reveal(e.file) : api.open(e.file)));
    list.appendChild(d);
  }
}
$('#filter').addEventListener('input', drawActivity);

// ---------------------------------------------------------------- gallery
async function loadGallery() {
  const g = await api.gallery();
  const draw = (sel, files, empty) => {
    const box = $(sel); box.innerHTML = '';
    if (!files.length) { box.innerHTML = `<div class="empty">${empty}</div>`; return; }
    for (const f of files) {
      const t = document.createElement('div'); t.className = 'thumb';
      t.innerHTML = `<img src="file://${encodeURI(f.path)}" loading="lazy"><div class="cap"><b title="${esc(f.path)}">${esc(f.name)}</b><span>${when(f.mtime)}</span></div>`;
      t.addEventListener('click', () => api.open(f.path));
      t.addEventListener('contextmenu', () => api.reveal(f.path));
      box.appendChild(t);
    }
  };
  draw('#exports', g.exports, 'No exports yet.');
  draw('#renders', g.renders, 'No renders yet — they appear as soon as the agent looks at a document.');
}

// ---------------------------------------------------------------- checkpoints
async function loadCheckpoints() {
  const files = await api.checkpoints();
  const list = $('#checkpoints'); list.innerHTML = '';
  if (!files.length) { list.innerHTML = '<div class="empty">No checkpoints on disk. They are written only when a document has unsaved work when the agent starts editing it.</div>'; return; }
  for (const f of files) {
    const d = document.createElement('div'); d.className = 'item wide';
    d.innerHTML = `<span><span class="tool">${esc(f.name)}</span><br><span class="t">${when(f.mtime)} · ${kb(f.size)}</span></span><button class="btn">Open in Photoshop</button><button class="btn">Reveal</button>`;
    const [open, reveal] = d.querySelectorAll('button');
    open.addEventListener('click', () => api.open(f.path)); reveal.addEventListener('click', () => api.reveal(f.path));
    list.appendChild(d);
  }
}

// ---------------------------------------------------------------- doctor
async function loadDoctor() {
  const list = $('#doctor'); list.innerHTML = '<div class="empty">Checking…</div>';
  const r = await api.doctor();
  list.innerHTML = '';
  for (const c of r.checks) {
    const d = document.createElement('div'); d.className = 'item check';
    d.innerHTML = `<span class="mark ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'}</span><span class="tool">${esc(c.label)}</span><span class="args" style="white-space:normal">${esc(c.detail)}</span>`;
    list.appendChild(d);
  }
}
$('#btn-doctor').addEventListener('click', loadDoctor);

// ---------------------------------------------------------------- toast
function toast(msg, bad) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.cssText = `position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:${bad ? '#4a1d1d' : '#1f2a44'};border:1px solid ${bad ? '#8a3a3a' : '#3a4a7a'};padding:10px 16px;border-radius:10px;font-size:12px;z-index:9;max-width:70%`;
  clearTimeout(t._h); t._h = setTimeout(() => t.remove(), 4000);
}

// ---------------------------------------------------------------- boot
api.onChange(() => { if ($('#tab-activity').classList.contains('active')) loadActivity(); if ($('#tab-gallery').classList.contains('active')) loadGallery(); refreshState(); });
refreshState();
loadActivity();
setInterval(refreshState, 8000);
