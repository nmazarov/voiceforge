# VoiceForge — полная установка и тест

## 1. VPS

Ubuntu 22.04/24.04 или Debian 12/13. Для первого реального теста рекомендуется 4 vCPU, 8 GB RAM, публичный IPv4 и сеть 1 Gbps.

Открой порты:

- `3001/tcp` — VoiceForge API;
- `7880/tcp` — LiveKit signaling MVP;
- `7881/tcp` — WebRTC fallback;
- `50000-50100/udp` — WebRTC media.

## 2. Установка серверной части

```bash
git clone https://github.com/nmazarov/voiceforge.git
cd voiceforge/server
chmod +x install.sh
sudo ./install.sh
```

После этого панель запускается:

```bash
voiceforge
```

В ней доступны Install, Update, Start, Stop, Restart, Status, Logs, Settings, Backup и удаление контейнеров без удаления persistent data.

Проверка API:

```bash
curl http://YOUR_VPS_IP:3001/api/health
```

Ожидается JSON с `ok: true`.

## 3. Windows-клиент

GitHub → Actions → `Build Desktop Clients` → последний успешный запуск → artifact `VoiceForge-Windows-x64`.

Локальная сборка:

```powershell
cd client
npm install
npm run build:windows
```

Установи `VoiceForge-Setup-0.3.0.exe`.

## 4. Ubuntu / Debian

GitHub → Actions → `Build Desktop Clients` → artifact `VoiceForge-Linux-x64`.

DEB:

```bash
sudo apt install ./VoiceForge-0.3.0-amd64.deb
```

AppImage:

```bash
chmod +x VoiceForge-0.3.0-x86_64.AppImage
./VoiceForge-0.3.0-x86_64.AppImage
```

Локальная сборка:

```bash
cd client
npm install
npm run build:linux
```

## 5. Первое подключение

В VoiceForge введи `YOUR_VPS_IP:3001`. Клиент проверит `/api/health`, сохранит адрес локально и откроет авторизацию. Первый зарегистрированный пользователь становится администратором данного VPS.

## 6. MVP-тест двух клиентов

Проверь: регистрацию двух пользователей, текст, вход в один голосовой канал, звук в обе стороны, mute/unmute, переход между каналами, screen share, рестарт VPS и сохранение аккаунтов/сообщений после рестарта.

## 7. Обновление

На VPS:

```bash
voiceforge
```

Выбери `Update`. Перед крупным обновлением сделай Backup.

## 8. Диагностика

```bash
cd voiceforge/server
docker compose ps
docker compose logs --tail=200
```

Если текст работает, а голос нет — в первую очередь проверь UDP `50000-50100` и внешний firewall VPS-провайдера.

## 9. Перед публичным production

Нужны HTTPS/WSS, домен, TURN/TLS, rate limiting, Argon2/bcrypt, роли/permissions, monitoring, автоматические backups, code signing desktop-клиентов и auto-update.

## 10. Процесс разработки

Изменения сначала собираются в законченный пакет. Коммит и push выполняются только после явного разрешения владельца проекта.
