#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run_root(){
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "❌ Ошибка: требуются права суперпользователя (root или sudo)."
    exit 1
  fi
}

case "$(uname -m)" in
  x86_64|amd64) PLATFORM="AMD64 / x86_64";;
  aarch64|arm64) PLATFORM="ARM64 / Raspberry Pi";;
  *) echo "❌ Неподдерживаемая архитектура: $(uname -m)"; exit 1;;
esac

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║          🚀 VoiceForge Server Installer ($PLATFORM)         ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# 1. Проверка и установка базовых системных утилит
if command -v apt-get >/dev/null 2>&1; then
  echo "📦 [1/5] Проверка системных пакетов (curl, git, openssl, ca-certificates)..."
  run_root apt-get update -y -q >/dev/null 2>&1 || true
  run_root apt-get install -y -q curl git ca-certificates openssl whiptail >/dev/null 2>&1 || true
fi

# 2. Установка Docker, если отсутствует
if ! command -v docker >/dev/null 2>&1; then
  echo "🐳 [2/5] Docker не найден. Устанавливаю официальный Docker Engine..."
  curl -fsSL https://get.docker.com | run_root sh
  run_root systemctl enable --now docker 2>/dev/null || true
else
  echo "🐳 [2/5] Docker уже установлен."
fi

# 3. Проверка docker compose
if ! docker compose version >/dev/null 2>&1; then
  echo "⚠️ [3/5] Устанавливаю плагин docker-compose-plugin..."
  if command -v apt-get >/dev/null 2>&1; then
    run_root apt-get install -y -q docker-compose-plugin >/dev/null 2>&1 || true
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "❌ Ошибка: Docker Compose plugin не установлен."
  exit 1
fi
echo "✅ [3/5] Docker Compose готов к работе."

# 4. Настройка UFW портов (если брандмауэр включен)
if command -v ufw >/dev/null 2>&1 && ufw status | grep -qw "active"; then
  echo "🛡️ Настройка сетевых портов UFW (TCP 3001, 7880, 7881, UDP 50000-50100)..."
  run_root ufw allow 3001/tcp >/dev/null 2>&1 || true
  run_root ufw allow 7880/tcp >/dev/null 2>&1 || true
  run_root ufw allow 7881/tcp >/dev/null 2>&1 || true
  run_root ufw allow 50000:50100/udp >/dev/null 2>&1 || true
fi

# 5. Каталоги, права и глобальная команда voiceforge
mkdir -p "$ROOT_DIR/backups" "$ROOT_DIR/infra"
chmod +x "$ROOT_DIR/install.sh" "$ROOT_DIR/voiceforge.sh" "$ROOT_DIR/scripts/voiceforge-manager.sh"
run_root ln -sf "$ROOT_DIR/voiceforge.sh" /usr/local/bin/voiceforge

# 6. Автоматическая генерация конфигурации (.env и livekit.yaml) при первом запуске
ENV_FILE="$ROOT_DIR/.env"
FIRST_RUN=false
PUB_IP="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")"

if [ ! -f "$ENV_FILE" ]; then
  FIRST_RUN=true
  echo "⚙️ [4/5] Первичная настройка: генерация криптографических ключей..."
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  JWT_SECRET="$(openssl rand -hex 32)"
  LK_KEY="VF$(openssl rand -hex 8)"
  LK_SECRET="$(openssl rand -hex 24)"
  ADMIN_PASS="$(openssl rand -base64 18 | tr -d '\n=/+' | head -c 16)"
  ADMIN_KEY="VF-OWNER-$(openssl rand -hex 32)"
  KEY_HASH="$(printf '%s' "$ADMIN_KEY" | sha256sum | awk '{print $1}')"

  cat >"$ENV_FILE" <<EOF
APP_PORT=3001
JWT_SECRET=$JWT_SECRET
LIVEKIT_API_KEY=$LK_KEY
LIVEKIT_API_SECRET=$LK_SECRET
PUBLIC_LIVEKIT_URL=ws://${PUB_IP}:7880
DATA_DIR=/app/data
BOOTSTRAP_ADMIN_USER=owner
BOOTSTRAP_ADMIN_PASSWORD=$ADMIN_PASS
ADMIN_KEY_HASH=$KEY_HASH
VOICEFORGE_SERVER_IMAGE=ghcr.io/nmazarov/voiceforge-server:latest
LIVEKIT_IMAGE=livekit/livekit-server:latest
EOF

  cat >"$ROOT_DIR/infra/livekit.yaml" <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: true
keys:
  $LK_KEY: $LK_SECRET
EOF
else
  echo "⚙️ [4/5] Найдена существующая конфигурация .env."
fi

# 7. Запуск контейнеров
echo "🚀 [5/5] Запуск VoiceForge в Docker..."
cd "$ROOT_DIR"
if ! docker compose pull -q 2>/dev/null; then
  echo "🔨 Сборка локального Docker-образа (первый раз занимает 1-2 минуты)..."
  docker compose -f docker-compose.yml -f docker-compose.build.yml build app
fi

docker compose up -d --remove-orphans

# Ожидание готовности API
echo "⏳ Проверка запуска сервисов..."
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:3001/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Удаляем начальный пароль из .env после первого старта ради безопасности
if [ "$FIRST_RUN" = true ] && [ -n "${ADMIN_PASS:-}" ]; then
  sed -i '/^BOOTSTRAP_ADMIN_PASSWORD=/d' "$ENV_FILE" 2>/dev/null || true
fi

# 8. Итоговый отчет и подсказки пользователю
echo ""
echo "══════════════════════════════════════════════════════════════════════"
echo " 🎉 VoiceForge Server успешно установлен и запущен!"
echo "══════════════════════════════════════════════════════════════════════"
echo ""
echo " 🌐 Адрес сервера для подключения в клиенте:"
echo "    👉 http://${PUB_IP}:3001"
echo ""
echo " 🛡️ Панель администратора:"
echo "    👉 http://${PUB_IP}:3001/admin"
echo ""
if [ "$FIRST_RUN" = true ] && [ -n "${ADMIN_PASS:-}" ]; then
echo " 👤 Данные владельца (Owner):"
echo "    Логин:     owner"
echo "    Пароль:    $ADMIN_PASS"
echo "    Admin Key: $ADMIN_KEY"
echo ""
echo " ⚠️  ВНИМАНИЕ: Обязательно сохраните пароль и Admin Key сейчас!"
echo ""
fi
echo " 📋 Что делать дальше:"
echo "    1. Скачайте приложение VoiceForge для Windows или Linux:"
echo "       👉 https://github.com/nmazarov/voiceforge/releases/latest"
echo "    2. Запустите приложение и введите адрес: http://${PUB_IP}:3001"
echo "    3. Зарегистрируйтесь (приложение запомнит сервер и логин навсегда)!"
echo ""
echo " 🛠️ Быстрые команды управления на VPS:"
echo "    voiceforge          - открыть интерактивное меню управления"
echo "    voiceforge status   - проверить статус работы и портов"
echo "    voiceforge logs     - смотреть логи в реальном времени"
echo "    voiceforge restart  - перезапустить сервер"
echo "    voiceforge stop     - остановить сервер"
echo ""
echo "══════════════════════════════════════════════════════════════════════"
echo ""
