#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -x ".tools/node/bin/node" ]]; then
  export PATH="$ROOT/.tools/node/bin:$PATH"
fi

HOST_WAS_SET=0
if [[ -n "${HOST:-}" ]]; then
  HOST_WAS_SET=1
fi
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
export NODE_ENV="${NODE_ENV:-production}"
PID_FILE="${TORRGETHER_SERVER_PID_FILE:-$ROOT/torrgether-server.pid}"

cleanup() {
  if [[ -n "${NODE_PID:-}" ]]; then
    kill "$NODE_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

echo "Starting Torrgether signaling server on $HOST:$PORT"
if [[ "${HOST_WAS_SET:-0}" != "1" && "${HOST}" == "0.0.0.0" ]]; then
  echo "Warning: HOST is 0.0.0.0, so the server binds to all network interfaces."
fi

node server/server.js &
NODE_PID=$!
echo "$NODE_PID" > "$PID_FILE"
wait "$NODE_PID"
