// End-to-end test over real MCP stdio against the running Photoshop.
// Works only in scratch documents named "e2e-*", closes them unsaved, and verifies that whatever
// document the user had open is untouched (same active doc, same history).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHOTO = join(ROOT, 'test/fixtures/photo.jpg');
const OUT = join(tmpdir(), 'photoshop-mcp-e2e');
mkdirSync(OUT, { recursive: true });

const client = new Client({ name: 'e2e', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [join(ROOT, 'server.mjs')], env: { ...process.env, PS_MCP_ALLOW_EXEC: '1', PS_MCP_CHECKPOINT_DIR: join(OUT, 'checkpoints') } }));

const results = [];
let failures = 0;

async function call(name, args = {}) {
  const t = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const texts = r.content.filter((c) => c.type === 'text').map((c) => c.text);
  const notes = texts.filter((t) => t.startsWith('Notes: ')).join(' ');
  const text = texts.filter((t) => !t.startsWith('Notes: ')).join('\n');
  const image = r.content.find((c) => c.type === 'image');
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: !r.isError, text, json, image, notes, ms: Date.now() - t };
}

async function step(label, name, args, check) {
  const r = await call(name, args);
  let pass = r.ok, why = r.ok ? '' : r.text;
  if (pass && check) {
    try { const c = check(r.json, r, r.notes); if (c !== true && c !== undefined) { pass = false; why = String(c); } }
    catch (e) { pass = false; why = e.message; }
  }
  results.push({ label, pass, ms: r.ms, why });
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${String(r.ms).padStart(5)}ms  ${label}${pass ? '' : `\n        → ${why.slice(0, 400)}`}`);
  return r.json;
}

async function expectError(label, name, args, pattern) {
  const r = await call(name, args);
  const pass = !r.ok && pattern.test(r.text);
  results.push({ label, pass, ms: r.ms, why: r.text });
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${String(r.ms).padStart(5)}ms  ${label} (expected error)${pass ? `: ${r.text.slice(0, 110)}` : `\n        → got: ${r.text.slice(0, 300)}`}`);
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); return true; };
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- baseline
const before = (await call('ps_status')).json;
// A malformed Action Manager call can crash Photoshop and take every open document with it. Never test next to unsaved work.
const dirty = (before.documents || []).filter((d) => d.unsavedChanges && !/^e2e/.test(d.name));
if (dirty.length && process.env.PS_E2E_FORCE !== '1') {
  console.error(`Refusing to run: unsaved changes in ${dirty.map((d) => d.name).join(', ')}. Save or close them first (or PS_E2E_FORCE=1).`);
  await client.close();
  process.exit(2);
}
const userDoc = before.activeDocument ? { id: before.activeDocument.id, history: before.activeDocument.history } : null;
console.log(`User document: ${userDoc ? before.activeDocument.name : '(none)'} — will not be modified\n`);

let docId;
try {
  // ---------------------------------------------------------------- documents & content
  docId = (await step('create document 1200x800 dark fill', 'ps_document', { action: 'create', width: 1200, height: 800, name: 'e2e-doc', fill: '#202830' },
    (j) => assert(j.width === 1200 && j.height === 800, 'size'))).id;

  const grad = (await step('first edit takes a safety checkpoint (snapshot + disk copy)', 'ps_create_layer', { kind: 'gradientFill', stops: [{ color: '#1a2a6c' }, { color: '#fdbb2d' }], angle: 45, name: 'BG gradient', opacity: 80 },
    (j, r, notes) => {
      assert(j.created.type === 'gradientFill' && j.created.opacity === 80, JSON.stringify(j));
      const file = (notes.match(/at (\/.+?\.ps[db])/) || [])[1];
      assert(/history snapshot/.test(notes) && file && existsSync(file), `checkpoint note: ${notes}`);
    })).created;
  await step('second edit does not checkpoint again', 'ps_create_layer', { kind: 'pixel', name: 'tmp' }, (j, r, notes) => assert(!notes, notes));
  await call('ps_layer_op', { action: 'delete', layers: ['tmp'] });

  // The user clicks over to another document mid-session: edits must still land in the session's document.
  await call('ps_exec', { code: 'app.documents.add(UnitValue(300,"px"), UnitValue(200,"px"), 72, "e2e-other"); return app.activeDocument.name;' });
  await step('edit goes to the pinned doc while user views another', 'ps_add_text', { text: 'PINNED', x: 20, y: 60, size: 30, name: 'Pinned text' });
  await step('…the other doc is untouched and still in front', 'ps_exec', { code: 'var o = app.activeDocument; return { active: o.name, layers: o.layers.length };', docId: undefined },
    (j) => assert(j.active === 'e2e-doc' || j.active === 'e2e-other', JSON.stringify(j)));
  await step('pinned doc got the layer', 'ps_snapshot', { name: 'Pinned text' }, (j) => assert(j.layers.length === 1 && j.document.name === 'e2e-doc', JSON.stringify(j.document)));
  await step('user view restored to the other doc', 'ps_status', {}, (j) => assert(j.documents.find((d) => d.active).name === 'e2e-other', JSON.stringify(j.documents)));
  await call('ps_exec', { code: 'for (var i = 0; i < app.documents.length; i++) if (app.documents[i].name === "e2e-other") { app.documents[i].close(SaveOptions.DONOTSAVECHANGES); break; } return 1;' });
  const rect = (await step('rounded rectangle shape', 'ps_create_layer', { kind: 'rectangle', bounds: [100, 100, 500, 300], radius: 24, color: '#ff3366', name: 'Card' },
    (j) => assert(j.created.type === 'shape' && j.created.bounds.join() === '100,100,500,300', JSON.stringify(j.created.bounds)))).created;
  const ell = (await step('ellipse shape', 'ps_create_layer', { kind: 'ellipse', bounds: [700, 400, 900, 600], color: '#33aaff', name: 'Dot' })).created;
  const px = (await step('pixel layer filled', 'ps_create_layer', { kind: 'pixel', color: '#00ff00', name: 'Green fill', opacity: 10, blendMode: 'overlay' },
    (j) => assert(j.created.blendMode === 'overlay', j.created.blendMode))).created;
  const grp = (await step('group wrapping shapes', 'ps_create_layer', { kind: 'group', name: 'Shapes', layers: [rect.id, ell.id] },
    (j) => assert(j.created.type === 'group', 'type'))).created;
  // Photoshop creates new layers INSIDE a selected group (when it is expanded); the API contract is "above the selected layer".
  await step('with a group selected, a new adjustment lands above it, not inside', 'ps_adjustment', { type: 'vibrance', params: { vibrance: 5 }, name: 'Above group' });
  await step('…confirmed by its path', 'ps_snapshot', { name: 'Above group' }, (j) => assert(j.layers.length === 1 && j.layers[0].path === 'Above group', JSON.stringify(j.layers.map((l) => l.path))));
  await step('inside: puts a new layer in the group explicitly', 'ps_create_layer', { kind: 'pixel', name: 'In group', inside: grp.id });
  await step('…confirmed by its path', 'ps_snapshot', { name: 'In group' }, (j) => assert(j.layers[0].path === 'Shapes/In group', j.layers[0].path));
  await call('ps_layer_op', { action: 'delete', layers: ['Above group', 'In group'] });

  const head = (await step('point text with font', 'ps_add_text', { text: 'HELLO PHOTOSHOP', x: 100, y: 500, size: 72, color: '#ffffff', font: 'Helvetica-Bold', tracking: 50, name: 'Headline' },
    (j) => assert(j.created.text.font === 'Helvetica-Bold' && near(j.created.text.size, 72, 0.5), JSON.stringify(j.created.text)))).created;
  const para = (await step('paragraph text in a box', 'ps_add_text', { text: 'Line one\nA longer second line that should wrap inside the box', x: 650, y: 80, size: 28, box: { width: 450, height: 200 }, align: 'center', color: '#eeeeee' },
    (j) => assert(j.created.type === 'text', 'type'))).created;
  await expectError('missing font is reported, not faked', 'ps_add_text', { text: 'x', x: 10, y: 10, font: 'NoSuchFont-Bold' }, /not available/);
  await step('edit text', 'ps_edit_text', { layer: head.id, text: 'HELLO AGENTS', size: 64, color: '#ffd166' },
    (j) => assert(j.changed[0].text.contents === 'HELLO AGENTS' && j.changed[0].text.color === '#ffd166', JSON.stringify(j.changed[0].text)));

  const photo = (await step('place image (cover into box)', 'ps_place_image', { path: PHOTO, bounds: [600, 320, 1100, 720], fit: 'cover', name: 'Photo' },
    (j) => {
      const b = j.created.bounds;
      assert(j.created.type === 'smartObject' && j.created.mask, JSON.stringify(j.created));
      return assert(b[0] <= 600 && b[1] <= 320 && b[2] >= 1100 && b[3] >= 720, `cover leaves a gap: ${b}`);
    })).created;
  await step('cover-fit a wide photo into a full-width band (no hairline gap)', 'ps_place_image', { path: PHOTO, bounds: [0, 0, 1200, 300], fit: 'cover', name: 'Band' },
    (j) => { const b = j.created.bounds; return assert(b[0] <= 0 && b[1] <= 0 && b[2] >= 1200 && b[3] >= 300, `gap: ${b}`); });
  await step('layer shorthand works in layer_op', 'ps_layer_op', { action: 'delete', layer: 'Band' }, (j) => assert(j.deleted[0] === 'Band', JSON.stringify(j)));
  await step('cover fit reports the clipping mask in notes', 'ps_place_image', { path: PHOTO, bounds: [0, 0, 300, 100], fit: 'cover', name: 'Band2' },
    (j) => assert(j.created.mask && j.notes && /layer mask/.test(j.notes.join(' ')), JSON.stringify(j.notes)));
  await expectError('mask add on a masked layer explains replace', 'ps_mask', { layer: 'Band2', action: 'add', from: 'revealAll' }, /replace: true/);
  await step('select rect for a replacement mask', 'ps_selection', { action: 'rect', bounds: [0, 0, 150, 100] });
  await step('mask add replace: true swaps the mask from the selection', 'ps_mask', { layer: 'Band2', action: 'add', replace: true }, (j) => assert(j.changed[0].mask, 'mask'));
  await call('ps_layer_op', { action: 'delete', layer: 'Band2' });

  // ---------------------------------------------------------------- layer properties & structure
  await step('set_layers: center headline + move + style several layers', 'ps_set_layers', {
    updates: [
      { layer: head.id, align: { h: 'center' } },
      { layer: 'Dot', dx: -50, dy: 20, opacity: 70, blendMode: 'color' },
      { layer: px.id, visible: false },
      { layer: para.id, rotate: 5 },
    ],
  }, (j) => {
    const h = j.changed[0].bounds;
    assert(near((h[0] + h[2]) / 2, 600, 2), `headline center ${(h[0] + h[2]) / 2}`);
    assert(j.changed[1].bounds[0] === 650 && j.changed[1].blendMode === 'color', JSON.stringify(j.changed[1]));
    return assert(j.changed[2].visible === false, 'hidden');
  });
  await step('set_layers: flat single-layer shorthand', 'ps_set_layers', { layer: 'Dot', opacity: 65 }, (j) => assert(j.changed[0].opacity === 65, JSON.stringify(j.changed[0])));
  await expectError('set_layers: props without a layer are rejected', 'ps_set_layers', { opacity: 10 }, /needs "updates"/);
  await step('set_layers: resize to width keeps aspect', 'ps_set_layers', { updates: [{ layer: rect.id, width: 200 }] },
    (j) => { const b = j.changed[0].bounds; return assert(near(b[2] - b[0], 200) && near(b[3] - b[1], 100), JSON.stringify(b)); });
  await step('set_layers: background auto-converts with a note', 'ps_set_layers', { updates: [{ layer: 'Background', opacity: 90 }] },
    (j) => assert(j.notes && /background/i.test(j.notes[0]), JSON.stringify(j)));
  await step('lock a layer', 'ps_set_layers', { updates: [{ layer: ell.id, locked: true }] }, (j) => assert(j.changed[0].locked, 'locked'));
  await expectError('editing a locked layer is explained', 'ps_set_layers', { updates: [{ layer: ell.id, opacity: 20 }] }, /locked/);
  await step('unlock + edit in one update', 'ps_set_layers', { updates: [{ layer: ell.id, locked: false, opacity: 90 }] }, (j) => assert(!j.changed[0].locked && j.changed[0].opacity === 90, JSON.stringify(j.changed[0])));
  await step('named history snapshot', 'ps_history', { action: 'snapshot', name: 'before-experiment' });
  await call('ps_create_layer', { kind: 'pixel', name: 'experiment' });
  await step('revert to snapshot', 'ps_history', { action: 'revert', name: 'before-experiment' }, (j) => assert(j.revertedTo === 'before-experiment', JSON.stringify(j)));
  await step('experiment layer gone after revert', 'ps_snapshot', { name: 'experiment' }, (j) => assert(j.layers.length === 0, 'still there'));
  await step('history list separates snapshots', 'ps_history', { action: 'list' }, (j) => assert(j.snapshots.some((x) => /before-experiment/.test(x)) && j.snapshots.some((x) => /MCP checkpoint/.test(x)), JSON.stringify(j.snapshots)));
  await expectError('ambiguous / unknown layer name', 'ps_set_layers', { updates: [{ layer: 'Nope', visible: false }] }, /No layer named/);

  const dup = (await step('duplicate layer', 'ps_layer_op', { action: 'duplicate', layers: [head.id], name: 'Headline shadow' })).created[0];
  await step('move duplicate below original', 'ps_layer_op', { action: 'move', layers: [dup.id], below: head.id });
  await step('clip duplicate to layer below + unclip', 'ps_layer_op', { action: 'clip', layers: [dup.id] }, (j) => assert(j.changed[0].clipped, 'clipped'));
  await step('unclip', 'ps_layer_op', { action: 'unclip', layers: [dup.id] }, (j) => assert(!j.changed[0].clipped, 'unclipped'));
  await step('rasterize text', 'ps_layer_op', { action: 'rasterize', layers: [dup.id] }, (j) => assert(j.changed[0].type === 'pixel', j.changed[0].type));
  await step('convert to smart object', 'ps_layer_op', { action: 'smartObject', layers: [dup.id], name: 'SO' }, (j) => assert(j.created[0].type === 'smartObject', 'so'));
  await step('ungroup', 'ps_layer_op', { action: 'ungroup', layers: [grp.id] });
  await step('group again via layer_op', 'ps_layer_op', { action: 'group', layers: ['Card', 'Dot'], name: 'Shapes 2' });
  // The exact sequence that nested a layer into a hidden group in real use: layer_op group → new adjustment.
  await step('right after layer_op group, a new adjustment is NOT nested in it', 'ps_adjustment', { type: 'vibrance', params: { vibrance: 5 }, name: 'After group' });
  await step('…confirmed by its path', 'ps_snapshot', { name: 'After group' }, (j) => assert(j.layers.length === 1 && j.layers[0].path === 'After group', JSON.stringify(j.layers.map((l) => l.path))));
  await call('ps_layer_op', { action: 'delete', layer: 'After group' });
  await step('delete', 'ps_layer_op', { action: 'delete', layers: ['SO'] }, (j) => assert(j.deleted[0] === 'SO', JSON.stringify(j)));

  // ---------------------------------------------------------------- adjustments (every type, values verified)
  const adjCases = {
    curves: [{ rgb: [[0, 10], [64, 55], [192, 205], [255, 245]], blue: [[0, 20], [255, 235]] }, (s) => s.adjustment.length === 2 && s.adjustment[0].curve[1].vertical === 55],
    levels: [{ inputBlack: 12, inputWhite: 240, gamma: 1.1, red: { gamma: 0.9 } }, (s) => s.adjustment[0].input[0] === 12 && s.adjustment.length === 2],
    brightnessContrast: [{ brightness: 15, contrast: 10 }, (s) => s.brightness === 15 && s.center === 10],
    light: [{ exposure: 1, contrast: 10, highlights: -30, shadows: 25, whites: 5, blacks: -5 }, (s) => s.brightnessExposure === 1 && s.brightnessHighlights === -30],
    hueSaturation: [{ hue: 5, saturation: -15, reds: { hue: -4, saturation: 30 }, blues: { lightness: -10 } }, (s) => s.adjustment[0].saturation === -15 && s.adjustment.length === 3 && s.adjustment[1].localRange === 1 && s.adjustment[1].saturation === 30 && s.adjustment[2].localRange === 5],
    colorBalance: [{ shadows: [-10, 0, 15], highlights: [8, 0, -10] }, (s) => s.shadowLevels[2] === 15 && s.highlightLevels[0] === 8],
    vibrance: [{ vibrance: 20, saturation: -5 }, (s) => s.vibrance === 20],
    photoFilter: [{ color: '#ec8a00', density: 20 }, (s) => s.density === 20],
    exposure: [{ exposure: 0.25, gamma: 1.05 }, (s) => near(s.exposure, 0.25, 0.01)],
    blackAndWhite: [{ reds: 50, tint: '#e1d3b3' }, (s) => s.red === 50 && s.useTint === true],
    gradientMap: [{ stops: [{ color: '#140c2a' }, { color: '#f7c873' }] }, (s) => s.gradient.colors.length === 2],
    invert: [{}, () => true],
    posterize: [{ levels: 8 }, (s) => s.levels === 8],
    threshold: [{ level: 120 }, (s) => s.level === 120],
  };
  let curvesId;
  for (const [type, [params, verify]] of Object.entries(adjCases)) {
    const j = await step(`adjustment ${type}`, 'ps_adjustment', { type, params, name: `Adj ${type}`, opacity: 50 },
      (r) => assert(r.created.adjustment && verify(r.created.settings || {}), `settings ${JSON.stringify(r.created.settings).slice(0, 300)}`));
    if (type === 'curves') curvesId = j?.created.id;
    if (!['curves', 'colorBalance'].includes(type) && j) await call('ps_layer_op', { action: 'delete', layers: [j.created.id] });
  }
  await step('update existing curves layer', 'ps_adjustment', { type: 'curves', layer: curvesId, params: { rgb: [[0, 0], [128, 150], [255, 255]] } },
    (j) => assert(j.changed[0].settings.adjustment[0].curve[1].vertical === 150, 'curve updated'));
  await expectError('unknown adjustment param is rejected (no silent no-op)', 'ps_adjustment', { type: 'brightnessContrast', params: { brightnes: 20 } }, /Allowed keys/);
  await step('adjustment clipped to the photo only', 'ps_adjustment', { type: 'hueSaturation', params: { saturation: -100 }, clipTo: photo.id, name: 'Photo B&W' },
    (j) => assert(j.created.clipped, 'clipped'));

  // ---------------------------------------------------------------- filters
  const pxl = (await step('pixel layer for filters', 'ps_create_layer', { kind: 'pixel', name: 'Filter target', color: '#808080' })).created;
  await step('gaussian blur (auto smart object)', 'ps_filter', { layer: pxl.id, type: 'gaussianBlur', params: { radius: 3 } },
    (j) => assert(j.changed[0].type === 'smartObject' && j.notes, JSON.stringify(j)));
  for (const [type, params] of Object.entries({ unsharpMask: { amount: 80, radius: 1.2 }, addNoise: { amount: 3 }, highPass: { radius: 2 }, motionBlur: { angle: 30, distance: 15 }, median: { radius: 2 } })) {
    await step(`smart filter ${type}`, 'ps_filter', { layer: 'Filter target', type, params });
  }
  await step('inspect lists smart filters', 'ps_inspect', { layers: ['Filter target'] }, (j) => assert(j[0].smartFilters.length === 6, JSON.stringify(j[0].smartFilters)));

  // ---------------------------------------------------------------- selections & masks
  await step('select rect', 'ps_selection', { action: 'rect', bounds: [100, 100, 400, 300] }, (j) => assert(j.selection.join() === '100,100,400,300', JSON.stringify(j)));
  await step('add ellipse to selection', 'ps_selection', { action: 'ellipse', bounds: [350, 250, 550, 450], mode: 'add' }, (j) => assert(j.selection[2] === 550, JSON.stringify(j)));
  await step('feather selection (wide radius allowed)', 'ps_selection', { action: 'feather', radius: 600 });
  await step('select rect again (sharp)', 'ps_selection', { action: 'rect', bounds: [100, 100, 400, 300] });
  const vig = (await step('adjustment masked by selection', 'ps_adjustment', { type: 'exposure', params: { exposure: -0.5 }, name: 'Local darken' },
    (j) => assert(j.created.mask, 'mask from selection'))).created;
  await step('select another rect (making the adjustment consumed the first one)', 'ps_selection', { action: 'rect', bounds: [200, 200, 500, 400] });
  await step('mask delete keeps the active selection', 'ps_mask', { layer: vig.id, action: 'delete' }, (j) => assert(!j.changed[0].mask, 'mask gone'));
  await step('…so a new adjustment still gets it as a mask', 'ps_adjustment', { type: 'exposure', params: { exposure: -0.3 }, name: 'Local darken 2' },
    (j) => assert(j.created.mask && j.created.bounds.join() === '200,200,500,400', JSON.stringify(j.created.bounds)));
  await call('ps_layer_op', { action: 'delete', layer: 'Local darken 2' });
  await call('ps_mask', { layer: vig.id, action: 'add', from: 'revealAll' });
  await expectError('per-layer subject on a partial layer explains the workaround', 'ps_selection', { action: 'subject', layer: photo.id }, /does not fill the canvas/);
  await step('select subject on the visible image (AI)', 'ps_selection', { action: 'subject' }, (j) => assert(Array.isArray(j.selection), 'has selection'));
  await step('subject with mode: subtract honors the previous selection', 'ps_selection', { action: 'rect', bounds: [0, 0, 1200, 800] });
  await step('…subtract', 'ps_selection', { action: 'subject', mode: 'subtract' }, (j) => assert(Array.isArray(j.selection) && j.selection[0] === 0 && j.selection[2] === 1200, `${j.selection}`));
  await step('…intersect leaves only the subject', 'ps_selection', { action: 'subject', mode: 'intersect' }, (j) => assert(Array.isArray(j.selection) && j.selection[0] > 0, `${j.selection}`));
  await step('limit selection to the photo layer', 'ps_selection', { action: 'layer', layer: photo.id, mode: 'intersect' }, (j) => assert(Array.isArray(j.selection) && j.selection[0] > 400 && j.selection[2] < 1210 && j.selection[1] >= 319, `${j.selection}`));
  await expectError('fill on a hidden layer is explained', 'ps_selection', { action: 'fill', layer: 'Green fill', color: '#ff00ff' }, /hidden/);
  await step('show layer', 'ps_set_layers', { updates: [{ layer: 'Green fill', visible: true }] });
  await step('fill selection on a pixel layer', 'ps_selection', { action: 'fill', layer: 'Green fill', color: '#ff00ff', opacity: 50 });
  await step('select none', 'ps_selection', { action: 'none' }, (j) => assert(j.selection === null, 'cleared'));
  await step('mask invert', 'ps_mask', { layer: vig.id, action: 'invert' });
  await step('mask disable', 'ps_mask', { layer: vig.id, action: 'disable' });
  await step('mask enable', 'ps_mask', { layer: vig.id, action: 'enable' });
  await step('mask delete', 'ps_mask', { layer: vig.id, action: 'delete' }, (j) => assert(!j.changed[0].mask, 'mask gone'));
  await step('mask add reveal all', 'ps_mask', { layer: vig.id, action: 'add', from: 'revealAll' }, (j) => assert(j.changed[0].mask, 'mask back'));

  // ---------------------------------------------------------------- perception
  await step('snapshot tree', 'ps_snapshot', {}, (j) => assert(j.layers.length > 5 && j.layers.some((l) => l.type === 'group'), 'tree'));
  await step('snapshot filtered by type', 'ps_snapshot', { type: 'text' }, (j) => assert(j.layers.every((l) => l.type === 'text' && l.path), 'filter'));
  await step('inspect adjustment + text', 'ps_inspect', { layers: [curvesId, head.id] }, (j) => assert(j[0].settings && j[1].text.tracking !== undefined, JSON.stringify(j[1].text)));
  await step('analyze whole image', 'ps_analyze', {}, (j) => assert(j.luminosity.mean > 0 && j.channels && j.colorCast, 'stats'));
  await step('analyze whole image reports its region', 'ps_analyze', {}, (j) => assert(j.region.source === 'whole image', JSON.stringify(j.region)));
  await step('analyze region + samples', 'ps_analyze', { region: [0, 0, 300, 300], points: [[150, 150], [800, 500]] },
    (j) => assert(j.samples.length === 2 && /^#/.test(j.samples[0].hex) && j.region.source === 'region' && j.region.bounds.join() === '0,0,300,300', JSON.stringify(j.region)));
  await step('render composite', 'ps_render', { maxSize: 800, out: join(OUT, 'e2e-composite.jpg') }, (j, r) => assert(r.image && j.width === 800, `render ${j && j.width}`));
  await step('render cropped region at full res', 'ps_render', { crop: [600, 320, 1100, 720], maxSize: 2000 }, (j) => assert(j.width === 500 && j.height === 400, `${j.width}x${j.height}`));
  await step('render one layer solo as png', 'ps_render', { layer: head.id, format: 'png', out: join(OUT, 'e2e-solo.png') }, (j) => assert(existsSync(j.path), 'file'));
  await step('fonts search', 'ps_fonts', { query: 'helvetica', limit: 5 }, (j) => assert(j.matches.length > 0, 'fonts'));
  await step('actions list', 'ps_actions', { action: 'list' }, (j) => assert(Array.isArray(j), 'list'));

  // ---------------------------------------------------------------- batch & history
  const countBefore = (await call('ps_snapshot', { maxLayers: 1000, depth: 30 })).json.layerCount;
  await step('batch: 3 ops in one step', 'ps_batch', {
    label: 'MCP: e2e batch',
    ops: [
      { op: 'add_text', args: { text: 'BATCH', x: 50, y: 760, size: 40, color: '#ffffff' } },
      { op: 'adjustment', args: { type: 'vibrance', params: { vibrance: 30 } } },
      { op: 'set_layers', args: { updates: [{ layer: 'BATCH', opacity: 60 }] } },
    ],
  }, (j) => assert(j.length === 3, 'three results'));
  await step('history shows batch as one state', 'ps_history', { action: 'list' }, (j) => assert(j.states[j.current].includes('e2e batch'), j.states[j.current]));
  await expectError('failing batch rolls back everything', 'ps_batch', {
    ops: [
      { op: 'add_text', args: { text: 'SHOULD VANISH', x: 50, y: 50 } },
      { op: 'set_layers', args: { updates: [{ layer: 999999, visible: false }] } },
    ],
  }, /op 1 \(set_layers\) failed.*rolled back/);
  await step('rollback left no trace', 'ps_snapshot', { name: 'SHOULD VANISH' }, (j) => assert(j.layers.length === 0, 'layer leaked'));
  await expectError('batch arg validation names the op', 'ps_batch', { ops: [{ op: 'adjustment', args: { type: 'curves', params: { rgbb: [] } } }] }, /ops\[0\]|Allowed keys/);
  await step('undo batch', 'ps_history', { action: 'undo', steps: 1 }, (j) => assert(/e2e batch/.test(j.from), j.from));
  await step('layer count back to pre-batch', 'ps_snapshot', { maxLayers: 1000, depth: 30 }, (j) => assert(j.layerCount === countBefore, `${j.layerCount} vs ${countBefore}`));
  await step('redo batch', 'ps_history', { action: 'redo', steps: 1 }, (j) => assert(/e2e batch/.test(j.to), j.to));

  // ---------------------------------------------------------------- user actions & exec
  await step('play a stock Photoshop action', 'ps_actions', { action: 'play', set: 'Basic Adjustments', name: 'Auto adjust tone' });
  await step('exec escape hatch returns values', 'ps_exec', { code: 'return { layers: __flatLayers().length, doc: app.activeDocument.name };' }, (j) => assert(j.doc === 'e2e-doc', JSON.stringify(j)));
  await expectError('exec errors roll back', 'ps_exec', { code: 'app.activeDocument.artLayers.add().name = "LEAK"; throw new Error("boom");' }, /boom/);
  await step('exec rollback left no trace', 'ps_snapshot', { name: 'LEAK' }, (j) => assert(j.layers.length === 0, 'leaked'));

  // ---------------------------------------------------------------- document ops & saving
  await step('save layered PSD copy', 'ps_document', { action: 'save', path: join(OUT, 'e2e.psd'), overwrite: true }, (j) => assert(j.bytes > 10000, `${j.bytes} bytes`));
  await step('export PNG', 'ps_document', { action: 'save', path: join(OUT, 'e2e.png'), overwrite: true }, (j) => assert(j.format === 'png', j.format));
  await step('export JPG q80 (sRGB by default)', 'ps_document', { action: 'save', path: join(OUT, 'e2e.jpg'), quality: 80, overwrite: true }, (j) => assert(j.format === 'jpg' && /sRGB/.test(j.profile), JSON.stringify(j)));
  await step('re-exporting a file this session wrote needs no overwrite flag', 'ps_document', { action: 'save', path: join(OUT, 'e2e.jpg'), quality: 80 }, (j, r, notes) => assert(j.format === 'jpg' && /exported earlier/.test(notes), notes));
  writeFileSync(join(OUT, 'user-file.jpg'), 'not ours');
  await expectError('refuses to overwrite a file it did not create', 'ps_document', { action: 'save', path: join(OUT, 'user-file.jpg') }, /File exists/);
  await expectError('refuses in-place save without overwrite', 'ps_document', { action: 'save' }, /never been saved|overwrite: true/);
  const dupDoc = await step('duplicate document', 'ps_document', { action: 'duplicate', name: 'e2e-dup' });
  await step('resize image (aspect kept)', 'ps_document', { action: 'resizeImage', width: 600 }, (j) => assert(j.width === 600 && j.height === 400, `${j.width}x${j.height}`));
  await step('resize canvas', 'ps_document', { action: 'resizeCanvas', width: 700, height: 500, anchor: 'center' }, (j) => assert(j.width === 700, 'w'));
  await step('crop', 'ps_document', { action: 'crop', bounds: [50, 50, 650, 450] }, (j) => assert(j.width === 600 && j.height === 400, `${j.width}x${j.height}`));
  await step('flatten', 'ps_document', { action: 'flatten' });
  await expectError('close refuses to drop unsaved changes', 'ps_document', { action: 'close', docId: dupDoc.id }, /unsaved changes/);
  await step('close duplicate with discard', 'ps_document', { action: 'close', docId: dupDoc.id, discard: true });
  await step('open a file', 'ps_document', { action: 'open', path: join(OUT, 'e2e.png') }, (j) => assert(j.name === 'e2e.png', j.name));
  await step('close it', 'ps_document', { action: 'close' });
  await step('activate e2e doc', 'ps_document', { action: 'activate', docId }, (j) => assert(j.name === 'e2e-doc', j.name));
  await step('final render', 'ps_render', { maxSize: 1200, out: join(OUT, 'e2e-final.jpg') });

  // ---------------------------------------------------------------- placement precision (found by the agent trial)
  await step('poster doc', 'ps_document', { action: 'create', width: 1080, height: 1350, name: 'e2e-poster', fill: '#0e0e12' });
  await step('cover-fit a 300ppi image into the top 810px', 'ps_place_image', { path: join(ROOT, 'test/fixtures/photo-300ppi.jpg'), bounds: [0, 0, 1080, 810], fit: 'cover', name: 'Hero' },
    (j) => { const b = j.created.bounds; return assert(b[0] <= 0 && b[1] <= 0 && b[2] >= 1080 && b[3] >= 810, `bounds ${b}`); });
  await step('…no background showing at the bottom edge (pixel check)', 'ps_analyze', { points: [[540, 809], [540, 811]] },
    (j) => assert(j.samples[0].hex !== '#0e0e12' && j.samples[1].hex === '#0e0e12', JSON.stringify(j.samples.map((x) => x.hex))));
  await step('contain-fit keeps aspect inside the box', 'ps_place_image', { path: join(ROOT, 'test/fixtures/photo-300ppi.jpg'), bounds: [100, 900, 980, 1300], fit: 'contain', name: 'Thumb' },
    (j) => { const b = j.created.bounds; return assert(b[0] >= 99 && b[1] >= 899 && b[2] <= 981 && b[3] <= 1301 && Math.abs((b[2] - b[0]) / (b[3] - b[1]) - 16 / 9) < 0.02, `bounds ${b}`); });
  await step('stretch-fit hits the box exactly', 'ps_place_image', { path: join(ROOT, 'test/fixtures/photo-300ppi.jpg'), bounds: [0, 1200, 540, 1350], fit: 'stretch', name: 'Strip' },
    (j) => { const b = j.created.bounds; return assert(Math.abs(b[0]) <= 1 && Math.abs(b[1] - 1200) <= 1 && Math.abs(b[2] - 540) <= 1 && Math.abs(b[3] - 1350) <= 1, `bounds ${b}`); });
  await call('ps_document', { action: 'close', discard: true });
  await call('ps_document', { action: 'activate', docId });

  // ---------------------------------------------------------------- text on a print-resolution document
  await step('300 ppi doc', 'ps_document', { action: 'create', width: 2000, height: 1200, name: 'e2e-300ppi', resolution: 300 });
  await step('text size is true pixels regardless of ppi', 'ps_add_text', { text: 'HH', x: 100, y: 300, size: 100, name: 'Cap' },
    (j) => { const b = j.created.bounds; const h = b[3] - b[1]; return assert(h > 55 && h < 100 && near(j.created.text.size, 100, 1), `height ${h}px, size ${j.created.text.size}`); });
  await step('paragraph box width is true pixels regardless of ppi', 'ps_add_text', { text: 'one two three four five six seven eight nine ten eleven twelve', x: 100, y: 500, size: 30, box: { width: 400, height: 300 }, name: 'Para' },
    (j) => { const b = j.created.bounds; return assert(b[2] - b[0] <= 401 && b[3] - b[1] > 60, `bounds ${b}`); });
  await step('inspect reports the box in pixels', 'ps_inspect', { layer: 'Para' }, (j) => assert(near(j[0].text.box.width, 400, 1), JSON.stringify(j[0].text.box)));
  await call('ps_document', { action: 'close', discard: true });
  await call('ps_document', { action: 'activate', docId });

  // ---------------------------------------------------------------- other color modes
  await step('CMYK doc: create + convert', 'ps_document', { action: 'open', path: PHOTO });
  await call('ps_exec', { code: 'app.activeDocument.changeMode(ChangeMode.CMYK); return 1;' });
  await step('CMYK: render', 'ps_render', { maxSize: 400 }, (j) => assert(j.width === 400, 'w'));
  await step('CMYK: analyze reports CMYK channels', 'ps_analyze', {}, (j) => assert(j.mode === 'CMYK' && j.channels.black, JSON.stringify(j.channels)));
  await step('CMYK: composite curves', 'ps_adjustment', { type: 'curves', params: { rgb: [[0, 0], [128, 140], [255, 255]] } });
  await expectError('CMYK: per-channel RGB curves explained', 'ps_adjustment', { type: 'curves', params: { red: [[0, 0], [255, 240]] } }, /needs an RGB document/);
  await step('CMYK: snapshot', 'ps_snapshot', {}, (j) => assert(j.layers.length >= 2, 'layers'));
  await call('ps_document', { action: 'close', discard: true });
  await step('Grayscale doc', 'ps_document', { action: 'open', path: PHOTO });
  await call('ps_exec', { code: 'app.activeDocument.changeMode(ChangeMode.GRAYSCALE); return 1;' });
  await step('Grayscale: analyze', 'ps_analyze', {}, (j) => assert(j.mode === 'GRAYSCALE' && j.channels.gray, JSON.stringify(j)));
  await expectError('Grayscale: colorBalance explained', 'ps_adjustment', { type: 'colorBalance', params: { midtones: [10, 0, 0] } }, /not available in Grayscale/);
  await step('Grayscale: levels', 'ps_adjustment', { type: 'levels', params: { inputBlack: 10 } });
  await step('Grayscale: render', 'ps_render', { maxSize: 300 });
  await call('ps_document', { action: 'close', discard: true });

  // ---------------------------------------------------------------- a large document
  await step('300-layer doc', 'ps_document', { action: 'create', width: 2000, height: 2000, name: 'e2e-big' });
  await call('ps_exec', { code: 'var d = app.activeDocument; for (var g = 0; g < 30; g++) { var set = d.layerSets.add(); set.name = "G" + g; for (var i = 0; i < 9; i++) set.artLayers.add().name = "L" + g + "_" + i; } return d.layers.length;' });
  await step('snapshot of 300 layers (full depth)', 'ps_snapshot', { depth: 10, maxLayers: 1000 }, (j, r) => assert(j.layerCount >= 300 && r.ms < 8000, `${j.layerCount} layers in ${r.ms}ms`));
  await step('name lookup in a 300-layer doc', 'ps_set_layers', { updates: [{ layer: 'G29/L29_8', visible: false }] }, (j, r) => assert(r.ms < 8000, `${r.ms}ms`));
  await step('filtered snapshot', 'ps_snapshot', { name: 'L15_' }, (j) => assert(j.layers.length === 9, String(j.layers.length)));
  await call('ps_document', { action: 'close', discard: true });
  await call('ps_document', { action: 'activate', docId });
} finally {
  // Close every scratch doc, unsaved, then put the user's document back in front.
  await call('ps_exec', { code: 'for (var i = app.documents.length - 1; i >= 0; i--) { var d = app.documents[i]; if (/^e2e/.test(d.name)) d.close(SaveOptions.DONOTSAVECHANGES); } return app.documents.length;' });
  if (userDoc) {
    await call('ps_document', { action: 'activate', docId: userDoc.id });
    const after = (await call('ps_status')).json.activeDocument;
    const same = after && after.id === userDoc.id && JSON.stringify(after.history) === JSON.stringify(userDoc.history);
    results.push({ label: 'user document untouched', pass: same });
    if (!same) failures++;
    console.log(`${same ? 'PASS' : 'FAIL'}         user document untouched (same active doc and history)`);
  }
  await client.close();
}

// ---------------------------------------------------------------- bridge-level checks
{
  const { callOp } = await import('../src/bridge.mjs');
  const t = Date.now();
  let msg = '';
  try { await callOp('exec', { code: '$.sleep(9000); return 1;' }, { timeoutS: 2, tool: 'e2e-busy' }); } catch (e) { msg = e.message; }
  const pass = /not responding|took longer/.test(msg);
  results.push({ label: 'busy Photoshop is detected and explained', pass, ms: Date.now() - t, why: msg });
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${String(Date.now() - t).padStart(5)}ms  busy Photoshop is detected and explained: ${msg.slice(0, 120)}`);
  await new Promise((r) => setTimeout(r, 9000));   // let the sleeping script finish
}
{
  const { LOG_DIR } = await import('../src/bridge.mjs');
  const f = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const lines = existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const pass = lines.some((l) => l.tool === 'ps_batch') && lines.some((l) => l.ok === false && l.error);
  results.push({ label: 'calls are logged (successes and failures)', pass });
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}         calls are logged to ${f} (${lines.length} lines)`);
}
{
  const plain = new Client({ name: 'e2e-plain', version: '0' });
  const env = { ...process.env }; delete env.PS_MCP_ALLOW_EXEC;
  await plain.connect(new StdioClientTransport({ command: 'node', args: [join(ROOT, 'server.mjs')], env }));
  const names = (await plain.listTools()).tools.map((x) => x.name);
  await plain.close();
  const pass = !names.includes('ps_exec') && names.length === 20;
  results.push({ label: 'ps_exec is off by default', pass });
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}         ps_exec is off by default (${names.length} tools)`);
}

const total = results.length, slow = results.filter((r) => r.ms).sort((a, b) => b.ms - a.ms).slice(0, 5);
console.log(`\n${total - failures}/${total} passed. Slowest: ${slow.map((r) => `${r.label} ${r.ms}ms`).join(', ')}`);
console.log(`Artifacts: ${OUT}`);
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
if (!failures) {
  writeFileSync(join(ROOT, 'test/last-green.json'), JSON.stringify({ photoshop: before.version, passed: total, at: new Date().toISOString() }, null, 2) + '\n');
}
process.exit(failures ? 1 : 0);
