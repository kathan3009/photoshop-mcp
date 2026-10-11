// Copy the server (what the app bundles under Contents/Resources/server) from the repo root into app/server.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(APP);
const OUT = join(APP, 'server');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of ['server.mjs', 'cli.mjs', 'package.json', 'LICENSE', 'src', 'jsx', 'skill', 'node_modules']) {
  cpSync(join(ROOT, f), join(OUT, f), { recursive: true, filter: (p) => !/\.DS_Store$|\.map$|\/test\/|\/tests\/|README|CHANGELOG/.test(p) });
}
console.log('server copied to', OUT);
