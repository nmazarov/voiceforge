# VoiceForge Admin Console

Roles:
- `owner`: server creator; manages admin roles, security and audit log.
- `admin`: user moderation and channel management.
- `user`: normal client.

Authentication:
1. username + password;
2. one-time generated Owner Admin Key.

The key is POSTed only to `/api/admin/key-login`, never placed in a URL and never persisted by the admin page.

Admin panel capabilities:
- server overview;
- user list;
- block/unblock users;
- promote/demote admins (owner only);
- create/delete text and voice channels;
- audit log (owner only);
- rotate Admin Key from the VPS TUI;
- invalidate active sessions from the VPS TUI.
