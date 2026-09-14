# Running XDB as a Local Service (macOS & Linux)

Set up XDB so it:

- starts automatically when you log in (or at boot, on Linux),
- keeps running in the background and restarts if it crashes,
- pulls, rebuilds, and restarts itself daily from the public repo ([github.com/dancaldera/xdb](https://github.com/dancaldera/xdb)).

The service runs the production build (`pnpm start`), serving the app at `http://127.0.0.1:4595`. Use `pnpm dev` only for development — never under a service manager.

## Prerequisites

- Node.js and pnpm on `PATH` (`pnpm` via Homebrew, corepack, or the standalone installer all work).
- A clone of the repo. This guide uses `~/xdb`; substitute your own path everywhere, or set `XDB_REPO` for the update script.

## 1. One-time setup

```bash
git clone https://github.com/dancaldera/xdb ~/xdb   # or your preferred path
cd ~/xdb
pnpm install
pnpm build
```

`pnpm build` produces `apps/web/dist/web`, which the server needs before the first start.

## 2. The update script

Install this script **outside the repo** (so `git pull` can never overwrite it while it is running) at `~/.local/bin/xdb-update`:

```bash
mkdir -p ~/.local/bin
chmod +x ~/.local/bin/xdb-update   # after saving the file below
```

```bash
#!/usr/bin/env bash
# xdb-update — pull latest XDB, rebuild, restart the service.
set -euo pipefail

REPO="${XDB_REPO:-$HOME/xdb}"

# launchd/systemd jobs get a minimal PATH; add common pnpm/node locations.
export PATH="$HOME/.local/bin:$HOME/.local/share/pnpm:/opt/homebrew/bin:/usr/local/bin:$PATH"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

cd "$REPO"

if [ -n "$(git status --porcelain)" ]; then
  log "working tree has local changes — skipping update"
  exit 0
fi

git fetch --quiet origin
if [ "$(git rev-parse HEAD)" = "$(git rev-parse '@{u}')" ]; then
  log "already up to date"
  exit 0
fi

log "updating $(git rev-parse --short HEAD) -> $(git rev-parse --short '@{u}')"
git merge --ff-only '@{u}'
pnpm install --frozen-lockfile
pnpm build

if [[ "$OSTYPE" == "darwin"* ]]; then
  launchctl kickstart -k "gui/$(id -u)/com.xdb.web"
else
  systemctl --user restart xdb.service
fi
log "done"
```

What it does: skips the update if you have uncommitted local changes, fast-forwards to the remote, reinstalls dependencies (`--frozen-lockfile`, so the lockfile is never rewritten and can't dirty the tree), rebuilds, then restarts the service (the restart also picks up the freshly built `dist/`). `node_modules/` and `dist/` are gitignored, so builds never dirty the tree either.

Test it any time with:

```bash
~/.local/bin/xdb-update
```

## 3. macOS — launchd

LaunchAgents run per-user at login and keep the process alive in the background. Create two plists.

### App service — `~/Library/LaunchAgents/com.xdb.web.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.xdb.web</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>exec pnpm start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/YOURNAME/xdb</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/YOURNAME/.xdb/logs/service.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOURNAME/.xdb/logs/service.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>XDB_PORT</key>
    <string>4595</string>
  </dict>
</dict>
</plist>
```

Notes:

- Replace `/Users/YOURNAME/xdb` with your clone path (launchd does not expand `~`).
- `zsh -lc` loads your login profile so `pnpm` resolves however you installed it. Alternatively, run `which pnpm` and put that absolute path as the first `ProgramArguments` entry (with `start` as the second), dropping the `zsh` entries.
- `RunAtLoad` starts XDB at login; `KeepAlive` restarts it if it exits.
- Logs go to `~/.xdb/logs/` (create the directory once: `mkdir -p ~/.xdb/logs`).

### Daily update — `~/Library/LaunchAgents/com.xdb.update.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.xdb.update</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOURNAME/.local/bin/xdb-update</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>4</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>XDB_REPO</key>
    <string>/Users/YOURNAME/xdb</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/YOURNAME/.xdb/logs/update.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOURNAME/.xdb/logs/update.err.log</string>
</dict>
</plist>
```

Runs daily at 04:00. If the Mac is asleep or off at that time, launchd runs the missed job at the next wake — no updates are lost.

### Load and manage

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.xdb.web.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.xdb.update.plist

launchctl kickstart -k gui/$(id -u)/com.xdb.web     # restart now
launchctl print gui/$(id -u)/com.xdb.web           # status
launchctl bootout gui/$(id -u)/com.xdb.web         # stop + disable
launchctl bootout gui/$(id -u)/com.xdb.update
```

A LaunchAgent only runs while you're logged in. To run XDB before login (e.g. a headless Mac), install the same plist as a LaunchDaemon under `/Library/LaunchDaemons` with `sudo` instead — not needed for a personal machine.

## 4. Linux — systemd user service + timer

User units need no root and start at login; `loginctl enable-linger` (below) promotes them to start at boot.

### App service — `~/.config/systemd/user/xdb.service`

```ini
[Unit]
Description=XDB local database client
After=network-online.target

[Service]
WorkingDirectory=%h/xdb
ExecStart=/usr/bin/env bash -lc 'exec pnpm start'
Restart=always
RestartSec=3
Environment=XDB_PORT=4595

[Install]
WantedBy=default.target
```

`bash -lc` resolves `pnpm` from your login PATH; alternatively replace it with the absolute path from `which pnpm` followed by `start`.

### Daily update — `xdb-update.service` + `xdb-update.timer`

`~/.config/systemd/user/xdb-update.service`:

```ini
[Unit]
Description=Update XDB from GitHub, rebuild, restart

[Service]
Type=oneshot
Environment=XDB_REPO=%h/xdb
ExecStart=%h/.local/bin/xdb-update
```

`~/.config/systemd/user/xdb-update.timer`:

```ini
[Unit]
Description=Daily XDB update

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

`Persistent=true` catches up a missed run after downtime, matching launchd's run-on-wake behavior.

### Enable and manage

```bash
systemctl --user daemon-reload
systemctl --user enable --now xdb.service
systemctl --user enable --now xdb-update.timer
sudo loginctl enable-linger "$USER"   # optional: start at boot, before login

systemctl --user status xdb.service
journalctl --user -u xdb.service -f          # live logs
journalctl --user -u xdb-update.service    # update runs
systemctl --user list-timers               # next scheduled update
```

**Non-systemd distros:** use a cron entry for the update (`0 4 * * * $HOME/.local/bin/xdb-update >> $HOME/.xdb/logs/update.log 2>&1`) and your init system's equivalent of `Restart=always`, or a supervisor such as pm2.

## 5. Verify

```bash
curl http://127.0.0.1:4595/api/health
# {"ok":true,"data":{"version":"0.0.1"}}
```

Then open `http://127.0.0.1:4595` in your browser.

## 6. Configuration

Set these in the plist `EnvironmentVariables` dict or the unit's `Environment=` lines:

| Variable | Default | Purpose |
|---|---|---|
| `XDB_PORT` | `4595` | Port the server binds to |
| `XDB_HOST` | `127.0.0.1` | Bind address (localhost only by default — keep it that way unless you know why) |
| `XDB_DATA_DIR` | `~/.xdb` | Saved connections, history, backups, uploads |

State lives in `XDB_DATA_DIR`, outside the repo, so daily updates never touch your saved connections or backups.

## Notes

- **Update flow**: fetch → skip if dirty or already current → `merge --ff-only` → `pnpm install` → `pnpm build` → restart service. A dirty working tree or a non-fast-forward remote both abort safely with a log line.
- **Restart semantics**: the service serves `apps/web/dist/web`, so the restart after `pnpm build` is what actually picks up new code.
- **Timezone**: `StartCalendarInterval` and `OnCalendar` use the system local time.
