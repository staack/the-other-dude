#!/usr/bin/env python3
"""Seed TOD database with 90s movie-themed demo data for screenshots.

Creates multiple tenants with realistic MikroTik devices, health metrics,
interface traffic, alert rules, and triggered alerts. All data is movie-themed
with The Big Lebowski as the primary tenant.

Usage:
    docker exec tod_postgres psql -U postgres -d tod_screenshots < seed_demo.sql
    -- OR --
    python3 seed_demo_data.py | docker exec -i tod_postgres psql -U postgres -d tod_screenshots

This script generates SQL. Pipe it into psql.
"""

import random
import uuid
from datetime import datetime, timedelta, timezone

now = datetime.now(timezone.utc)

# ── Tenants ──────────────────────────────────────────────────────────────────

tenants = [
    {"id": str(uuid.uuid4()), "name": "Lebowski Lanes", "desc": "The Dude's bowling alley network — the rug really ties the room together"},
    {"id": str(uuid.uuid4()), "name": "The Stranger's Ranch", "desc": "Sam Elliott's cowboy operation — sometimes there's a man"},
    {"id": str(uuid.uuid4()), "name": "Maude's Gallery", "desc": "Maude Lebowski's art studio and exhibition network"},
    {"id": str(uuid.uuid4()), "name": "Jackie Treehorn Productions", "desc": "Jackie Treehorn's Malibu beach house production network"},
    {"id": str(uuid.uuid4()), "name": "Sobchak Security", "desc": "Walter's security consulting firm — am I wrong?"},
]

# ── MikroTik Models ──────────────────────────────────────────────────────────

models = {
    "core": [
        ("CCR2004-1G-12S+2XS", "tile", "7.16.2", "arm64"),
        ("CCR2116-12G-4S+", "tile", "7.16.2", "tile"),
        ("CCR1036-8G-2S+", "tile", "7.15.3", "tile"),
        ("RB5009UG+S+IN", "arm64", "7.16.2", "arm64"),
    ],
    "switch": [
        ("CRS326-24G-2S+RM", "arm", "7.16.2", "arm"),
        ("CRS328-24P-4S+RM", "arm", "7.15.3", "arm"),
        ("CRS312-4C+8XG-RM", "arm", "7.16.2", "arm"),
        ("CRS354-48G-4S+2Q+RM", "arm", "7.16.1", "arm"),
    ],
    "ap": [
        ("cAP ax", "arm64", "7.16.2", "arm64"),
        ("hAP ax3", "arm64", "7.16.2", "arm64"),
        ("hAP ax2", "arm", "7.16.2", "arm"),
        ("cAP ac", "arm", "7.15.3", "arm"),
        ("wAP ac", "arm", "7.16.2", "arm"),
    ],
    "router": [
        ("hEX S", "mmips", "7.16.2", "mipsbe"),
        ("hEX", "mmips", "7.15.3", "mipsbe"),
        ("RB4011iGS+5HacQ2HnD-IN", "arm64", "7.16.2", "arm64"),
        ("RB3011UiAS-RM", "arm", "7.16.1", "arm"),
    ],
    "outdoor": [
        ("SXTsq 5 ac", "arm", "7.16.2", "arm"),
        ("LHG XL 5 ac", "arm", "7.15.3", "arm"),
        ("NetMetal ac2", "arm", "7.16.2", "arm"),
    ],
}

# ── Device Names per Tenant ──────────────────────────────────────────────────

device_templates = {
    "Lebowski Lanes": {
        "core": ["dude-core-01", "dude-core-02"],
        "switch": ["lanes-sw-{:02d}".format(i) for i in range(1, 7)],
        "ap": ["bowling-ap-{:02d}".format(i) for i in range(1, 13)] + ["bar-ap-{:02d}".format(i) for i in range(1, 5)],
        "router": ["dude-gw-01", "dude-gw-02", "donny-edge-01", "walter-edge-01", "maude-edge-01"],
        "outdoor": ["parking-ptp-01", "parking-ptp-02", "roof-backhaul-01"],
    },
    "The Stranger's Ranch": {
        "core": ["stranger-core-01"],
        "switch": ["ranch-sw-{:02d}".format(i) for i in range(1, 5)],
        "ap": ["barn-ap-{:02d}".format(i) for i in range(1, 7)] + ["lodge-ap-{:02d}".format(i) for i in range(1, 4)],
        "router": ["stranger-gw-01", "ranch-edge-01", "trail-edge-01"],
        "outdoor": ["pasture-ptp-01", "pasture-ptp-02", "hilltop-backhaul-01", "creek-ptp-01"],
    },
    "Maude's Gallery": {
        "core": ["maude-core-01"],
        "switch": ["gallery-sw-{:02d}".format(i) for i in range(1, 4)],
        "ap": ["exhibit-ap-{:02d}".format(i) for i in range(1, 9)] + ["studio-ap-{:02d}".format(i) for i in range(1, 3)],
        "router": ["maude-gw-01", "gallery-edge-01"],
        "outdoor": ["sculpture-garden-ptp-01"],
    },
    "Jackie Treehorn Productions": {
        "core": ["treehorn-core-01", "treehorn-core-02"],
        "switch": ["malibu-sw-{:02d}".format(i) for i in range(1, 6)],
        "ap": ["beach-ap-{:02d}".format(i) for i in range(1, 11)] + ["studio-ap-{:02d}".format(i) for i in range(1, 6)],
        "router": ["treehorn-gw-01", "treehorn-gw-02", "cabana-edge-01", "pool-edge-01"],
        "outdoor": ["beach-ptp-01", "beach-ptp-02", "cliff-backhaul-01"],
    },
    "Sobchak Security": {
        "core": ["sobchak-core-01"],
        "switch": ["hq-sw-{:02d}".format(i) for i in range(1, 4)],
        "ap": ["office-ap-{:02d}".format(i) for i in range(1, 7)] + ["warehouse-ap-{:02d}".format(i) for i in range(1, 4)],
        "router": ["walter-gw-01", "smokey-edge-01", "vietnam-edge-01"],
        "outdoor": ["yard-ptp-01", "perimeter-ptp-01"],
    },
}

# ── Coordinate clusters for geographic map ────────────────────────────────────

geo_clusters = {
    "Lebowski Lanes": (34.0195, -118.4912),    # LA / Venice Beach area
    "The Stranger's Ranch": (35.3733, -118.9742),  # Bakersfield area
    "Maude's Gallery": (34.0522, -118.2437),    # Downtown LA
    "Jackie Treehorn Productions": (34.0259, -118.7798),  # Malibu
    "Sobchak Security": (34.1808, -118.3090),   # Burbank
}

# ── SQL Generation ───────────────────────────────────────────────────────────

sql_lines = []

def q(s):
    """SQL-escape a string."""
    return s.replace("'", "''")

def emit(line):
    sql_lines.append(line)

emit("-- TOD Demo Data Seed — 90s Movie Themed")
emit("-- Generated for screenshot purposes")
emit("BEGIN;")
emit("")

# Clean existing demo data (keep system tenant)
emit("-- Clean slate (preserve system tenant and existing users)")
emit("DELETE FROM health_metrics;")
emit("DELETE FROM interface_metrics;")
emit("DELETE FROM wireless_metrics;")
emit("DELETE FROM alert_events;")
emit("DELETE FROM alert_rule_channels;")
emit("DELETE FROM alert_rules;")
emit("DELETE FROM notification_channels;")
emit("DELETE FROM config_templates;")
emit("DELETE FROM config_template_tags;")
emit("DELETE FROM device_tag_assignments;")
emit("DELETE FROM device_tags;")
emit("DELETE FROM device_group_memberships;")
emit("DELETE FROM device_groups;")
emit("DELETE FROM vpn_peers;")
emit("DELETE FROM vpn_config;")
emit("DELETE FROM devices WHERE tenant_id NOT IN (SELECT id FROM tenants WHERE name = 'System (Internal)');")
emit("DO $$ BEGIN DELETE FROM user_tenants WHERE tenant_id NOT IN (SELECT id FROM tenants WHERE name = 'System (Internal)'); EXCEPTION WHEN undefined_table THEN NULL; END $$;")
emit("DELETE FROM tenants WHERE name != 'System (Internal)';")
emit("")

# Create tenants
emit("-- Tenants")
for t in tenants:
    emit(f"INSERT INTO tenants (id, name, description) VALUES ('{t['id']}', '{q(t['name'])}', '{q(t['desc'])}');")
emit("")

# Generate devices
all_devices = []  # (device_dict, tenant_id)
emit("-- Devices")

for t in tenants:
    tname = t["name"]
    tid = t["id"]
    templates = device_templates[tname]
    base_lat, base_lon = geo_clusters[tname]
    subnet_base = random.randint(1, 200)

    for role, hostnames in templates.items():
        model_list = models[role]
        for hostname in hostnames:
            dev_id = str(uuid.uuid4())
            model_info = random.choice(model_list)
            model_name, arch, fw_ver, _ = model_info

            # Generate realistic IP
            ip = f"10.{subnet_base}.{random.randint(1,254)}.{random.randint(2,254)}"

            # Status: 85% online, 10% degraded, 5% offline
            r = random.random()
            if r < 0.85:
                status = "online"
            elif r < 0.95:
                status = "degraded"
            else:
                status = "offline"

            # Uptime: 1 hour to 90 days
            uptime = random.randint(3600, 7776000)

            # Last seen: online=recent, degraded=minutes ago, offline=hours ago
            if status == "online":
                last_seen = now - timedelta(seconds=random.randint(5, 60))
            elif status == "degraded":
                last_seen = now - timedelta(minutes=random.randint(2, 15))
            else:
                last_seen = now - timedelta(hours=random.randint(1, 48))

            # CPU/memory snapshots
            cpu = random.randint(5, 45) if status == "online" else (random.randint(60, 95) if status == "degraded" else 0)
            mem_pct = random.randint(20, 65) if status == "online" else (random.randint(70, 95) if status == "degraded" else 0)

            # Geo: scatter around cluster center
            lat = base_lat + random.uniform(-0.02, 0.02)
            lon = base_lon + random.uniform(-0.02, 0.02)

            # RouterOS major version
            ros_major = int(fw_ver.split(".")[0])

            dev = {
                "id": dev_id, "tenant_id": tid, "hostname": hostname,
                "ip": ip, "model": model_name, "firmware": fw_ver,
                "arch": arch, "status": status, "uptime": uptime,
                "last_seen": last_seen, "cpu": cpu, "mem_pct": mem_pct,
                "lat": lat, "lon": lon, "ros_major": ros_major, "role": role,
            }
            all_devices.append(dev)

            emit(f"INSERT INTO devices (id, tenant_id, hostname, ip_address, model, firmware_version, routeros_version, architecture, status, uptime_seconds, last_seen, last_cpu_load, last_memory_used_pct, latitude, longitude, routeros_major_version) VALUES ('{dev_id}', '{tid}', '{q(hostname)}', '{ip}', '{q(model_name)}', '{fw_ver}', '{fw_ver}', '{arch}', '{status}', {uptime}, '{last_seen.isoformat()}', {cpu}, {mem_pct}, {lat:.6f}, {lon:.6f}, {ros_major});")

emit("")
emit(f"-- Total devices: {len(all_devices)}")
emit("")

# Health metrics — 48 hours of data, every 5 minutes per device
emit("-- Health metrics (48h, 5-minute intervals)")
for dev in all_devices:
    if dev["status"] == "offline":
        # Only generate data up to when device went offline
        hours_offline = random.randint(1, 48)
        data_end = now - timedelta(hours=hours_offline)
    else:
        data_end = now

    # Generate every 5 minutes for 48 hours = 576 points per device
    # That's too much SQL — do every 15 minutes = 192 points
    t_cursor = data_end - timedelta(hours=48)
    base_cpu = random.randint(8, 30)
    base_mem_free_pct = random.uniform(0.35, 0.70)

    if dev["model"].startswith("CCR"):
        total_mem = 4 * 1024 * 1024 * 1024  # 4GB
        total_disk = 512 * 1024 * 1024       # 512MB
    elif dev["model"].startswith("RB5009"):
        total_mem = 1024 * 1024 * 1024       # 1GB
        total_disk = 1024 * 1024 * 1024      # 1GB
    elif dev["model"].startswith("CRS"):
        total_mem = 512 * 1024 * 1024        # 512MB
        total_disk = 128 * 1024 * 1024
    else:
        total_mem = 256 * 1024 * 1024        # 256MB
        total_disk = 128 * 1024 * 1024

    while t_cursor <= data_end:
        # Add some daily pattern: higher CPU during business hours
        hour = t_cursor.hour
        if 9 <= hour <= 17:
            cpu_bump = random.randint(5, 20)
        elif 18 <= hour <= 22:
            cpu_bump = random.randint(2, 10)
        else:
            cpu_bump = 0

        cpu = min(95, base_cpu + cpu_bump + random.randint(-5, 5))
        free_mem = int(total_mem * (base_mem_free_pct + random.uniform(-0.05, 0.05)))
        free_disk = int(total_disk * random.uniform(0.3, 0.7))
        temp = random.randint(38, 58)

        emit(f"INSERT INTO health_metrics (time, device_id, tenant_id, cpu_load, free_memory, total_memory, free_disk, total_disk, temperature) VALUES ('{t_cursor.isoformat()}', '{dev['id']}', '{dev['tenant_id']}', {cpu}, {free_mem}, {total_mem}, {free_disk}, {total_disk}, {temp});")
        t_cursor += timedelta(minutes=15)

emit("")

# Interface metrics — 48 hours, every 15 minutes
emit("-- Interface metrics (48h, 15-minute intervals)")

interfaces_by_role = {
    "core": ["ether1", "ether2", "sfp-sfpplus1", "sfp-sfpplus2"],
    "switch": ["ether1", "ether2", "ether3", "sfp-sfpplus1"],
    "ap": ["ether1", "wlan1", "wlan2"],
    "router": ["ether1", "ether2", "ether3"],
    "outdoor": ["ether1", "wlan1"],
}

for dev in all_devices:
    if dev["status"] == "offline":
        hours_offline = random.randint(1, 48)
        data_end = now - timedelta(hours=hours_offline)
    else:
        data_end = now

    ifaces = interfaces_by_role.get(dev["role"], ["ether1"])
    t_cursor = data_end - timedelta(hours=48)

    while t_cursor <= data_end:
        hour = t_cursor.hour
        # Traffic pattern: higher during business hours
        if 9 <= hour <= 17:
            traffic_mult = random.uniform(0.6, 1.0)
        elif 18 <= hour <= 22:
            traffic_mult = random.uniform(0.3, 0.7)
        else:
            traffic_mult = random.uniform(0.05, 0.3)

        for iface in ifaces:
            if iface.startswith("wlan"):
                base_bps = 50_000_000  # 50Mbps base for wireless
            elif iface.startswith("sfp"):
                base_bps = 500_000_000  # 500Mbps base for SFP
            else:
                base_bps = 100_000_000  # 100Mbps base for ethernet

            rx_bps = int(base_bps * traffic_mult * random.uniform(0.3, 1.0))
            tx_bps = int(base_bps * traffic_mult * random.uniform(0.2, 0.8))
            rx_bytes = rx_bps * 900  # 15 min in seconds
            tx_bytes = tx_bps * 900

            emit(f"INSERT INTO interface_metrics (time, device_id, tenant_id, interface, rx_bytes, tx_bytes, rx_bps, tx_bps) VALUES ('{t_cursor.isoformat()}', '{dev['id']}', '{dev['tenant_id']}', '{iface}', {rx_bytes}, {tx_bytes}, {rx_bps}, {tx_bps});")

        t_cursor += timedelta(minutes=15)

emit("")

# Alert rules and events
emit("-- Alert rules")
for t in tenants:
    tid = t["id"]
    rules = [
        (str(uuid.uuid4()), "CPU High", "cpu_load", ">", 80, "warning"),
        (str(uuid.uuid4()), "CPU Critical", "cpu_load", ">", 95, "critical"),
        (str(uuid.uuid4()), "Memory Low", "memory_used_pct", ">", 90, "warning"),
        (str(uuid.uuid4()), "Device Offline", "status", "=", 0, "critical"),
        (str(uuid.uuid4()), "High Temperature", "temperature", ">", 65, "warning"),
    ]
    for rid, name, metric, op, thresh, sev in rules:
        emit(f"INSERT INTO alert_rules (id, tenant_id, name, metric, operator, threshold, severity, enabled) VALUES ('{rid}', '{tid}', '{q(name)}', '{metric}', '{op}', {thresh}, '{sev}', true);")

    # Generate some fired alerts for degraded/offline devices in this tenant
    tenant_devices = [d for d in all_devices if d["tenant_id"] == tid]
    for dev in tenant_devices:
        hostname_escaped = q(dev["hostname"])
        dev_id = dev["id"]
        if dev["status"] == "degraded":
            rule = rules[0]
            cpu_val = random.randint(81, 94)
            fired_at = (now - timedelta(minutes=random.randint(5, 120))).isoformat()
            msg = f"CPU load exceeded 80% on {hostname_escaped}"
            emit(f"INSERT INTO alert_events (device_id, tenant_id, rule_id, status, severity, metric, value, threshold, message, fired_at) VALUES ('{dev_id}', '{tid}', '{rule[0]}', 'firing', 'warning', 'cpu_load', {cpu_val}, 80, '{msg}', '{fired_at}');")
        elif dev["status"] == "offline":
            rule = rules[3]
            fired_at = (now - timedelta(hours=random.randint(1, 24))).isoformat()
            msg = f"{hostname_escaped} is offline"
            emit(f"INSERT INTO alert_events (device_id, tenant_id, rule_id, status, severity, metric, value, threshold, message, fired_at) VALUES ('{dev_id}', '{tid}', '{rule[0]}', 'firing', 'critical', 'status', 0, 0, '{msg}', '{fired_at}');")

    # A few resolved alerts
    for _ in range(random.randint(3, 8)):
        dev = random.choice(tenant_devices)
        rule = random.choice(rules[:3])
        fired = now - timedelta(hours=random.randint(6, 72))
        resolved = fired + timedelta(minutes=random.randint(5, 120))
        hostname_escaped = q(dev["hostname"])
        rule_name = q(rule[1])
        val = random.randint(int(rule[4])+1, int(rule[4])+20)
        msg = f"{rule_name} on {hostname_escaped}"
        emit(f"INSERT INTO alert_events (device_id, tenant_id, rule_id, status, severity, metric, value, threshold, message, fired_at, resolved_at) VALUES ('{dev['id']}', '{tid}', '{rule[0]}', 'resolved', '{rule[5]}', '{rule[2]}', {val}, {rule[4]}, '{msg}', '{fired.isoformat()}', '{resolved.isoformat()}');")

emit("")

# Device tags
emit("-- Device tags")
tag_names = ["core", "distribution", "access", "outdoor", "wireless", "managed", "critical", "monitoring"]
for t in tenants:
    for tag in tag_names:
        tag_id = str(uuid.uuid4())
        emit(f"INSERT INTO device_tags (id, tenant_id, name) VALUES ('{tag_id}', '{t['id']}', '{tag}');")

emit("")

# Notification channels
emit("-- Notification channels")
for t in tenants:
    ch_id = str(uuid.uuid4())
    emit(f"INSERT INTO notification_channels (id, tenant_id, name, channel_type, webhook_url) VALUES ('{ch_id}', '{t['id']}', 'Slack Alerts', 'webhook', 'https://hooks.slack.com/services/DEMO/DEMO/demo');")
    ch_id2 = str(uuid.uuid4())
    noc_domain = t["name"].lower().replace(" ", "").replace("'", "")
    emit(f"INSERT INTO notification_channels (id, tenant_id, name, channel_type, to_address, from_address) VALUES ('{ch_id2}', '{t['id']}', 'Email NOC', 'email', 'noc@{noc_domain}.net', 'alerts@theotherdude.net');")

emit("")

# Config templates
emit("-- Config templates")
template_data = [
    ("Base Security Hardening", "/ip firewall filter\nadd chain=input action=drop protocol=tcp dst-port=23 comment=\"Block Telnet\"\nadd chain=input action=drop protocol=tcp dst-port=20-21 comment=\"Block FTP\"\n/ip service\nset telnet disabled=yes\nset ftp disabled=yes\n"),
    ("SNMP Monitoring Setup", "/snmp\nset enabled=yes contact=\"{{ contact_email }}\" location=\"{{ location }}\"\n/snmp community\nadd name={{ community }} addresses={{ allowed_network }} security=none\n"),
    ("NTP Configuration", "/system ntp client\nset enabled=yes\n/system ntp client servers\nadd address=time.google.com\nadd address=time.cloudflare.com\n"),
]

for t in tenants:
    for tpl_name, tpl_content in template_data:
        tpl_id = str(uuid.uuid4())
        emit(f"INSERT INTO config_templates (id, tenant_id, name, content, created_at) VALUES ('{tpl_id}', '{t['id']}', '{q(tpl_name)}', '{q(tpl_content)}', '{now.isoformat()}');")

emit("")
emit("COMMIT;")
emit("")
emit(f"-- Summary: {len(tenants)} tenants, {len(all_devices)} devices")

# Output
print("\n".join(sql_lines))
