#!/bin/sh
# Add VPN routes through wireguard container if WIREGUARD_GATEWAY is set
# WIREGUARD_GATEWAY can be an IP or hostname (resolved via Docker DNS)
if [ -n "$WIREGUARD_GATEWAY" ]; then
  # Resolve hostname to IP if needed
  GW_IP=$(getent hosts "$WIREGUARD_GATEWAY" 2>/dev/null | awk '{print $1}')
  if [ -z "$GW_IP" ]; then
    GW_IP="$WIREGUARD_GATEWAY"
  fi
  ip route add 10.10.0.0/16 via "$GW_IP" 2>/dev/null || true
  echo "VPN route: 10.10.0.0/16 via $GW_IP ($WIREGUARD_GATEWAY)"
fi

# Drop to nobody and exec poller
exec su -s /bin/sh nobody -c "/usr/local/bin/poller"
