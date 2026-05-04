# Torrgether

Torrgether is a desktop app for synchronized watching of legal torrent video.
Each participant streams the video locally; the signaling server syncs rooms,
torrent selection, and playback commands.

MPV is the only playback engine. The old browser `<video>` fallback was removed
because it could not reliably play AVI/MKV streams and made runtime failures
harder to diagnose.

## Highlights

- Windows and Linux are the primary targets.
- Packaged Windows builds use an assisted NSIS wizard.
- Windows installer downloads MPV during installation and adds Torrgether plus
  its bundled tools to the System PATH.
- Linux builds target AppImage and deb. The deb package depends on `mpv`.
- Source installers can download portable Node.js and install dependencies.
- Torrent media chunks stay in RAM through `desktop/LruMemoryChunkStore.js`.
- RAM cache eviction now keeps a low-watermark safety buffer and can refetch
  recently evicted pieces instead of ending the MPV stream early.
- The renderer includes English, Russian, Simplified Chinese, and Japanese UI
  strings with automatic system-locale selection and a manual language switcher.
- Hosts can open RuTracker inside an isolated Electron panel and import magnet
  links or `.torrent` downloads into the existing room flow.
- Logs are written to `desktop.log`, `server.log`, and `mpv.log`.

## Quick Start From Source

### Windows

Run PowerShell or Command Prompt from the repository root:

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
```

`-AddToSystemPath` requires elevation because it writes Machine PATH.
`-AddToUserPath` is kept for compatibility and only changes the current user.

### Linux

```bash
chmod +x install.sh start-client.sh start-server.sh
./install.sh --install-mpv --system-path --run
```

`--install-mpv` supports `apt`, `dnf`, `pacman`, and `zypper`. The script asks
before running `sudo`. `--system-path` creates `/usr/local/bin/torrgether`.

## Packaged Install

### Windows

Build the installer:

```powershell
.\install.cmd -BuildWin
```

Then run `dist/Torrgether-Setup-<version>.exe`. The wizard installs the app,
downloads the current regular `mpv-x86_64` archive from
`zhongfly/mpv-winbuild`, verifies `sha256.txt`, extracts MPV into
`resources\bin`, validates `mpv.exe --version`, and updates System PATH.

Uninstall removes only the exact PATH entries that the installer added.

### Linux

Build AppImage and deb targets:

```bash
./install.sh --build-linux
```

The deb package declares `mpv` as a dependency. For AppImage/source use,
install MPV with your package manager or run:

```bash
./install.sh --install-mpv
```

## Runtime Behavior

- Selecting a torrent or local media starts MPV automatically.
- Play, pause, seek, back, and forward commands go through MPV IPC.
- Host heartbeat uses MPV status. If MPV is not running, playback is treated as
  paused.
- Startup and torrent playback run MPV preflight checks. If MPV is missing, the
  UI shows a blocking status with the log path and reinstall instructions.
- Active playback writes a health snapshot every 30 seconds.
- Default MPV cache/read-ahead is 60 seconds to reduce RAM pressure.
- Default MPV demuxer memory is derived from the RAM cache budget and capped at
  256 MiB unless `MPV_DEMUXER_MAX_BYTES` is set.
- RuTracker is embedded as a separate sandboxed browser surface, not an iframe;
  navigation is limited to RuTracker and external links open in the system
  browser. Users sign in themselves, and only selected magnet/`.torrent` actions
  are imported.

## Logs

Common log locations:

- Packaged Windows: `%LOCALAPPDATA%\Torrgether\logs`
- Source/dev: `logs` or `LOG_DIR` when set

Useful files:

- `desktop.log`: Electron app lifecycle, crashes, MPV preflight, health snapshots
- `server.log`: signaling server state
- `mpv.log`: MPV playback diagnostics

The app logs `render-process-gone`, `child-process-gone`, `unresponsive`,
`before-quit`, `will-quit`, and process exit events.

## Configuration

Common client environment variables:

```bash
SERVER_URL=https://watch.example.com
SERVER_TOKEN=long-random-token
MPV_PATH=/custom/path/to/mpv
MAX_MEMORY_MB=512
MAX_MEMORY_CHUNKS=384
MAX_PENDING_RAM_READS=256
RAM_STORE_LOW_WATERMARK_RATIO=0.85
RAM_STORE_RECENT_EVICTION_TTL_MS=120000
RAM_STORE_MAX_RECENT_EVICTIONS=4096
MPV_CACHE_SECS=60
HEALTH_SNAPSHOT_INTERVAL_MS=30000
LOG_LEVEL=info
LOG_DIR=./logs
```

Common server environment variables:

```bash
HOST=0.0.0.0
PORT=3000
PUBLIC_URL=https://watch.example.com
CORS_ORIGIN=*
SERVER_TOKEN=long-random-token
ROOM_EMPTY_TTL_MS=300000
LOG_LEVEL=info
LOG_DIR=./logs
```

## Development

Use the local Node toolchain if global `node`/`npm` is not available:

```powershell
$env:PATH = "$PWD\.tools\node;$env:PATH"
.\.tools\node\npm.cmd run check
.\.tools\node\npm.cmd run lint
.\.tools\node\npm.cmd test
```

Release checks:

```bash
npm run check
npm run lint
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Help
bash -n install.sh
```

## Legal Use

Use only content that you are allowed to distribute and watch, such as your own
recordings, public-domain video, open-license films, or private torrents where
you have access rights.
