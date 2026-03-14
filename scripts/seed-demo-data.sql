-- =============================================================================
-- The Other Dude v9.0 — Demo Seed Data (Big Lebowski themed)
-- =============================================================================
-- Creates two tenants with realistic MikroTik device data for screenshots.
-- Run against a fresh database after migrations: psql -U postgres -d tod -f seed-demo-data.sql
-- Idempotent: uses ON CONFLICT DO NOTHING.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Super Admin user (NULL tenant_id, can see all tenants)
-- Password: screenshots2026
-- ---------------------------------------------------------------------------
INSERT INTO users (id, email, name, role, tenant_id, hashed_password, is_active, auth_version, must_upgrade_auth)
VALUES (
  '00000000-0000-4000-a000-000000000001',
  'dude@theotherdude.net',
  'The Admin',
  'super_admin',
  NULL,
  '$2b$12$5bRxXquoI126A5WKW2qy9eJNY6v8imR7UrKv3THMw3AMxMi/cWPHG',
  true, 1, false
) ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
INSERT INTO tenants (id, name, description, contact_email) VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Lebowski Lanes',      'Bowling alley network — 6 locations across LA',  'walter@lebowskilanes.com'),
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'The Stranger''s Ranch', 'Rural ranch network — high desert compound',     'stranger@ranch.net')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tenant users
-- ---------------------------------------------------------------------------
INSERT INTO users (id, email, name, role, tenant_id, hashed_password, is_active, auth_version) VALUES
  ('10000000-0000-4000-a000-000000000001', 'walter@lebowskilanes.com', 'Walter Sobchak', 'admin',    'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '$2b$12$5bRxXquoI126A5WKW2qy9eJNY6v8imR7UrKv3THMw3AMxMi/cWPHG', true, 1),
  ('10000000-0000-4000-a000-000000000002', 'maude@lebowskilanes.com',  'Maude Lebowski', 'operator', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '$2b$12$5bRxXquoI126A5WKW2qy9eJNY6v8imR7UrKv3THMw3AMxMi/cWPHG', true, 1),
  ('10000000-0000-4000-a000-000000000003', 'stranger@ranch.net',       'The Stranger',   'admin',    'b2c3d4e5-f6a7-8901-bcde-f12345678901', '$2b$12$5bRxXquoI126A5WKW2qy9eJNY6v8imR7UrKv3THMw3AMxMi/cWPHG', true, 1)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Devices — Lebowski Lanes (6 devices)
-- ---------------------------------------------------------------------------
INSERT INTO devices (id, tenant_id, hostname, ip_address, api_port, api_ssl_port, model, serial_number, firmware_version, routeros_version, uptime_seconds, last_seen, status, routeros_major_version, last_cpu_load, last_memory_used_pct, architecture, tls_mode) VALUES
  ('d0000000-0000-4000-a000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'The Dude', '10.10.1.1', 8728, 8729, 'RBD53iG-5HacD2HnD', 'HF109A24601', '7.16.2', '7.16.2',
   864000, NOW() - INTERVAL '30 seconds', 'online', 7, 12, 34, 'arm', 'tls'),

  ('d0000000-0000-4000-a000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'Walter', '10.10.1.2', 8728, 8729, 'RB5009UG+S+IN', 'HF109B37842', '7.16.2', '7.16.2',
   864000, NOW() - INTERVAL '25 seconds', 'online', 7, 18, 41, 'arm64', 'tls'),

  ('d0000000-0000-4000-a000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'Donny', '10.10.1.3', 8728, 8729, 'C52iG-5HaxD2HaxD-US', 'HF109C55103', '7.16.2', '7.16.2',
   432000, NOW() - INTERVAL '20 seconds', 'online', 7, 8, 28, 'arm', 'tls'),

  ('d0000000-0000-4000-a000-000000000004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'Maude', '10.10.1.4', 8728, 8729, 'CRS326-24G-2S+RM', 'HF109D78234', '7.16.2', '7.16.2',
   1728000, NOW() - INTERVAL '15 seconds', 'online', 7, 5, 22, 'arm', 'tls'),

  ('d0000000-0000-4000-a000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'Marmot', '10.10.1.5', 8728, 8729, 'RBcAPGi-5acD2nD', 'HF109E91456', '7.15.3', '7.15.3',
   2592000, NOW() - INTERVAL '40 seconds', 'online', 7, 15, 45, 'arm', 'tls'),

  ('d0000000-0000-4000-a000-000000000006', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'Brandt', '10.10.1.6', 8728, 8729, 'CRS309-1G-8S+IN', 'HF109F12678', '7.16.2', '7.16.2',
   1728000, NOW() - INTERVAL '10 seconds', 'online', 7, 3, 18, 'arm64', 'tls')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Devices — The Stranger's Ranch (2 devices)
-- ---------------------------------------------------------------------------
INSERT INTO devices (id, tenant_id, hostname, ip_address, api_port, api_ssl_port, model, serial_number, firmware_version, routeros_version, uptime_seconds, last_seen, status, routeros_major_version, last_cpu_load, last_memory_used_pct, architecture, tls_mode) VALUES
  ('d0000000-0000-4000-b000-000000000001', 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
   'The Stranger', '10.20.1.1', 8728, 8729, 'CCR2004-1G-12S+2XS', 'HF209A33901', '7.16.2', '7.16.2',
   3456000, NOW() - INTERVAL '20 seconds', 'online', 7, 22, 38, 'arm64', 'tls'),

  ('d0000000-0000-4000-b000-000000000002', 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
   'Bunny', '10.20.1.2', 8728, 8729, 'C52iG-5HaxD2HaxD-US', 'HF209B55102', '7.16.2', '7.16.2',
   432000, NOW() - INTERVAL '35 seconds', 'online', 7, 6, 24, 'arm', 'tls')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Device Groups
-- ---------------------------------------------------------------------------
INSERT INTO device_groups (id, tenant_id, name, description) VALUES
  ('a0000000-0000-4000-a000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Core Routers',    'Gateway and firewall devices'),
  ('a0000000-0000-4000-a000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Access Points',   'Wireless access points'),
  ('a0000000-0000-4000-a000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Switches',        'Layer 2/3 switches'),
  ('a0000000-0000-4000-b000-000000000001', 'b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Ranch Equipment', 'All ranch network gear')
ON CONFLICT DO NOTHING;

INSERT INTO device_group_memberships (device_id, group_id) VALUES
  ('d0000000-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-000000000001'),
  ('d0000000-0000-4000-a000-000000000002', 'a0000000-0000-4000-a000-000000000001'),
  ('d0000000-0000-4000-a000-000000000003', 'a0000000-0000-4000-a000-000000000002'),
  ('d0000000-0000-4000-a000-000000000005', 'a0000000-0000-4000-a000-000000000002'),
  ('d0000000-0000-4000-a000-000000000004', 'a0000000-0000-4000-a000-000000000003'),
  ('d0000000-0000-4000-a000-000000000006', 'a0000000-0000-4000-a000-000000000003'),
  ('d0000000-0000-4000-b000-000000000001', 'a0000000-0000-4000-b000-000000000001'),
  ('d0000000-0000-4000-b000-000000000002', 'a0000000-0000-4000-b000-000000000001')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Device Tags
-- ---------------------------------------------------------------------------
INSERT INTO device_tags (id, tenant_id, name, color) VALUES
  ('f1000000-0000-4000-a000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'production',    '#22c55e'),
  ('f1000000-0000-4000-a000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'needs-upgrade', '#f59e0b'),
  ('f1000000-0000-4000-a000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'critical',      '#ef4444'),
  ('f1000000-0000-4000-b000-000000000001', 'b2c3d4e5-f6a7-8901-bcde-f12345678901', 'outdoor',       '#3b82f6')
ON CONFLICT DO NOTHING;

INSERT INTO device_tag_assignments (device_id, tag_id) VALUES
  ('d0000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001'),
  ('d0000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000003'),
  ('d0000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000001'),
  ('d0000000-0000-4000-a000-000000000003', 'f1000000-0000-4000-a000-000000000001'),
  ('d0000000-0000-4000-a000-000000000005', 'f1000000-0000-4000-a000-000000000002'),
  ('d0000000-0000-4000-b000-000000000002', 'f1000000-0000-4000-b000-000000000001')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Notification Channels
-- ---------------------------------------------------------------------------
INSERT INTO notification_channels (id, tenant_id, name, channel_type, smtp_host, smtp_port, smtp_user, smtp_use_tls, from_address, to_address, webhook_url, slack_webhook_url) VALUES
  ('c1000000-0000-4000-a000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'Lanes Alert Email', 'email', 'smtp.lebowskilanes.com', 587, 'alerts@lebowskilanes.com', true, 'alerts@lebowskilanes.com', 'ops@lebowskilanes.com', NULL, NULL),
  ('c1000000-0000-4000-a000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'Lanes Slack', 'slack', NULL, NULL, NULL, false, NULL, NULL, NULL, 'https://hooks.slack.example.com/services/TXXXXXXXXX/BXXXXXXXXX/XXXXXXXXXXXXXXXXXXXXXXXX'),
  ('c1000000-0000-4000-a000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'PagerDuty Webhook', 'webhook', NULL, NULL, NULL, false, NULL, NULL, 'https://events.pagerduty.com/integration/abc123/enqueue', NULL),
  ('c1000000-0000-4000-b000-000000000001', 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
   'Ranch Alerts', 'email', 'smtp.ranch.net', 587, 'alerts@ranch.net', true, 'alerts@ranch.net', 'stranger@ranch.net', NULL, NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Alert Rules
-- ---------------------------------------------------------------------------
INSERT INTO alert_rules (id, tenant_id, name, metric, operator, threshold, duration_polls, severity, enabled) VALUES
  ('b1000000-0000-4000-a000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'High CPU',          'cpu_load',         '>', 80,  3, 'warning',  true),
  ('b1000000-0000-4000-a000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Critical CPU',      'cpu_load',         '>', 95,  2, 'critical', true),
  ('b1000000-0000-4000-a000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Memory Pressure',   'memory_used_pct',  '>', 85,  3, 'warning',  true),
  ('b1000000-0000-4000-a000-000000000004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Disk Full',         'disk_used_pct',    '>', 90,  1, 'critical', true),
  ('b1000000-0000-4000-a000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'High Temperature',  'temperature',      '>', 70,  2, 'warning',  true),
  ('b1000000-0000-4000-a000-000000000006', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Device Offline',    'device_status',    '=', 0,   1, 'critical', true),
  ('b1000000-0000-4000-b000-000000000001', 'b2c3d4e5-f6a7-8901-bcde-f12345678901', 'High CPU',          'cpu_load',         '>', 80,  3, 'warning',  true),
  ('b1000000-0000-4000-b000-000000000002', 'b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Device Offline',    'device_status',    '=', 0,   1, 'critical', true)
ON CONFLICT DO NOTHING;

-- Link rules to channels
INSERT INTO alert_rule_channels (rule_id, channel_id) VALUES
  ('b1000000-0000-4000-a000-000000000001', 'c1000000-0000-4000-a000-000000000001'),
  ('b1000000-0000-4000-a000-000000000002', 'c1000000-0000-4000-a000-000000000001'),
  ('b1000000-0000-4000-a000-000000000002', 'c1000000-0000-4000-a000-000000000002'),
  ('b1000000-0000-4000-a000-000000000003', 'c1000000-0000-4000-a000-000000000002'),
  ('b1000000-0000-4000-a000-000000000004', 'c1000000-0000-4000-a000-000000000003'),
  ('b1000000-0000-4000-a000-000000000006', 'c1000000-0000-4000-a000-000000000001'),
  ('b1000000-0000-4000-b000-000000000001', 'c1000000-0000-4000-b000-000000000001'),
  ('b1000000-0000-4000-b000-000000000002', 'c1000000-0000-4000-b000-000000000001')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Alert Events (recent activity)
-- ---------------------------------------------------------------------------
INSERT INTO alert_events (id, tenant_id, rule_id, device_id, severity, message, status, fired_at, resolved_at) VALUES
  ('e0000000-0000-4000-a000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'b1000000-0000-4000-a000-000000000001', 'd0000000-0000-4000-a000-000000000002',
   'warning', 'Walter CPU at 82% for 3 consecutive polls', 'resolved',
   NOW() - INTERVAL '4 hours', NOW() - INTERVAL '3 hours 45 minutes'),
  ('e0000000-0000-4000-a000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'b1000000-0000-4000-a000-000000000005', 'd0000000-0000-4000-a000-000000000005',
   'warning', 'Marmot temperature at 72C', 'resolved',
   NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour 50 minutes'),
  ('e0000000-0000-4000-a000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'b1000000-0000-4000-a000-000000000003', 'd0000000-0000-4000-a000-000000000005',
   'warning', 'Marmot memory at 87% — consider upgrade', 'firing',
   NOW() - INTERVAL '30 minutes', NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Health Metrics (2 hours of data at 60s intervals for all devices)
-- ---------------------------------------------------------------------------
INSERT INTO health_metrics (time, device_id, tenant_id, cpu_load, free_memory, total_memory, free_disk, total_disk, temperature)
SELECT
  ts,
  d.id,
  d.tenant_id,
  LEAST(100, GREATEST(0, d.last_cpu_load + (random() * 10 - 5)::int))::smallint,
  ((100 - d.last_memory_used_pct - (random() * 6 - 3)::int) * 10485760)::bigint,
  (1073741824)::bigint,
  (800000000 - (random() * 50000000)::bigint)::bigint,
  (1073741824)::bigint,
  CASE WHEN d.last_cpu_load > 10 THEN (40 + d.last_cpu_load / 3 + (random() * 4 - 2)::int)::smallint
       ELSE (38 + (random() * 3)::int)::smallint END
FROM generate_series(NOW() - INTERVAL '2 hours', NOW(), INTERVAL '60 seconds') AS ts
CROSS JOIN devices d;

-- ---------------------------------------------------------------------------
-- Interface Metrics (routers and switches)
-- ---------------------------------------------------------------------------
INSERT INTO interface_metrics (time, device_id, tenant_id, interface, rx_bytes, tx_bytes, rx_bps, tx_bps)
SELECT ts, 'd0000000-0000-4000-a000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  iface,
  (1000000000 + (extract(epoch from ts) * 125000)::bigint + (random() * 50000)::bigint)::bigint,
  (500000000 + (extract(epoch from ts) * 62500)::bigint + (random() * 25000)::bigint)::bigint,
  CASE WHEN iface = 'ether1' THEN (1000000 + (random() * 500000)::bigint)
       ELSE (500000 + (random() * 250000)::bigint) END,
  CASE WHEN iface = 'ether1' THEN (500000 + (random() * 250000)::bigint)
       ELSE (250000 + (random() * 125000)::bigint) END
FROM generate_series(NOW() - INTERVAL '2 hours', NOW(), INTERVAL '60 seconds') AS ts
CROSS JOIN (VALUES ('ether1'), ('bridge1')) AS ifaces(iface);

INSERT INTO interface_metrics (time, device_id, tenant_id, interface, rx_bytes, tx_bytes, rx_bps, tx_bps)
SELECT ts, 'd0000000-0000-4000-a000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  iface,
  (2000000000 + (extract(epoch from ts) * 250000)::bigint + (random() * 100000)::bigint)::bigint,
  (1000000000 + (extract(epoch from ts) * 125000)::bigint + (random() * 50000)::bigint)::bigint,
  (2000000 + (random() * 1000000)::bigint),
  (1000000 + (random() * 500000)::bigint)
FROM generate_series(NOW() - INTERVAL '2 hours', NOW(), INTERVAL '60 seconds') AS ts
CROSS JOIN (VALUES ('ether1'), ('sfp-sfpplus1')) AS ifaces(iface);

INSERT INTO interface_metrics (time, device_id, tenant_id, interface, rx_bytes, tx_bytes, rx_bps, tx_bps)
SELECT ts, 'd0000000-0000-4000-b000-000000000001', 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  iface,
  (500000000 + (extract(epoch from ts) * 62500)::bigint + (random() * 25000)::bigint)::bigint,
  (250000000 + (extract(epoch from ts) * 31250)::bigint + (random() * 12500)::bigint)::bigint,
  (500000 + (random() * 250000)::bigint),
  (250000 + (random() * 125000)::bigint)
FROM generate_series(NOW() - INTERVAL '2 hours', NOW(), INTERVAL '60 seconds') AS ts
CROSS JOIN (VALUES ('ether1'), ('sfp-sfpplus1')) AS ifaces(iface);

-- ---------------------------------------------------------------------------
-- Wireless Metrics (APs: Donny, Marmot, Bunny)
-- ---------------------------------------------------------------------------
INSERT INTO wireless_metrics (time, device_id, tenant_id, interface, client_count, avg_signal, ccq, frequency)
SELECT ts, 'd0000000-0000-4000-a000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  iface,
  CASE WHEN iface = 'wlan1' THEN (12 + (random() * 6)::int)::smallint
       ELSE (8 + (random() * 4)::int)::smallint END,
  CASE WHEN iface = 'wlan1' THEN (-55 + (random() * 10 - 5)::int)::smallint
       ELSE (-62 + (random() * 8 - 4)::int)::smallint END,
  (85 + (random() * 10)::int)::smallint,
  CASE WHEN iface = 'wlan1' THEN 2437 ELSE 5745 END
FROM generate_series(NOW() - INTERVAL '2 hours', NOW(), INTERVAL '60 seconds') AS ts
CROSS JOIN (VALUES ('wlan1'), ('wlan2')) AS ifaces(iface);

INSERT INTO wireless_metrics (time, device_id, tenant_id, interface, client_count, avg_signal, ccq, frequency)
SELECT ts, 'd0000000-0000-4000-a000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'wlan1', (6 + (random() * 4)::int)::smallint, (-60 + (random() * 8 - 4)::int)::smallint,
  (78 + (random() * 12)::int)::smallint, 2462
FROM generate_series(NOW() - INTERVAL '2 hours', NOW(), INTERVAL '60 seconds') AS ts;

INSERT INTO wireless_metrics (time, device_id, tenant_id, interface, client_count, avg_signal, ccq, frequency)
SELECT ts, 'd0000000-0000-4000-b000-000000000002', 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  iface,
  CASE WHEN iface = 'wlan1' THEN (3 + (random() * 3)::int)::smallint
       ELSE (2 + (random() * 2)::int)::smallint END,
  CASE WHEN iface = 'wlan1' THEN (-50 + (random() * 6 - 3)::int)::smallint
       ELSE (-58 + (random() * 6 - 3)::int)::smallint END,
  (88 + (random() * 8)::int)::smallint,
  CASE WHEN iface = 'wlan1' THEN 2412 ELSE 5180 END
FROM generate_series(NOW() - INTERVAL '2 hours', NOW(), INTERVAL '60 seconds') AS ts
CROSS JOIN (VALUES ('wlan1'), ('wlan2')) AS ifaces(iface);

COMMIT;
