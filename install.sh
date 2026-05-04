#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$ROOT/.tools"
NODE_DIR="$TOOLS_DIR/node"
NODE_BASE_URL="https://nodejs.org/dist/latest-v24.x"

RUN=0
BUILD_LINUX=0
BUILD_WIN=0
USER_PATH=0
SYSTEM_PATH=0
INSTALL_MPV=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --build-linux) BUILD_LINUX=1 ;;
    --build-win) BUILD_WIN=1 ;;
    --user-path) USER_PATH=1 ;;
    --system-path) SYSTEM_PATH=1 ;;
    --install-mpv) INSTALL_MPV=1 ;;
    --help|-h)
      echo "Usage: ./install.sh [--run] [--build-linux] [--build-win] [--user-path] [--system-path] [--install-mpv]"
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$1" -O "$2"
  else
    echo "curl or wget is required to download portable Node" >&2
    exit 1
  fi
}

install_portable_node() {
  mkdir -p "$TOOLS_DIR"
  tmp="$TOOLS_DIR/node-download"
  rm -rf "$tmp"
  mkdir -p "$tmp"

  download "$NODE_BASE_URL/SHASUMS256.txt" "$tmp/SHASUMS256.txt"
  entry="$(grep -E 'node-v.*-linux-x64\.tar\.xz$' "$tmp/SHASUMS256.txt" | head -n 1)"
  if [[ -z "$entry" ]]; then
    echo "Could not find Linux x64 Node tarball in SHASUMS256.txt" >&2
    exit 1
  fi

  expected_hash="$(awk '{print $1}' <<<"$entry")"
  file_name="$(awk '{print $2}' <<<"$entry")"
  archive="$tmp/$file_name"

  echo "Downloading portable Node LTS: $file_name"
  download "$NODE_BASE_URL/$file_name" "$archive"
  actual_hash="$(sha256sum "$archive" | awk '{print $1}')"
  if [[ "$actual_hash" != "$expected_hash" ]]; then
    echo "Node archive checksum mismatch. Expected $expected_hash, got $actual_hash" >&2
    exit 1
  fi

  tar -xJf "$archive" -C "$tmp"
  expanded="$(find "$tmp" -maxdepth 1 -type d -name 'node-v*-linux-x64' | head -n 1)"
  if [[ -z "$expanded" ]]; then
    echo "Node archive did not contain the expected directory" >&2
    exit 1
  fi

  rm -rf "$NODE_DIR"
  mv "$expanded" "$NODE_DIR"
  rm -rf "$tmp"
}

add_user_path() {
  profile="$HOME/.profile"
  marker_start="# >>> Torrgether portable Node PATH >>>"
  marker_end="# <<< Torrgether portable Node PATH <<<"

  touch "$profile"
  if grep -Fq "$marker_start" "$profile"; then
    echo "User PATH profile block already exists in $profile"
    return
  fi

  {
    printf '\n%s\n' "$marker_start"
    printf 'if [ -x "%s/bin/node" ]; then\n' "$NODE_DIR"
    printf '  case ":$PATH:" in\n'
    printf '    *:"%s/bin":*) ;;\n' "$NODE_DIR"
    printf '    *) export PATH="%s/bin:$PATH" ;;\n' "$NODE_DIR"
    printf '  esac\n'
    printf 'fi\n'
    printf '%s\n' "$marker_end"
  } >> "$profile"

  echo "Added portable Node PATH block to $profile"
  echo "Open a new terminal, or run: . $profile"
}

confirm_sudo_action() {
  action="$1"
  if [[ "${TORRGETHER_ASSUME_YES:-0}" == "1" ]]; then
    return 0
  fi

  printf '%s [y/N] ' "$action"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) echo "Skipped."; return 1 ;;
  esac
}

install_mpv_package() {
  if command -v mpv >/dev/null 2>&1; then
    echo "MPV already installed: $(command -v mpv)"
    return 0
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to install MPV automatically. Install mpv with your package manager and rerun." >&2
    return 1
  fi

  if command -v apt-get >/dev/null 2>&1; then
    confirm_sudo_action "Install MPV with apt-get now?" || return 1
    sudo apt-get update
    sudo apt-get install -y mpv
  elif command -v dnf >/dev/null 2>&1; then
    confirm_sudo_action "Install MPV with dnf now?" || return 1
    sudo dnf install -y mpv
  elif command -v pacman >/dev/null 2>&1; then
    confirm_sudo_action "Install MPV with pacman now?" || return 1
    sudo pacman -S --needed mpv
  elif command -v zypper >/dev/null 2>&1; then
    confirm_sudo_action "Install MPV with zypper now?" || return 1
    sudo zypper install -y mpv
  else
    echo "Could not find apt-get, dnf, pacman, or zypper." >&2
    echo "Install mpv manually, then rerun this script." >&2
    return 1
  fi

  if ! command -v mpv >/dev/null 2>&1; then
    echo "MPV install command completed, but mpv is still not on PATH." >&2
    return 1
  fi
}

add_system_path_wrapper() {
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to create /usr/local/bin/torrgether" >&2
    return 1
  fi

  confirm_sudo_action "Create /usr/local/bin/torrgether wrapper now?" || return 1
  tmp_wrapper="$(mktemp)"
  cat > "$tmp_wrapper" <<EOF_WRAPPER
#!/usr/bin/env bash
cd "$ROOT"
exec "$ROOT/start-client.sh" "\$@"
EOF_WRAPPER
  chmod +x "$tmp_wrapper"
  sudo install -m 0755 "$tmp_wrapper" /usr/local/bin/torrgether
  rm -f "$tmp_wrapper"
  echo "Installed /usr/local/bin/torrgether"
}

if [[ -x "$NODE_DIR/bin/node" ]]; then
  export PATH="$NODE_DIR/bin:$PATH"
elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  :
else
  install_portable_node
  export PATH="$NODE_DIR/bin:$PATH"
fi

if [[ "$USER_PATH" == "1" ]]; then
  if [[ ! -x "$NODE_DIR/bin/node" ]]; then
    install_portable_node
  fi
  export PATH="$NODE_DIR/bin:$PATH"
  add_user_path
fi

if [[ "$INSTALL_MPV" == "1" ]]; then
  install_mpv_package
fi

if [[ "$SYSTEM_PATH" == "1" ]]; then
  add_system_path_wrapper
fi

echo "Using Node: $(node --version)"
echo "Using npm: $(npm --version)"

cd "$ROOT"
npm install

if [[ "$RUN" == "1" ]]; then
  if ! command -v mpv >/dev/null 2>&1; then
    echo "MPV is required for playback and was not found on PATH." >&2
    echo "Run ./install.sh --install-mpv --run or install mpv manually." >&2
    exit 1
  fi
  npm run client
fi
if [[ "$BUILD_LINUX" == "1" ]]; then npm run dist:linux; fi
if [[ "$BUILD_WIN" == "1" ]]; then npm run dist:win; fi
