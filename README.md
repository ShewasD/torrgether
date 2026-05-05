# Torrgether

Torrgether is a desktop app for watching legal torrent video together. The app
keeps media chunks in RAM, launches MPV as the only playback engine, and uses a
small signaling server to sync rooms, torrent selection, host failover, and
playback commands.

## What Is New In 0.4

- RAM-only playback is stricter: MPV defaults to a 10 second RAM buffer,
  `24MiB` demuxer memory, no disk cache, smaller WebTorrent connection counts,
  and capped local HTTP range reads.
- `LruMemoryChunkStore` now tracks MPV range reads, protects active playback
  windows, evicts old chunks under heap pressure, and prioritizes refetches for
  pieces MPV seeks back to.
- MPV shutdown is more reliable: Torrgether asks MPV to quit over IPC, then
  falls back to process-tree termination if the player hangs.
- Signaling is hardened with explicit Socket.IO ping/pong timing, bounded room
  creation, disabled connection-state recovery by default, and safer auth
  limiter behavior.
- Update checks, source-provider requests, poster URLs, catalog search races,
  renderer log updates, and RuTracker imports have stricter timeouts and
  validation.

## Install

### Windows From Source

```powershell
.\install.cmd -Run -InstallMpv
```

Useful options:

```powershell
.\install.cmd -Help
.\install.cmd -InstallMpv
.\install.cmd -AddToUserPath
.\install.cmd -AddToSystemPath
.\install.cmd -InstallMpv -AddToSystemPath -Run
.\install.cmd -BuildWin
```

`-AddToSystemPath` requires Administrator. The installer pins portable Node to
`v24.15.0` unless `TORRGETHER_NODE_VERSION` is set.

### Linux From Source

```bash
chmod +x install.sh start-client.sh start-server.sh
./install.sh --install-mpv --system-path --run
```

Build packages:

```bash
./install.sh --build-linux
```

Cross-building the Windows installer from Linux requires Wine. Without Wine,
`./install.sh --build-win` exits with a clear error.

## Packaged Builds

GitHub tag pushes matching `v*` run `.github/workflows/release.yml`. The release
workflow builds and uploads:

- `Torrgether-Setup-<version>.exe`
- `Torrgether-<version>.AppImage`
- `Torrgether-<version>.deb`

The app checks the latest GitHub release and opens the release page when an
update is available.

## Configuration

Copy `.env.example` and set only the values you need.

Common client variables:

```bash
SERVER_URL=http://localhost:3000
SERVER_TOKEN=long-random-token
MPV_PATH=/custom/path/to/mpv
MAX_MEMORY_MB=512
MAX_MEMORY_CHUNKS=384
MAX_PENDING_RAM_READS=64
MPV_CACHE_SECS=10
MPV_DEMUXER_MAX_BYTES=24MiB
WEBTORRENT_MAX_CONNS=30
WEBTORRENT_MAX_WEB_CONNS=4
CONTENT_AUDIO_LANGUAGE=any
UPDATE_REPO=ShewasD/torrgether
UPDATE_CHECK_INTERVAL_MS=21600000
LOG_LEVEL=info
# 5 MiB
LOG_MAX_BYTES=5242880
LOG_MAX_FILES=5
```

Common server variables:

```bash
HOST=0.0.0.0
PORT=3000
PUBLIC_URL=https://watch.example.com
CORS_ORIGIN=https://watch.example.com
SERVER_TOKEN=long-random-token
ROOM_EMPTY_TTL_MS=300000
MAX_ROOMS=5000
SOCKET_PING_INTERVAL_MS=30000
SOCKET_PING_TIMEOUT_MS=60000
SOCKET_CONNECTION_STATE_RECOVERY=0
```

For production, set `SERVER_TOKEN` and restrict `CORS_ORIGIN`. `CORS_ORIGIN=*`
is only appropriate for local development.

## Architecture

```mermaid
flowchart LR
  Renderer["Renderer UI"] --> Preload["Preload bridge"]
  Preload --> Main["Electron main"]
  Main --> WebTorrent["WebTorrent RAM store"]
  Main --> MPV["MPV IPC"]
  Main --> Tracker["Optional tracker panel"]
  Renderer --> Socket["Socket.IO client"]
  Socket --> Server["Signaling server"]
  Server --> Rooms["Room state and host failover"]
```

The local WebTorrent HTTP server binds to `127.0.0.1`; MPV reads from that local
URL. Torrent media chunks are stored in `desktop/LruMemoryChunkStore.js`, not in
a disk cache.

## Security Model

- MPV is the only player. Browser `<video>` playback is intentionally absent.
- `.torrent` payloads imported from embedded tracker downloads are fetched into
  memory and sent to the renderer as base64; no temporary `.torrent` file is
  written for that flow.
- The RuTracker surface is an Electron `WebContentsView` with
  `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and
  navigation limited to RuTracker top-level URLs. External links open in the
  system browser.
- Server token checks compare SHA-256 digests with `timingSafeEqual`.
- Auth rate limiting has expiry cleanup and a maximum key count.
- Logs redact tokens, passwords, magnet URIs, base64 payloads, and local paths.

## RAM-Only Policy

RAM-only means torrent media chunks and embedded `.torrent` imports are not
cached to disk. Build outputs, release installers, package-manager caches, OS
logs, and bounded application logs are normal files.

Relevant controls:

```bash
MAX_MEMORY_MB=512
MAX_MEMORY_CHUNKS=384
MAX_PENDING_RAM_READS=64
RAM_STORE_LOW_WATERMARK_RATIO=0.75
RAM_STORE_RECENT_EVICTION_TTL_MS=30000
RAM_STORE_WINDOW_AHEAD_SECS=30
RAM_STORE_WINDOW_BEHIND_SECS=10
MPV_CACHE_SECS=10
MPV_DEMUXER_MAX_BYTES=24MiB
MPV_DEMUXER_MAX_BACK_BYTES=8MiB
WEBTORRENT_MAX_CONNS=30
WEBTORRENT_MAX_WEB_CONNS=4
STREAM_RANGE_MAX_BYTES=50MiB
```

When RAM pressure is high, the store evicts old chunks, marks evicted pieces
unverified, and lets WebTorrent refetch them instead of ending MPV's stream
early. `MAX_MEMORY_BYTES`, when set, still overrides the calculated RAM store
budget; otherwise Torrgether reserves memory for MPV and Electron before sizing
the chunk store.

## Development

If global Node/npm is unavailable, use the portable toolchain:

```powershell
$env:PATH = "$PWD\.tools\node;$env:PATH"
.\.tools\node\npm.cmd run check
.\.tools\node\npm.cmd test
```

In locked-down Windows environments where `.tools\node\node.exe` returns
`Access is denied`, use another Node 20+ install or the Codex bundled runtime.

Standard checks:

```bash
npm run check
npm run lint
npm test
npm run pack
```

## Troubleshooting

- MPV missing: run `.\install.cmd -InstallMpv` on Windows or
  `./install.sh --install-mpv` on Linux.
- Installer launches an old app: uninstall old builds first, then install the
  latest `Torrgether-Setup-<version>.exe` from GitHub Releases.
- No public server access: set `PUBLIC_URL`, `CORS_ORIGIN`, and `SERVER_TOKEN`
  on the signaling server.
- Playback stalls: lower `MPV_CACHE_SECS`, lower video quality, or increase
  `MAX_MEMORY_MB` if the machine has enough RAM.
- Release artifacts for this line use version `0.4.1` and tag `v0.4.1`.

## Legal Use

Use only content that you are allowed to distribute and watch: your own videos,
public-domain films, open-license media, Linux ISOs, private torrents, or other
content where you have the required rights.
