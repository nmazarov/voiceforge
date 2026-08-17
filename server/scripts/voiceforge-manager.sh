#!/usr/bin/env bash
set -u
APP="VoiceForge"; ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; ENV="$ROOT/.env"; COMPOSE="$ROOT/docker-compose.yml"; BACKUPS="$ROOT/backups"
export TERM=${TERM:-xterm-256color}
msg(){ whiptail --title "$APP" --msgbox "$1" 18 84; }; yesno(){ whiptail --title "$APP" --yesno "$1" 16 84; }
compose(){ (cd "$ROOT" && docker compose -f "$COMPOSE" "$@"); }
pubip(){ curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true; }
arch(){ case "$(uname -m)" in x86_64|amd64) echo "AMD64";; aarch64|arm64) echo "ARM64 / Raspberry Pi";; *) uname -m;; esac; }
status(){ if ! command -v docker >/dev/null 2>&1 || [ ! -f "$ENV" ]; then echo "NOT INSTALLED"; elif compose ps -q 2>/dev/null|grep -q .; then echo "RUNNING"; else echo "STOPPED"; fi; }
setenv(){ local k="$1" v="$2"; if grep -q "^$k=" "$ENV" 2>/dev/null; then sed -i "s|^$k=.*|$k=$v|" "$ENV"; else printf '%s=%s\n' "$k" "$v" >>"$ENV"; fi; }
generate(){
  mkdir -p "$ROOT/infra" "$BACKUPS"; touch "$ENV"; chmod 600 "$ENV"
  local ip jwt lkkey lksecret pass adminkey keyhash
  ip="$(pubip)"; jwt="$(openssl rand -hex 32)"; lkkey="VF$(openssl rand -hex 8)"; lksecret="$(openssl rand -hex 24)"; pass="$(openssl rand -base64 18|tr -d '\n=/+'|head -c 20)"; adminkey="VF-OWNER-$(openssl rand -hex 32)"; keyhash="$(printf '%s' "$adminkey"|sha256sum|awk '{print $1}')"
  setenv APP_PORT 3001; setenv JWT_SECRET "$jwt"; setenv LIVEKIT_API_KEY "$lkkey"; setenv LIVEKIT_API_SECRET "$lksecret"; setenv PUBLIC_LIVEKIT_URL "ws://${ip:-127.0.0.1}:7880"; setenv DATA_DIR /app/data
  setenv BOOTSTRAP_ADMIN_USER owner; setenv BOOTSTRAP_ADMIN_PASSWORD "$pass"; setenv ADMIN_KEY_HASH "$keyhash"; setenv VOICEFORGE_SERVER_IMAGE ghcr.io/nmazarov/voiceforge-server:latest; setenv LIVEKIT_IMAGE livekit/livekit-server:latest
  cat >"$ROOT/infra/livekit.yaml" <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: true
keys:
  $lkkey: $lksecret
EOF
  OWNER_PASS="$pass"; OWNER_KEY="$adminkey"
}
pull_or_build(){
  compose pull && return 0
  msg "Готовый GHCR-образ пока недоступен. VoiceForge попробует локальную multi-stage сборку для текущей архитектуры."
  (cd "$ROOT" && docker compose -f docker-compose.yml -f docker-compose.build.yml build app) || return 1
}
install_app(){
  [ -f "$ENV" ] || generate
  pull_or_build || { msg "Не удалось получить/собрать серверный образ."; return; }
  compose up -d || { msg "Ошибка запуска. Открой Логи."; return; }
  sleep 3
  local ip="$(pubip)"
  if [ -n "${OWNER_PASS:-}" ]; then
    msg "СЕРВЕР УСТАНОВЛЕН\n\nAdmin panel: http://${ip:-SERVER_IP}:3001/admin\nOwner login: owner\nOwner password: $OWNER_PASS\n\nAdmin Key:\n$OWNER_KEY\n\nСОХРАНИ ЭТИ ДАННЫЕ СЕЙЧАС. Admin Key в открытом виде больше не хранится."
    sed -i '/^BOOTSTRAP_ADMIN_PASSWORD=/d' "$ENV"
    compose up -d
    unset OWNER_PASS OWNER_KEY
  else
    msg "VoiceForge запущен.\n\nAdmin panel:\nhttp://${ip:-SERVER_IP}:3001/admin"
  fi
}
update_app(){ yesno "Обновить Docker-образы VoiceForge? Данные сохранятся." || return; compose pull || { msg "Не удалось скачать обновление."; return; }; compose up -d --remove-orphans; docker image prune -f >/dev/null 2>&1||true; msg "Обновление применено."; }
rotate_key(){ [ -f "$ENV" ] || { msg "Сначала установи сервер."; return; }; local key="VF-OWNER-$(openssl rand -hex 32)" hash="$(printf '%s' "$key"|sha256sum|awk '{print $1}')"; setenv ADMIN_KEY_HASH "$hash"; compose up -d; msg "НОВЫЙ ADMIN KEY:\n\n$key\n\nСтарый ключ уже недействителен. Сохрани новый сейчас."; }
rotate_sessions(){ yesno "Сбросить все активные пользовательские/admin сессии?" || return; setenv JWT_SECRET "$(openssl rand -hex 32)"; compose up -d; msg "JWT secret изменён. Все активные сессии сброшены."; }
show_status(){ local ip="$(pubip)" tmp="$(mktemp)"; compose ps >"$tmp" 2>&1||true; whiptail --title "$APP • $(status)" --scrolltext --msgbox "Platform: $(arch)\nPublic IP: ${ip:-unknown}\nAdmin: http://${ip:-SERVER_IP}:3001/admin\nAPI: http://${ip:-SERVER_IP}:3001\nLiveKit: ws://${ip:-SERVER_IP}:7880\n\nPorts: TCP 3001,7880,7881 • UDP 50000-50100\n\n$(cat "$tmp")" 28 100; rm -f "$tmp"; }
logs(){ local t="$(mktemp)"; compose logs --tail=250 --no-color >"$t" 2>&1||true; whiptail --title "$APP logs" --scrolltext --textbox "$t" 28 110; rm -f "$t"; }
backup(){ mkdir -p "$BACKUPS"; local s="$(date +%Y%m%d-%H%M%S)"; tar -czf "$BACKUPS/config-$s.tar.gz" -C "$ROOT" .env infra/livekit.yaml 2>/dev/null; docker run --rm -v voiceforge-data:/data:ro -v "$BACKUPS:/backup" alpine sh -c "tar -czf /backup/data-$s.tar.gz -C /data ." >/dev/null 2>&1||true; msg "Backup: $BACKUPS"; }
diagnostics(){ local t="$(mktemp)"; { echo "VoiceForge diagnostics"; date -Is; uname -a; docker --version 2>&1; docker compose version 2>&1; echo; compose config 2>&1; echo; compose ps 2>&1; } >"$t"; whiptail --title "Diagnostics" --scrolltext --textbox "$t" 30 110; rm -f "$t"; }
while true; do c=$(whiptail --title "VoiceForge Server Manager • $(status) • $(arch)" --menu "Управление сервером:" 30 90 16 \
"1" "🚀 Установить / первичная настройка" "2" "⬆ Обновить контейнеры" "3" "▶ Запустить" "4" "■ Остановить" "5" "↻ Перезапустить" "6" "● Статус" "7" "≡ Логи" \
"8" "🔑 Сгенерировать новый Admin Key" "9" "🛡 Сбросить активные сессии" "10" "▣ Backup" "11" "🩺 Диагностика" "12" "🌐 Сеть / порты" "0" "Выход" 3>&1 1>&2 2>&3) || break
case "$c" in 1) install_app;;2) update_app;;3) compose up -d;msg "Запущено.";;4) compose stop;msg "Остановлено.";;5) compose restart;msg "Перезапущено.";;6) show_status;;7) logs;;8) rotate_key;;9) rotate_sessions;;10) backup;;11) diagnostics;;12) msg "LAN: подключение по локальному IP.\n\nInternet: публичный IP/NAT и порты:\nTCP 3001, 7880, 7881\nUDP 50000-50100\n\nПри CGNAT прямое подключение обычно невозможно.";;0) break;; esac; done
clear
