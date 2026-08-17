# VoiceForge Server 0.4

Server-only package. Runs in Docker on Linux AMD64 and ARM64.

## Supported hosts
- Ubuntu/Debian VPS
- Home Linux PC / mini-PC
- Raspberry Pi 4/5 with 64-bit OS

## Install
```bash
cd server
chmod +x install.sh
sudo ./install.sh
```

Then use:
```bash
voiceforge
```

First install generates:
- owner login
- random owner password
- one-time Admin Key
- JWT and LiveKit secrets

Admin panel:
`http://SERVER_IP:3001/admin`

Normal deployments pull `ghcr.io/nmazarov/voiceforge-server:latest`. If the package has not been made public yet, the manager falls back to a local Docker build.

## Security
Passwords use scrypt + random salt. Admin Key plaintext is shown once; only SHA-256 is stored. Admin sessions expire after 12 hours. The TUI can rotate the Admin Key and invalidate all active JWT sessions.

## Ports
TCP: 3001, 7880, 7881
UDP: 50000-50100
