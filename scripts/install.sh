#!/bin/bash
# One-shot install from a fresh clone: dependencies + `photoshop-mcp setup` (pass through flags, e.g. --exec).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(uname)" == "Darwin" ]] || { echo "photoshop-mcp needs macOS"; exit 1; }
command -v node >/dev/null || { echo "Node 18+ is required: https://nodejs.org or 'brew install node'"; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 18) { console.error("Node 18+ is required"); process.exit(1); }'
command -v npm >/dev/null || { echo "npm is required (included with Node.js)"; exit 1; }
cd "$DIR"
echo "• Installing dependencies"
npm ci --no-audit --no-fund
node bin/photoshop-mcp.mjs setup "$@"
