#!/system/bin/sh
# Gets the frame back onto Wi-Fi when Android gives up. On the Classic10 (ESP8089) the driver
# drops the link every few minutes; usually Android reconnects within ~40 s, but after a run of
# failed joins it disabled the network and sat offline for 2.5 h while still scanning
# (2026-11-22). Every 30 s this checks that wlan0 has an IPv4 address and, once the gateway has
# answered a ping, that it still does. After 2 min unhealthy it toggles Wi-Fi (svc wifi; the
# frame has no wpa_cli), again at 6 min, and after 15 min it reboots, but
# not again until Wi-Fi has been healthy once (so a dead router can't cause a reboot loop).
# Started from start.sh when present; delete the file to turn it off.
D=/data/local/tailscale
L=$D/wifi-watchdog.log
REBOOTED=$D/wifi-watchdog.rebooted   # present = we rebooted and Wi-Fi hasn't recovered since
log() {
  [ -f $L ] && [ $(wc -c < $L) -gt 65536 ] && mv $L $L.1
  echo "$(date '+%F %T') $*" >> $L
}
gateway() {
  set -- $(ip route show table wlan0 2>/dev/null | grep '^default')
  [ "$1" = default ] && [ "$2" = via ] && echo "$3"
}
has_ip() {
  ip -4 addr show wlan0 2>/dev/null | grep -q 'inet '
}
uptime_s() {
  set -- $(cat /proc/uptime)
  echo "${1%%.*}"
}
GW_PINGS=0   # 1 once the gateway has answered, so a gateway that drops ICMP never counts as down
healthy() {
  has_ip || return 1
  G=$(gateway)
  [ -n "$G" ] || return 1
  if ping -c 1 -W 3 "$G" >/dev/null 2>&1 || ping -c 1 -W 3 "$G" >/dev/null 2>&1; then
    GW_PINGS=1
    return 0
  fi
  [ $GW_PINGS = 0 ]
}
state() {
  echo "ip=$(has_ip && echo y || echo n) gw=$(gateway) wifi_on=$(settings get global wifi_on)" \
    "$(dumpsys wifi 2>/dev/null | grep '^mNetworkInfo' | cut -c1-110)"
}
log "start"
sleep 180
BAD=0      # seconds unhealthy
STEP=0     # last recovery step taken in this outage
while true; do
  if healthy; then
    [ $BAD -gt 0 ] && log "healthy again after ${BAD}s (step $STEP)"
    [ -f $REBOOTED ] && { log "healthy after a watchdog reboot"; rm -f $REBOOTED; }
    BAD=0; STEP=0
  else
    BAD=$((BAD + 30))
    [ $BAD = 30 ] && log "unhealthy: $(state)"
    if { [ $BAD -ge 120 ] && [ $STEP -lt 1 ]; } || { [ $BAD -ge 360 ] && [ $STEP -lt 2 ]; }; then
      STEP=$((STEP + 1))
      log "step $STEP: toggling Wi-Fi ($(state))"
      svc wifi disable
      sleep 5
      svc wifi enable
    elif [ $BAD -ge 900 ] && [ $STEP -lt 3 ]; then
      STEP=3
      if [ -f $REBOOTED ]; then
        log "step 3 skipped: already rebooted once for this outage"
      elif [ $(uptime_s) -lt 1800 ]; then
        log "step 3 skipped: uptime under 30 min"
      else
        log "step 3: rebooting ($(state))"
        touch $REBOOTED
        sync
        reboot
      fi
    fi
  fi
  sleep 30
done
