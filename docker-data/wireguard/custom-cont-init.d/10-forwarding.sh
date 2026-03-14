#!/bin/sh
# Enable forwarding between Docker network and WireGuard tunnel
# Idempotent: check before adding to prevent duplicates on restart
iptables -C FORWARD -i eth0 -o wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o wg0 -j ACCEPT
iptables -C FORWARD -i wg0 -o eth0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT

# Block cross-subnet traffic on wg0 (tenant isolation)
# Peers in 10.10.1.0/24 cannot reach peers in 10.10.2.0/24
iptables -C FORWARD -i wg0 -o wg0 -j DROP 2>/dev/null || iptables -A FORWARD -i wg0 -o wg0 -j DROP

# Block IPv6 forwarding on wg0 (prevent link-local bypass)
ip6tables -C FORWARD -i wg0 -j DROP 2>/dev/null || ip6tables -A FORWARD -i wg0 -j DROP

# NAT for return traffic
iptables -t nat -C POSTROUTING -o wg0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE

echo "WireGuard forwarding and tenant isolation rules applied"
