"""Seed starter config templates for tenants missing them.

Revision ID: 012
Revises: 010
Create Date: 2026-03-02

Re-seeds the 4 original starter templates from 006 plus a new comprehensive
'Basic Router' template for any tenants created after migration 006 ran.
Uses ON CONFLICT (tenant_id, name) DO NOTHING so existing templates are untouched.
"""

revision = "012"
down_revision = "010"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Basic Router — comprehensive starter for a typical SOHO/branch router
    conn.execute(
        sa.text("""
        INSERT INTO config_templates (id, tenant_id, name, description, content, variables)
        SELECT
            gen_random_uuid(),
            t.id,
            'Basic Router',
            'Complete SOHO/branch router setup: WAN on ether1, LAN bridge, DHCP, DNS, NAT, basic firewall',
            '/interface bridge add name=bridge-lan comment="LAN bridge"
/interface bridge port add bridge=bridge-lan interface=ether2
/interface bridge port add bridge=bridge-lan interface=ether3
/interface bridge port add bridge=bridge-lan interface=ether4
/interface bridge port add bridge=bridge-lan interface=ether5

# WAN — DHCP client on ether1
/ip dhcp-client add interface={{ wan_interface }} disabled=no comment="WAN uplink"

# LAN address
/ip address add address={{ lan_gateway }}/{{ lan_cidr }} interface=bridge-lan

# DNS
/ip dns set servers={{ dns_servers }} allow-remote-requests=yes

# DHCP server for LAN
/ip pool add name=lan-pool ranges={{ dhcp_start }}-{{ dhcp_end }}
/ip dhcp-server network add address={{ lan_network }}/{{ lan_cidr }} gateway={{ lan_gateway }} dns-server={{ lan_gateway }}
/ip dhcp-server add name=lan-dhcp interface=bridge-lan address-pool=lan-pool disabled=no

# NAT masquerade
/ip firewall nat add chain=srcnat out-interface={{ wan_interface }} action=masquerade

# Firewall — input chain
/ip firewall filter
add chain=input connection-state=established,related action=accept
add chain=input connection-state=invalid action=drop
add chain=input in-interface={{ wan_interface }} action=drop comment="Drop all other WAN input"

# Firewall — forward chain
add chain=forward connection-state=established,related action=accept
add chain=forward connection-state=invalid action=drop
add chain=forward in-interface=bridge-lan out-interface={{ wan_interface }} action=accept comment="Allow LAN to WAN"
add chain=forward action=drop comment="Drop everything else"

# NTP
/system ntp client set enabled=yes servers={{ ntp_server }}

# Identity
/system identity set name={{ device.hostname }}',
            '[{"name":"wan_interface","type":"string","default":"ether1","description":"WAN-facing interface"},{"name":"lan_gateway","type":"ip","default":"192.168.88.1","description":"LAN gateway IP"},{"name":"lan_cidr","type":"integer","default":"24","description":"LAN subnet mask bits"},{"name":"lan_network","type":"ip","default":"192.168.88.0","description":"LAN network address"},{"name":"dhcp_start","type":"ip","default":"192.168.88.100","description":"DHCP pool start"},{"name":"dhcp_end","type":"ip","default":"192.168.88.254","description":"DHCP pool end"},{"name":"dns_servers","type":"string","default":"8.8.8.8,8.8.4.4","description":"Upstream DNS servers"},{"name":"ntp_server","type":"string","default":"pool.ntp.org","description":"NTP server"}]'::jsonb
        FROM tenants t
        WHERE NOT EXISTS (
            SELECT 1 FROM config_templates ct
            WHERE ct.tenant_id = t.id AND ct.name = 'Basic Router'
        )
    """)
    )

    # 2. Re-seed Basic Firewall (for tenants missing it)
    conn.execute(
        sa.text("""
        INSERT INTO config_templates (id, tenant_id, name, description, content, variables)
        SELECT
            gen_random_uuid(),
            t.id,
            'Basic Firewall',
            'Standard firewall ruleset with WAN protection and LAN forwarding',
            '/ip firewall filter
add chain=input connection-state=established,related action=accept
add chain=input connection-state=invalid action=drop
add chain=input in-interface={{ wan_interface }} protocol=tcp dst-port=8291 action=drop comment="Block Winbox from WAN"
add chain=input in-interface={{ wan_interface }} protocol=tcp dst-port=22 action=drop comment="Block SSH from WAN"
add chain=forward connection-state=established,related action=accept
add chain=forward connection-state=invalid action=drop
add chain=forward src-address={{ allowed_network }} action=accept
add chain=forward action=drop',
            '[{"name":"wan_interface","type":"string","default":"ether1","description":"WAN-facing interface"},{"name":"allowed_network","type":"subnet","default":"192.168.88.0/24","description":"Allowed source network"}]'::jsonb
        FROM tenants t
        WHERE NOT EXISTS (
            SELECT 1 FROM config_templates ct
            WHERE ct.tenant_id = t.id AND ct.name = 'Basic Firewall'
        )
    """)
    )

    # 3. Re-seed DHCP Server Setup
    conn.execute(
        sa.text("""
        INSERT INTO config_templates (id, tenant_id, name, description, content, variables)
        SELECT
            gen_random_uuid(),
            t.id,
            'DHCP Server Setup',
            'Configure DHCP server with address pool, DNS, and gateway',
            '/ip pool add name=dhcp-pool ranges={{ pool_start }}-{{ pool_end }}
/ip dhcp-server network add address={{ gateway }}/24 gateway={{ gateway }} dns-server={{ dns_server }}
/ip dhcp-server add name=dhcp1 interface={{ interface }} address-pool=dhcp-pool disabled=no',
            '[{"name":"pool_start","type":"ip","default":"192.168.88.100","description":"DHCP pool start address"},{"name":"pool_end","type":"ip","default":"192.168.88.254","description":"DHCP pool end address"},{"name":"gateway","type":"ip","default":"192.168.88.1","description":"Default gateway"},{"name":"dns_server","type":"ip","default":"8.8.8.8","description":"DNS server address"},{"name":"interface","type":"string","default":"bridge-lan","description":"Interface to serve DHCP on"}]'::jsonb
        FROM tenants t
        WHERE NOT EXISTS (
            SELECT 1 FROM config_templates ct
            WHERE ct.tenant_id = t.id AND ct.name = 'DHCP Server Setup'
        )
    """)
    )

    # 4. Re-seed Wireless AP Config
    conn.execute(
        sa.text("""
        INSERT INTO config_templates (id, tenant_id, name, description, content, variables)
        SELECT
            gen_random_uuid(),
            t.id,
            'Wireless AP Config',
            'Configure wireless access point with WPA2 security',
            '/interface wireless security-profiles add name=portal-wpa2 mode=dynamic-keys authentication-types=wpa2-psk wpa2-pre-shared-key={{ password }}
/interface wireless set wlan1 mode=ap-bridge ssid={{ ssid }} security-profile=portal-wpa2 frequency={{ frequency }} channel-width={{ channel_width }} disabled=no',
            '[{"name":"ssid","type":"string","default":"MikroTik-AP","description":"Wireless network name"},{"name":"password","type":"string","default":"","description":"WPA2 pre-shared key (min 8 characters)"},{"name":"frequency","type":"integer","default":"2412","description":"Wireless frequency in MHz"},{"name":"channel_width","type":"string","default":"20/40mhz-XX","description":"Channel width setting"}]'::jsonb
        FROM tenants t
        WHERE NOT EXISTS (
            SELECT 1 FROM config_templates ct
            WHERE ct.tenant_id = t.id AND ct.name = 'Wireless AP Config'
        )
    """)
    )

    # 5. Re-seed Initial Device Setup
    conn.execute(
        sa.text("""
        INSERT INTO config_templates (id, tenant_id, name, description, content, variables)
        SELECT
            gen_random_uuid(),
            t.id,
            'Initial Device Setup',
            'Set device identity, NTP, DNS, and disable unused services',
            '/system identity set name={{ device.hostname }}
/system ntp client set enabled=yes servers={{ ntp_server }}
/ip dns set servers={{ dns_servers }} allow-remote-requests=no
/ip service disable telnet,ftp,www,api-ssl
/ip service set ssh port=22
/ip service set winbox port=8291',
            '[{"name":"ntp_server","type":"ip","default":"pool.ntp.org","description":"NTP server address"},{"name":"dns_servers","type":"string","default":"8.8.8.8,8.8.4.4","description":"Comma-separated DNS servers"}]'::jsonb
        FROM tenants t
        WHERE NOT EXISTS (
            SELECT 1 FROM config_templates ct
            WHERE ct.tenant_id = t.id AND ct.name = 'Initial Device Setup'
        )
    """)
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM config_templates WHERE name = 'Basic Router'"))
