#!/usr/bin/env bash
set -euo pipefail

# Если скрипт запущен внутри уже клонированного репозитория
if [ -f "server/install.sh" ]; then
  cd server && exec ./install.sh "$@"
fi

# Если скрипт запущен одной строкой через curl | bash на чистом сервере
INSTALL_DIR="/opt/voiceforge"
echo "📥 Подготовка VoiceForge в $INSTALL_DIR..."

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Ошибка: для установки сервера требуются права root."
  echo "Запустите команду с sudo:"
  echo "curl -sSL https://raw.githubusercontent.com/nmazarov/voiceforge/main/install.sh | sudo bash"
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y -q >/dev/null 2>&1 || true
  apt-get install -y -q git curl ca-certificates >/dev/null 2>&1 || true
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "🔄 Обновление существующего репозитория в $INSTALL_DIR..."
  cd "$INSTALL_DIR"
  git pull origin main
else
  echo "📦 Клонирование репозитория VoiceForge..."
  mkdir -p "$INSTALL_DIR"
  git clone https://github.com/nmazarov/voiceforge.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

cd server
chmod +x install.sh voiceforge.sh scripts/voiceforge-manager.sh
exec ./install.sh "$@"
