// Probe runner: node probes/run.mjs [--scratch] file.jsx | -e 'code'
// --scratch opens test/fixtures/photo.jpg as `doc` and always closes it (unsaved) afterwards,
// restoring whatever document the user had active.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callOp } from '../src/bridge.mjs';
const argv = process.argv.slice(2);
const scratch = argv[0] === '--scratch' && argv.shift();
let code = argv[0] === '-e' ? argv[1] : readFileSync(argv[0], 'utf8');
if (scratch) {
  const fixture = fileURLToPath(new URL('../test/fixtures/photo.jpg', import.meta.url));
  code = `var __user = app.documents.length ? app.activeDocument : null;
var doc = app.open(new File(${JSON.stringify(fixture)}));
try { return (function () {\n${code}\n})(); }
finally { doc.close(SaveOptions.DONOTSAVECHANGES); if (__user) app.activeDocument = __user; }`;
}
// Probing sends untested descriptors; a bad one can crash Photoshop. Never probe next to unsaved work.
const dirty = await callOp('exec', { code: 'var n = []; for (var i = 0; i < app.documents.length; i++) if (!app.documents[i].saved) n.push(app.documents[i].name); return n;' });
if (dirty.length && process.env.PS_PROBE_FORCE !== '1') {
  console.log(`Refusing to probe: unsaved changes in ${dirty.join(', ')}. Save or close them first.`);
  process.exit(2);
}
try { console.log(JSON.stringify(await callOp('exec', { code }), null, 1)); }
catch (e) { console.log('ERROR:', e.message); process.exitCode = 1; }
