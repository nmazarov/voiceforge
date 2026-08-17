#!/usr/bin/env bash
set -u

APP_NAME="VoiceForge"
REPO_URL="https://github.com/nmazarov/voiceforge.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

export TERM=${TERM:-xterm-256color}

msg() { whiptail --title "$APP_NAME" --msgbox "$1" 12 72; }
yesno() { whiptail --title "$APP_NAME" --yesno "$1" 12 72; }

ensure_root_tools() {
  if ! command -v whiptail >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update -y && sudo apt-get install -y whiptail curl git ca-certificates
    else
      echo "whiptail is required. Install it and run again."
      exit 1
    fi
  fi
}

compose() {
  (cd "$ROOT_DIR" && docker compose -f "$COMPOSE_FILE" "$@")
}

is_installed() {
  command -v docker >/dev/null 2>&1 && [ -f "$ENV_FILE" ]
}

is_running() {
  command -v docker >/dev/null 2>&1 || return 1
  local ids
  ids="$(compose ps -q 2>/dev/null || true)"
  [ -n "$ids" ] || return 1
  [ "$(docker inspect -f '{{.State.Running}}' $ids 2>/dev/null | grep -c true || true)" -gt 0 ]
}

status_line() {
  if ! is_installed; then
    echo "NOT INSTALLED"
  elif is_running; then
    echo "RUNNING"
  else
    echo "STOPPED"
  fi
}

public_ip() {
  curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return 0
  fi
  if ! yesno "Docker / Docker Compose не найдены.\n\nУстановить Docker автоматически?"; then
    return 1
  fi
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable --now docker 2>/dev/null || true
}

generate_secrets() {
  local jwt lk_key lk_secret ip
  jwt="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  lk_key="VF$(openssl rand -hex 8 2>/dev/null || date +%s)"
  lk_secret="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  ip="$(public_ip)"

  cat > "$ENV_FILE" <<EOF
APP_PORT=3001
JWT_SECRET=$jwt
LIVEKIT_API_KEY=$lk_key
LIVEKIT_API_SECRET=$lk_secret
LIVEKIT_URL=ws://livekit:7880
PUBLIC_LIVEKIT_URL=ws://${ip:-localhost}:7880
DATABASE_PATH=/data/voiceforge.db
EOF

  cat > "$ROOT_DIR/infra/livekit.yaml" <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: true
keys:
  $lk_key: $lk_secret
EOF
}

install_app() {
  ensure_docker || return
  mkdir -p "$ROOT_DIR/data" "$BACKUP_DIR"
  if [ ! -f "$ENV_FILE" ]; then
    generate_secrets
  fi
  if yesno "Установить / пересобрать VoiceForge сейчас?\n\nБудут собраны Docker-образы и запущены сервисы."; then
    if compose up -d --build; then
      local ip
      ip="$(public_ip)"
      msg "VoiceForge установлен и запущен.\n\nПанель: voiceforge\nWeb: http://${ip:-SERVER_IP}:3001\nLiveKit: ws://${ip:-SERVER_IP}:7880\n\nОткройте TCP 3001, 7881 и UDP 50000-50100 в firewall VPS."
    else
      msg "Установка завершилась с ошибкой. Откройте пункт «Логи» для диагностики."
    fi
  fi
}

update_app() {
  if ! command -v git >/dev/null 2>&1; then
    msg "Git не найден. Сначала выполните «Установить»."
    return
  fi
  local old_branch
  old_branch="$(cd "$ROOT_DIR" && git branch --show-current 2>/dev/null || true)"
  if [ -z "$old_branch" ]; then
    msg "Каталог не является git-репозиторием. Обновление через панель недоступно."
    return
  fi
  if yesno "Обновить VoiceForge до последней версии из GitHub?\n\n.env и данные пользователей будут сохранены."; then
    (cd "$ROOT_DIR" && git fetch origin && git pull --ff-only origin "$old_branch") || { msg "Не удалось выполнить git pull. Проверьте локальные изменения."; return; }
    compose up -d --build
    msg "VoiceForge обновлён и перезапущен."
  fi
}

start_app() {
  ensure_docker || return
  compose up -d
  msg "VoiceForge запущен."
}

stop_app() {
  compose stop
  msg "VoiceForge остановлен. Данные сохранены."
}

restart_app() {
  compose restart
  msg "VoiceForge перезапущен."
}

show_status() {
  local ip state output
  ip="$(public_ip)"
  state="$(status_line)"
  output="$(compose ps 2>&1 || true)"
  whiptail --title "$APP_NAME — STATUS: $state" --scrolltext --msgbox "Server IP: ${ip:-unknown}\nWeb: http://${ip:-SERVER_IP}:3001\n\n$output" 22 92
}

show_logs() {
  local tmp
  tmp="$(mktemp)"
  compose logs --tail=200 --no-color > "$tmp" 2>&1 || true
  whiptail --title "$APP_NAME — последние 200 строк" --scrolltext --textbox "$tmp" 26 110
  rm -f "$tmp"
}

edit_settings() {
  [ -f "$ENV_FILE" ] || cp "$ENV_EXAMPLE" "$ENV_FILE"
  local port public_url jwt
  port="$(grep '^APP_PORT=' "$ENV_FILE" | cut -d= -f2- || echo 3001)"
  public_url="$(grep '^PUBLIC_LIVEKIT_URL=' "$ENV_FILE" | cut -d= -f2- || true)"
  jwt="$(grep '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)"

  port="$(whiptail --title "$APP_NAME — Settings" --inputbox "Web/API port" 10 70 "$port" 3>&1 1>&2 2>&3)" || return
  public_url="$(whiptail --title "$APP_NAME — Settings" --inputbox "Public LiveKit URL" 10 70 "$public_url" 3>&1 1>&2 2>&3)" || return
  if yesno "Сгенерировать новый JWT_SECRET?\n\nТекущие пользовательские сессии станут недействительными."; then
    jwt="$(openssl rand -hex 32)"
  fi

  sed -i "s|^APP_PORT=.*|APP_PORT=$port|" "$ENV_FILE"
  sed -i "s|^PUBLIC_LIVEKIT_URL=.*|PUBLIC_LIVEKIT_URL=$public_url|" "$ENV_FILE"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$jwt|" "$ENV_FILE"
  msg "Настройки сохранены. Выполните «Перезапустить», чтобы применить их."
}

backup_app() {
  mkdir -p "$BACKUP_DIR"
  local stamp file
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/voiceforge-$stamp.tar.gz"
  tar -czf "$file" -C "$ROOT_DIR" .env infra/livekit.yaml data 2>/dev/null || { msg "Не удалось создать резервную копию."; return; }
  msg "Бэкап создан:\n\n$file"
}

uninstall_app() {
  if ! yesno "Удалить контейнеры VoiceForge?\n\nБаза данных и .env останутся на диске."; then return; fi
  compose down --remove-orphans
  msg "Контейнеры удалены. Конфигурация, база и бэкапы сохранены."
}

about() {
  msg "VoiceForge Server Manager\n\nSelf-hosted voice/text/screen-share MVP\nRepository: nmazarov/voiceforge\n\nУправление сервером без ручного ввода Docker-команд."
}

main_menu() {
  while true; do
    local state choice
    state="$(status_line)"
    choice=$(whiptail --title "VoiceForge Server Manager  •  $state" \
      --menu "Выберите действие:" 24 78 13 \
      "1" "🚀 Установить / первичная настройка" \
      "2" "⬆  Обновить до последней версии" \
      "3" "▶  Запустить сервер" \
      "4" "■  Остановить сервер" \
      "5" "↻  Перезапустить сервер" \
      "6" "●  Статус и адреса" \
      "7" "≡  Логи сервера" \
      "8" "⚙  Настройки" \
      "9" "▣  Создать резервную копию" \
      "10" "✖  Удалить контейнеры" \
      "11" "ⓘ  О VoiceForge" \
      "0" "Выход" 3>&1 1>&2 2>&3) || break

    case "$choice" in
      1) install_app ;;
      2) update_app ;;
      3) start_app ;;
      4) stop_app ;;
      5) restart_app ;;
      6) show_status ;;
      7) show_logs ;;
      8) edit_settings ;;
      9) backup_app ;;
      10) uninstall_app ;;
      11) about ;;
      0) break ;;
    esac
  done
  clear
}

ensure_root_tools
main_menu
