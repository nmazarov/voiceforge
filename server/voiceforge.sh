#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
exec "$SCRIPT_DIR/scripts/voiceforge-manager.sh" "$@"
