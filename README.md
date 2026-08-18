# VoiceForge

VoiceForge — self-hosted голос, текст и screen sharing с нативными desktop-клиентами.

## Структура

```text
voiceforge/
├── server/   # только VPS: API, SQLite, LiveKit, Docker, Server Manager
└── client/   # только пользователь: Windows + Ubuntu/Debian + AppImage
```

Сервер и клиент теперь независимы: на VPS не устанавливается браузерный клиент. Пользователь ставит VoiceForge как обычное приложение и подключается к IP/домену своего сервера.

## VPS

Рекомендованный старт: **4 vCPU / 8 GB RAM / 1 Gbps**.

```bash
git clone https://github.com/nmazarov/voiceforge.git
cd voiceforge/server
chmod +x install.sh
sudo ./install.sh
```

Дальше управление одной командой:

```bash
voiceforge
```

## Windows

```powershell
cd client
npm install
npm run build:windows
```

Результат: `VoiceForge-Setup-1.0.0.exe`.

## Linux

```bash
cd client
npm install
npm run build:linux
```

Результаты: `.deb` для Ubuntu/Debian и portable `.AppImage`.

## Visual identity

VoiceForge использует собственный V-образный знак, графитовый интерфейс и violet/blue neon акценты. Логотип и дизайн встроены в экран подключения, авторизацию, основной клиент, голосовые комнаты и screen sharing.

Смотри `docs/BRAND.md` и `client/assets/logo.svg`.

Полная инструкция: `INSTALLATION.md`.
