#!/system/bin/sh
# Drops TCP 5555 (root adbd, no auth) on every interface except loopback, so nothing on the
# Wi-Fi can reach ADB. `tailscale serve` (userspace mode) forwards tailnet 5555 to
# 127.0.0.1:5555, which arrives on lo and is still allowed. Safe to run repeatedly: run from
# start.sh at boot and by adb-watchdog.sh if the rule goes missing.
for T in iptables ip6tables; do
  [ -x /system/bin/$T ] || continue
  $T -N adb_lan_block 2>/dev/null
  $T -F adb_lan_block
  $T -A adb_lan_block ! -i lo -p tcp --dport 5555 -j DROP
  $T -C INPUT -j adb_lan_block 2>/dev/null || $T -I INPUT 1 -j adb_lan_block
done
