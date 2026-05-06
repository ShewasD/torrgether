# Changelog

## 0.4.4 - 2026-05-07

- Reworked the renderer UI so Watch is focused on playback, torrent import, selected file, room state, connection state, and playback/buffering/error state.
- Moved logs, diagnostics, server settings, MPV status, WebTorrent/RAM diagnostics, RuTracker advanced import, and debug controls into Settings.
- Hardened renderer DOM handling with null-safe optional elements and removed stale references to the old tab/right-panel structure.
- Improved Socket.IO signaling, torrent payload handoff, playback sync, MPV fallback behavior, RAM cache lifecycle, and shutdown/resource cleanup.
- Added documentation for install, development, self-hosted signaling, privacy, RAM requirements, production CORS, SERVER_TOKEN generation, MPV, RuTracker session persistence, release/build notes, and known limitations.

## 0.4.3 - 2026-05-05

- Stabilized RAM-only playback, MPV shutdown, signaling validation, update checks, source imports, and RuTracker handling.
