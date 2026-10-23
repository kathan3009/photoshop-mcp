import { build, Platform, Arch } from 'electron-builder';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { releasePolicy, artifactName } from './release-policy.mjs';
import { smokeBundle } from './smoke-bundle.mjs';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dirname(appDir);
const local = process.argv.includes('--local');
const archArg = process.argv.find((arg) => arg.startsWith('--arch='));
const arches = archArg ? [archArg.slice(7)] : ['arm64', 'x64'];
const allowed = new Set(['--local', '--arch=arm64', '--arch=x64']);
if (process.argv.slice(2).some((arg) => !allowed.has(arg))) throw new Error('Usage: release.mjs [--local] [--arch=arm64|--arch=x64]');
if (process.platform !== 'darwin') throw new Error('Build and verify macOS releases on macOS.');
const pkg = JSON.parse(readFileSync(join(appDir, 'package.json')));
const serverPkg = JSON.parse(readFileSync(join(root, 'package.json')));
if (pkg.version !== serverPkg.version) throw new Error('App and server versions must match.');
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
let identities = '';
if (!local) identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
const mac = releasePolicy({ local, env: process.env, identities });
// Never reuse old artifacts or old checksums. Only promote after every requested architecture passes.
const dist = join(appDir, 'dist');
mkdirSync(dist, { recursive: true });
const label = `${local ? 'local' : 'release'}-${pkg.version}-${arches.join('-')}`;
const destination = join(dist, label);
if (existsSync(destination)) throw new Error(`Output already exists: ${destination}. Archive it before rebuilding; releases are immutable.`);
const output = mkdtempSync(join(dist, '.building-'));

try {
  run(process.execPath, [join(appDir, 'scripts/prepare-server.mjs')]);
  // Public configuration fails closed. Local builds are explicitly ad-hoc signed and separately named.
  const template = `Photoshop-MCP-\${version}-\${arch}${local ? '-unnotarized' : ''}.\${ext}`;
  await build({
    projectDir: appDir,
    targets: Platform.MAC.createTarget(['dmg'], ...arches.map((arch) => Arch[arch])),
    publish: 'never',
    config: {
      forceCodeSigning: !local,
      directories: { output },
      mac: { ...mac, target: [{ target: 'dmg', arch: arches }], artifactName: template },
      dmg: { artifactName: template },
    },
  });

  const checksums = [];
  const report = { version: pkg.version, channel: local ? 'unnotarized-test' : 'notarized-release', verifiedAt: new Date().toISOString(), artifacts: [] };
  for (const arch of arches) {
    const name = artifactName(pkg.version, arch, local);
    const dmg = join(output, name);
    run('/usr/bin/hdiutil', ['verify', dmg]);
    const mount = mkdtempSync(join(tmpdir(), 'photoshop-mcp-dmg-'));
    let mounted = false;
    let smoke = 'not-run-other-architecture';
    try {
      run('/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount]);
      mounted = true;
      const bundle = join(mount, 'Photoshop MCP.app');
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
      if (!local) {
        run('/usr/bin/xcrun', ['stapler', 'validate', bundle]);
        run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle]);
      }
      if (arch === process.arch) {
        await smokeBundle(bundle, pkg.version);
        smoke = 'passed';
      }
    } finally {
      if (mounted) run('/usr/bin/hdiutil', ['detach', mount]);
      rmSync(mount, { recursive: true, force: true });
    }
    const sha256 = createHash('sha256').update(readFileSync(dmg)).digest('hex');
    checksums.push(`${sha256}  ${name}`);
    report.artifacts.push({ name, sha256, signature: 'passed', dmgIntegrity: 'passed', notarization: local ? 'not-notarized' : 'passed', mcpSmoke: smoke });
  }
  writeFileSync(join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
  writeFileSync(join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  renameSync(output, destination);
  console.log(`Verified artifacts: ${destination}`);
  if (local) console.log('TEST BUILD ONLY: ad-hoc signed, NOT notarized. Gatekeeper may block downloaded copies. See docs/INSTALLATION.md.');
} catch (error) {
  console.error(`Build failed. Incomplete artifacts remain at ${output}; do not distribute them.`);
  throw error;
}
