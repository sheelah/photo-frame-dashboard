#!/system/bin/sh
# Starts tailscaled in userspace mode. Launched at boot from /system/bin/install-recovery.sh.
D=/data/local/tailscale
export HOME=$D TMPDIR=/data/local/tmp
# Block ADB from the LAN before anything else; tailnet ADB arrives over loopback (adb-firewall.sh)
[ -f $D/adb-firewall.sh ] && sh $D/adb-firewall.sh
# Already running? (manual start or second invocation)
ps | grep -q '[/]data/local/tailscale/tailscaled' && exit 0
[ -f $D/tailscaled.log ] && mv $D/tailscaled.log $D/tailscaled.log.1
# Keep adbd listening on 5555 (see adb-watchdog.sh)
setsid sh $D/adb-watchdog.sh >/dev/null 2>&1 &
# Optional: rejoin Wi-Fi when Android gives up (see wifi-watchdog.sh)
[ -f $D/wifi-watchdog.sh ] && setsid sh $D/wifi-watchdog.sh >/dev/null 2>&1 &
# Optional: return to the kiosk from other screens (scripts/kioskwatch)
[ -f $D/kioskwatch.sh ] && setsid sh $D/kioskwatch.sh >/dev/null 2>&1 &
exec $D/tailscaled --tun=userspace-networking --statedir=$D/state \
  --socket=$D/tailscaled.sock --no-logs-no-support >$D/tailscaled.log 2>&1
