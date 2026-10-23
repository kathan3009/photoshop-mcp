import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the *bundled* runtime and server, without Photoshop calls or client config changes.
export async function smokeBundle(appPath, version) {
  const home = mkdtempSync(join(tmpdir(), 'photoshop-mcp-smoke-'));
  const client = new Client({ name: 'release-smoke', version: '1' });
  const transport = new StdioClientTransport({
    command: join(appPath, 'Contents/MacOS/Photoshop MCP'),
    args: [join(appPath, 'Contents/Resources/server/server.mjs')],
    env: { HOME: home, PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1', PS_MCP_LOG: 'off' },
    stderr: 'pipe',
  });
  const timer = setTimeout(() => { transport.close().catch(() => {}); }, 30000);
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  try {
    await client.connect(transport);
    if (client.getServerVersion()?.version !== version) throw new Error('Bundled server version does not match the app.');
    const { tools } = await client.listTools();
    for (const name of ['ps_status', 'ps_render', 'ps_document', 'ps_history']) {
      if (!tools.some((t) => t.name === name)) throw new Error(`Bundled server is missing ${name}`);
    }
    console.log(`Bundled MCP handshake passed (${tools.length} tools, ${version}).`);
  } catch (error) {
    throw new Error(`Bundled MCP smoke failed: ${error.message}${stderr ? `\n${stderr}` : ''}`);
  } finally {
    clearTimeout(timer);
    await client.close();
    rmSync(home, { recursive: true, force: true });
  }
}
