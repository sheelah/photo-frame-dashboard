# Calendar sync (Linux box)

A Google iCal feed with years of history is too big for the Worker to parse on the free plan, so
an always-on Linux machine parses it instead. Every 5 minutes a systemd user timer runs
`sync-calendar.js`, which fetches the feed, expands the next 8 days with `calendar.js`, and writes
about 5 KB of JSON to Workers KV (binding `CALENDAR`, key `calendar`). The Worker only reads that key.

If a run fails, it writes nothing. KV keeps the last good data, and after 20 minutes the page shows
"calendar offline since …".

Everything runs as your normal user; no root is needed.

| Path | What |
| --- | --- |
| a git checkout of this repo | the job runs `office-dashboard/sync/sync-calendar.js` from it |
| `~/.config/office-dashboard-sync.env` | every setting: feed URL, Cloudflare token and ids, `TZ`, `SYNC_DIR`, `NODE_CMD` (mode 600) |
| `~/.config/systemd/user/office-dashboard-sync.{service,timer}` | symlinks into this folder (`systemctl --user link`) |

The unit files contain no paths or settings of their own; they read everything from the env file.

## First install

Needs Node 20 or newer (system package or nvm) and systemd.

```sh
git clone <this repo> ~/src/photo-frame-dashboard
cd ~/src/photo-frame-dashboard/office-dashboard/sync
npm ci --omit=dev                             # with nvm: NODE_VERSION=22 ~/.nvm/nvm-exec npm ci --omit=dev
install -m 600 office-dashboard-sync.env.example ~/.config/office-dashboard-sync.env
$EDITOR ~/.config/office-dashboard-sync.env   # fill in every REPLACE_ME / YOU
systemctl --user link $PWD/office-dashboard-sync.service $PWD/office-dashboard-sync.timer
loginctl enable-linger                        # so the timer runs while you're logged out
systemctl --user start office-dashboard-sync.service
systemctl --user enable --now office-dashboard-sync.timer
```

The API token is a Cloudflare custom token with **Account → Workers KV Storage → Edit**, scoped to
your account only. Optionally add an IP filter for your home IP. KV tokens can't be limited to one
namespace.

## Update

```sh
cd ~/src/photo-frame-dashboard && git pull
cd office-dashboard/sync && npm ci --omit=dev
systemctl --user daemon-reload               # picks up unit file changes
```

The next timer run uses the new code.

## Troubleshoot

```sh
journalctl --user -u office-dashboard-sync -n 20     # "pushed N events ..." or "sync failed: ..."
systemctl --user list-timers office-dashboard-sync.timer
# Dry run with the real config (prints counts only, writes nothing):
(set -a; . ~/.config/office-dashboard-sync.env; $NODE_CMD "$SYNC_DIR/sync-calendar.js" --dry-run)
```

Logs never include event titles, locations or feed URLs.

Common errors:
- `feed 1 returned 404`: the secret iCal address was reset in Google Calendar.
- `KV write returned 403`: the token expired, was revoked, or lacks KV Edit.
- `fetch failed (ENOTFOUND)`: the box has no DNS or network.
- The timer stops while you're logged out: run `loginctl show-user $USER -p Linger`; it should say `yes`.
