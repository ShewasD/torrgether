#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -x ".tools/node/bin/node" ]]; then
  export PATH="$ROOT/.tools/node/bin:$PATH"
fi

if [[ ! -x "node_modules/.bin/electron" ]]; then
  echo "Electron was not found at node_modules/.bin/electron"
  echo "Run ./install.sh first, or run a packaged build."
  exit 1
fi

if [[ -z "${MPV_PATH:-}" ]] && ! command -v mpv >/dev/null 2>&1; then
  echo "MPV was not found in PATH. Install mpv, set MPV_PATH, or run ./install.sh --install-mpv."
  exit 1
fi

echo "Starting Torrgether Electron client"
node_modules/.bin/electron desktop/main.js
