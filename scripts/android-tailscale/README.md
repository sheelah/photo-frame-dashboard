# android-tailscale: reach a rooted frame's ADB over Tailscale

Lets a frame live on an isolated guest or IoT Wi-Fi network and still be reachable for ADB.
The frame runs the static ARM build of `tailscaled` in userspace mode (no `/dev/net/tun`
needed), and `tailscale serve` forwards tailnet port 5555 to the local `adbd`. `adbd` itself
still listens on the LAN, unauthenticated and as root; the optional `adb-firewall.sh` drops
that so only the tailnet path is left.

Tested on a Dragon Touch Classic10 Charm (Android 6.0.1, Allwinner A33) with Tailscale
1.104.7. See [the device guide](../../docs/dragontouch-classic10-charm.md#adb-over-tailscale).

## Files

- `start.sh`: started at boot. Rotates `tailscaled.log` to `.log.1`, starts the watchdog,
  then runs `tailscaled --tun=userspace-networking --no-logs-no-support` with its state,
  socket and log in `/data/local/tailscale`. Exits if `tailscaled` is already running.
- `adb-watchdog.sh`: every 60 s, if nothing has listened on TCP 5555 for 15 s
  (`/proc/net/tcp` and `tcp6`), it sets `service.adb.tcp.port=5555` and restarts `adbd`.
  Logs to `/data/local/tailscale/adb-watchdog.log` (rotated at 64 KB). If `adb-firewall.sh`
  is installed and its rule has gone missing, it re-adds it.
- `adb-firewall.sh` (optional, install last): drops TCP 5555 on every interface except
  loopback, for IPv4 and IPv6, in an `adb_lan_block` chain at the top of `INPUT`. Tailnet ADB
  still works because `tailscale serve` connects to `127.0.0.1:5555`. `start.sh` runs it at
  boot when the file is present. Safe to run repeatedly.
- Optional: if `/data/local/tailscale/kioskwatch.sh` exists, `start.sh` starts it too. Copy it
  from [scripts/kioskwatch](../kioskwatch/README.md); this needs no extra `/system` change.

## Install (root ADB on the LAN, owner approval for each write)

```sh
# Download tailscale_<ver>_arm.tgz from pkgs.tailscale.com/stable/#static and check its sha256.
adb shell mkdir -p /data/local/tailscale
adb push tailscale_<ver>_arm/tailscale tailscale_<ver>_arm/tailscaled /data/local/tailscale/
adb push scripts/android-tailscale/start.sh scripts/android-tailscale/adb-watchdog.sh /data/local/tailscale/
adb shell 'chmod 700 /data/local/tailscale/*.sh'
```

Android has no `/etc/resolv.conf`, and Go needs one. On the Classic10 this meant adding
`/system/etc/resolv.conf` (`nameserver 1.1.1.1`, `nameserver 8.8.8.8`); `/system` must be
remounted read-write.

Start it once by hand, log in, and add the ADB forward (both persist in `state/`):

```sh
adb shell 'setsid sh /data/local/tailscale/start.sh &'
T='/data/local/tailscale/tailscale --socket=/data/local/tailscale/tailscaled.sock'
adb shell "$T up --hostname=<name> --accept-dns=false"     # prints a login URL
adb shell "$T serve --bg --tcp 5555 tcp://127.0.0.1:5555"
```

Boot hook: on the Classic10, init runs `/system/bin/install-recovery.sh` as root at every boot
(service `flash_recovery`). Keep a copy of the original, then add after its first line:

```sh
setsid sh /data/local/tailscale/start.sh &
```

Tag the node in the admin console (for example `tag:frame`) so its key doesn't expire, and give
it a grant like `members -> tag:frame tcp:5555` only, so the frame can't start connections into
the tailnet. Then `adb connect <tailnet-ip>:5555`.

### Block LAN ADB (last step, over the tailnet)

Only after `adb connect <tailnet-ip>:5555` works, and over that connection, so you aren't cut
off mid-install. Apply it for this boot only from `/data/local/tmp`, check that a fresh tailnet
connection still works, then copy it next to `start.sh` so it applies at every boot:

```sh
adb push scripts/android-tailscale/adb-firewall.sh /data/local/tmp/
adb shell sh /data/local/tmp/adb-firewall.sh
adb kill-server && adb connect <tailnet-ip>:5555 && adb shell id   # still works?
adb shell 'mv /data/local/tmp/adb-firewall.sh /data/local/tailscale/ && chmod 700 /data/local/tailscale/adb-firewall.sh'
adb shell iptables -S adb_lan_block   # ! -i lo -p tcp --dport 5555 -j DROP
```

If the tailnet check fails, reboot the frame: until the file is in `/data/local/tailscale`,
the rule is gone after a reboot.

## Troubleshooting

- `adb connect` says `offline` or `failed to connect` while `nc -z <tailnet-ip> 5555` works:
  first `adb kill-server` and connect again (the Mac's adb server gets stuck). Also check for
  another process restarting the adb server, such as a loop left over from an earlier session.
- After a Wi-Fi change, and after a reboot on the new network, ADB over the tailnet was
  `offline` for a while even though Tailscale pings, `--icmp` and `--peerapi` all answered and
  `adbd` was listening. It recovered on its own. Cause unknown; the watchdog doesn't detect it.
- A raw `CNXN` probe sent with `nc` got no reply even from a healthy `adbd` on this device,
  so the watchdog checks the listening socket instead of the handshake.
- Logs: `tailscaled.log` is the current boot, `tailscaled.log.1` the one before.

## Undo

To remove only the LAN ADB block: delete `/data/local/tailscale/adb-firewall.sh`, then
`for T in iptables ip6tables; do $T -D INPUT -j adb_lan_block; $T -F adb_lan_block; $T -X adb_lan_block; done`
(or reboot).

Put the original `install-recovery.sh` back, delete `/system/etc/resolv.conf` if you added it,
`rm -r /data/local/tailscale`, reboot, and remove the node from the admin console.
