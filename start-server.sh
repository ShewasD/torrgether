#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -x ".tools/node/bin/node" ]]; then
  export PATH="$ROOT/.tools/node/bin:$PATH"
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"

echo "Starting Torrgether signaling server on $HOST:$PORT"
node server/server.js
