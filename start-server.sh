#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -x ".tools/node/bin/node" ]]; then
  export PATH="$ROOT/.tools/node/bin:$PATH"
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
export NODE_ENV="${NODE_ENV:-production}"

echo "Starting Torrgether signaling server on $HOST:$PORT"
echo "$$" > "${TORRGETHER_SERVER_PID_FILE:-$ROOT/torrgether-server.pid}"
node server/server.js
