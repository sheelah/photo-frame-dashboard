#!/system/bin/sh
# Restarts adbd when nothing listens on TCP 5555. adbd stopped listening after
# Wi-Fi changes (2026-11-15) while tailscaled stayed up. Started from start.sh.
D=/data/local/tailscale
L=$D/adb-watchdog.log
listening() {
  grep -qE '^ *[0-9]+: 0+:15B3 0+:0000 0A' /proc/net/tcp /proc/net/tcp6 2>/dev/null
}
log() {
  [ -f $L ] && [ $(wc -c < $L) -gt 65536 ] && mv $L $L.1
  echo "$(date '+%F %T') $*" >> $L
}
log "start"
sleep 120
while true; do
  if ! listening; then
    sleep 15
    if ! listening; then
      log "no listener on 5555 (init.svc.adbd=$(getprop init.svc.adbd), tcp.port=$(getprop service.adb.tcp.port)); restarting adbd"
      setprop service.adb.tcp.port 5555
      stop adbd
      sleep 2
      start adbd
      sleep 10
      listening && log "adbd listening again" || log "still no listener"
    fi
  fi
  sleep 60
done
