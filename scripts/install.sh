#!/bin/bash
# One-shot install from a fresh clone: dependencies + `photoshop-mcp setup` (pass through flags, e.g. --exec).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(uname)" == "Darwin" ]] || { echo "photoshop-mcp needs macOS"; exit 1; }
command -v node >/dev/null || { echo "Node 18+ is required: https://nodejs.org or 'brew install node'"; exit 1; }
cd "$DIR"
echo "• Installing dependencies"
npm install --silent --no-audit --no-fund
node bin/photoshop-mcp.mjs setup "$@"
