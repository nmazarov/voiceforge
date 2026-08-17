#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run_root(){ if [ "$(id -u)" -eq 0 ]; then "$@"; elif command -v sudo >/dev/null 2>&1; then sudo "$@"; else echo "Root privileges required"; exit 1; fi; }
case "$(uname -m)" in x86_64|amd64) PLATFORM="AMD64 / x86_64";; aarch64|arm64) PLATFORM="ARM64 / Raspberry Pi";; *) echo "Unsupported architecture: $(uname -m)"; exit 1;; esac
echo "VoiceForge Server Setup — $PLATFORM"
if command -v apt-get >/dev/null 2>&1; then run_root apt-get update -y; run_root apt-get install -y whiptail curl git ca-certificates openssl; fi
if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | run_root sh; run_root systemctl enable --now docker 2>/dev/null || true; fi
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin required"; exit 1; }
mkdir -p "$ROOT_DIR/backups" "$ROOT_DIR/infra"
chmod +x "$ROOT_DIR/install.sh" "$ROOT_DIR/voiceforge.sh" "$ROOT_DIR/scripts/voiceforge-manager.sh"
run_root ln -sf "$ROOT_DIR/voiceforge.sh" /usr/local/bin/voiceforge
exec "$ROOT_DIR/voiceforge.sh"
