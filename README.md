# VoiceForge

Self-hosted voice, text and screen-sharing platform with a Windows desktop client and an interactive VPS server manager.

## Current MVP

VoiceForge currently includes:

- self-hosted server for Linux VPS;
- local accounts stored on the selected server;
- text channels and message history;
- voice channels through self-hosted LiveKit;
- microphone mute and screen sharing;
- native packaged Windows Electron client with a local UI;
- server selection by IP/domain inside the Windows client;
- interactive terminal VPS manager (`voiceforge` command);
- Docker Compose deployment;
- automatic Windows installer build through GitHub Actions.

## Recommended VPS

For the first real tests use at least:

- 4 vCPU;
- 8 GB RAM;
- SSD/NVMe storage;
- stable UDP support;
- 1 Gbit/s network preferred.

Voice/video traffic is primarily limited by network throughput and CPU rather than disk or RAM.

## Fast VPS install

Ubuntu 22.04/24.04 or Debian 12 is recommended.

```bash
git clone https://github.com/nmazarov/voiceforge.git
cd voiceforge
chmod +x install.sh
sudo ./install.sh
```

After installation the server manager can be opened from anywhere with:

```bash
voiceforge
```

The panel provides install, update, start, stop, restart, status, logs, settings, backup and container removal actions.

## Windows client

The Windows client is not just a browser window. Its React UI is packaged locally inside the installed Electron application and it connects to the chosen VoiceForge VPS using the API and WebRTC/LiveKit.

A Windows installer can be built with:

```powershell
npm install
npm run build:windows
```

The resulting installer is written to `release/`.

GitHub Actions also builds the Windows installer automatically when desktop/client code changes.

## Full setup guide

Read [INSTALLATION.md](INSTALLATION.md) for the complete VPS, firewall, Windows, update, backup and first-test procedure.

## Development rule

Changes should be prepared and reviewed as a logical batch. Do not push a series of tiny commits for every line-level edit; commit only after the owner explicitly approves the batch.

## Status

VoiceForge is an alpha MVP intended for private testing. Before public production use, add full HTTPS/WSS/TURN configuration, stronger password hashing, security hardening, monitoring and load testing.
