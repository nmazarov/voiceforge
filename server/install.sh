#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANAGER="$ROOT_DIR/voiceforge.sh"

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Root privileges are required. Run this script as root or install sudo."
    exit 1
  fi
}

echo ""
echo "╔══════════════════════════════════════╗"
echo "║        VoiceForge Server Setup       ║"
echo "║   Voice • Text • Screen Sharing      ║"
echo "╚══════════════════════════════════════╝"
echo ""

if command -v apt-get >/dev/null 2>&1; then
  echo "[1/4] Installing manager dependencies..."
  run_root apt-get update -y
  run_root apt-get install -y whiptail curl git ca-certificates openssl
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[2/4] Installing Docker..."
  curl -fsSL https://get.docker.com | run_root sh
  run_root systemctl enable --now docker 2>/dev/null || true
else
  echo "[2/4] Docker already installed."
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required."
  exit 1
fi

echo "[3/4] Preparing VoiceForge..."
mkdir -p "$ROOT_DIR/data" "$ROOT_DIR/backups"
chmod +x "$ROOT_DIR/voiceforge.sh" "$ROOT_DIR/scripts/voiceforge-manager.sh" "$ROOT_DIR/install.sh"

if [ ! -f "$ROOT_DIR/.env" ]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

echo "[4/4] Installing global command: voiceforge"
run_root ln -sf "$ROOT_DIR/voiceforge.sh" /usr/local/bin/voiceforge

echo ""
echo "VoiceForge Server Manager is ready."
echo "From now on, open it with: voiceforge"
echo ""

exec "$MANAGER"
