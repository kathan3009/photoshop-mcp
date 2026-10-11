#!/usr/bin/env node
// Daily check (launchd): if Photoshop was updated since the last green e2e run, notify the user to re-run
// the suite. Reads the installed version from the app bundle, so Photoshop doesn't need to be running.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATE = join(homedir(), 'Library/Caches/photoshop-mcp/version-watch.json');

function installedVersion() {
  for (const d of readdirSync('/Applications').filter((x) => /^Adobe Photoshop/.test(x)).sort().reverse()) {
    const plist = join('/Applications', d, `${d}.app`, 'Contents/Info');
    try { return execFileSync('defaults', ['read', plist, 'CFBundleShortVersionString']).toString().trim(); } catch {}
  }
  return null;
}

const installed = installedVersion();
let green = null;
try { green = JSON.parse(readFileSync(join(ROOT, 'test/last-green.json'), 'utf8')); } catch {}
let state = {};
try { state = JSON.parse(readFileSync(STATE, 'utf8')); } catch {}

const status = { checkedAt: new Date().toISOString(), installed, lastGreen: green?.photoshop ?? null };
const stale = installed && installed !== status.lastGreen;
if (stale && state.notifiedFor !== installed) {
  const msg = `Photoshop ${installed} is installed; photoshop-mcp last passed its tests on ${status.lastGreen || 'no version'}. Run: cd ${ROOT} && npm test`;
  try { execFileSync('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "photoshop-mcp: re-test needed"`]); } catch {}
  state.notifiedFor = installed;
}
mkdirSync(join(homedir(), 'Library/Caches/photoshop-mcp'), { recursive: true });
writeFileSync(STATE, JSON.stringify({ ...state, ...status, stale: !!stale }, null, 2));
console.log(JSON.stringify({ ...status, stale: !!stale }));
