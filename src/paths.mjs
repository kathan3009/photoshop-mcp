// Locations shared by the server, CLI, setup and doctor.
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SERVER = join(ROOT, 'server.mjs');
export const CLI = join(ROOT, 'cli.mjs');
export const SKILL_SRC = join(ROOT, 'skill');
export const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const home = homedir();
export const SKILL_LINK = join(home, '.claude/skills/photoshop');
export const BIN_DIR = join(home, '.local/bin');
export const CLIENT_CONFIGS = {
  'claude-desktop': { label: 'Claude Desktop', file: join(home, 'Library/Application Support/Claude/claude_desktop_config.json'), app: '/Applications/Claude.app' },
  cursor: { label: 'Cursor', file: join(home, '.cursor/mcp.json'), app: '/Applications/Cursor.app' },
  codex: { label: 'Codex CLI', file: join(home, '.codex/config.toml') },
};
export const SERVER_NAME = 'photoshop';
