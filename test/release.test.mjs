import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { releasePolicy, artifactName } from '../app/scripts/release-policy.mjs';

test('public builds fail closed without signing and notarization', () => {
  assert.throws(() => releasePolicy({ local: false, env: {}, identities: '' }), /certificate/);
  assert.throws(() => releasePolicy({ local: false, env: {}, identities: 'Developer ID Application: Test' }), /credentials/);
  assert.throws(() => releasePolicy({ local: false, env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, identities: 'Developer ID Application: Test' }), /unset/);
  assert.deepEqual(releasePolicy({ local: false, env: { APPLE_KEYCHAIN_PROFILE: 'test' }, identities: 'Developer ID Application: Test' }), { hardenedRuntime: true, notarize: true });
});

test('local builds are signed and cannot be confused with public artifacts', () => {
  assert.equal(releasePolicy({ local: true, env: {}, identities: '' }).identity, '-');
  assert.equal(artifactName('1.2.1', 'arm64', true), 'Photoshop-MCP-1.2.1-arm64-unnotarized.dmg');
  assert.equal(artifactName('1.2.1', 'x64', false), 'Photoshop-MCP-1.2.1-x64.dmg');
});

const root = fileURLToPath(new URL('..', import.meta.url));
function isolated(fn) {
  const home = mkdtempSync(join(tmpdir(), 'photoshop-setup-test-'));
  try {
    const run = (source) => spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: root, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 10000,
    });
    fn(home, run);
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test('JSON setup preserves other servers and refuses malformed shapes', () => isolated((home, run) => {
  const dir = join(home, '.cursor'); mkdirSync(dir);
  const file = join(dir, 'mcp.json');
  const original = JSON.stringify({ mcpServers: { unrelated: { command: 'other' } }, setting: 7 });
  writeFileSync(file, original);
  const connect = `const s = await import('./src/setup.mjs'); s.connect('cursor', false);`;
  assert.equal(run(connect).status, 0);
  const config = JSON.parse(readFileSync(file));
  assert.equal(config.mcpServers.unrelated.command, 'other');
  assert.equal(config.setting, 7);
  assert.equal(readFileSync(file + '.bak', 'utf8'), original);
  assert.equal(run(`const s = await import('./src/setup.mjs'); s.disconnect('cursor');`).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file)), JSON.parse(original));
  for (const bad of ['{broken', '[]', 'null', '{"mcpServers":[]}', '{"mcpServers":"oops"}']) {
    writeFileSync(file, bad);
    assert.notEqual(run(connect).status, 0);
    assert.equal(readFileSync(file, 'utf8'), bad);
  }
}));

test('Codex reconnect replaces its own env without deleting other sections', () => isolated((home, run) => {
  const dir = join(home, '.codex'); mkdirSync(dir);
  const file = join(dir, 'config.toml');
  writeFileSync(file, 'model = "example"\n\n[mcp_servers.other]\ncommand = "other"\n');
  const result = run(`const s = await import('./src/setup.mjs'); s.useRuntime({command:'/Applications/Photoshop MCP.app/Contents/MacOS/Photoshop MCP', args:['/test/server.mjs'],env:{ELECTRON_RUN_AS_NODE:'1'}}); s.connect('codex',true); s.connect('codex',false);`);
  assert.equal(result.status, 0, result.stderr);
  const cfg = readFileSync(file, 'utf8');
  assert.equal((cfg.match(/\[mcp_servers\.photoshop\]/g) || []).length, 1);
  assert.match(cfg, /\[mcp_servers.other\]\ncommand = "other"/);
  assert.match(cfg, /ELECTRON_RUN_AS_NODE = "1"/);
  assert.doesNotMatch(cfg, /PS_MCP_ALLOW_EXEC/);
}));

test('missing --client value fails before touching configuration', () => isolated((home) => {
  const result = spawnSync(process.execPath, [join(root, 'bin/photoshop-mcp.mjs'), 'setup', '--client', '--no-bin'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--client needs a value/);
}));
