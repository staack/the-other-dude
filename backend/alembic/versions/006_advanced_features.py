"""Add config templates, template push jobs, and device location columns.

Revision ID: 006
Revises: 005
Create Date: 2026-02-25

This migration:
1. ALTERs devices table: adds latitude and longitude columns.
2. Creates config_templates table.
3. Creates config_template_tags table.
4. Creates template_push_jobs table.
5. Applies RLS policies on all three new tables.
6. Seeds starter templates for all existing tenants.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # =========================================================================
    # ALTER devices TABLE — add latitude and longitude columns
    # =========================================================================
    conn.execute(sa.text("ALTER TABLE devices ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION"))
    conn.execute(sa.text("ALTER TABLE devices ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION"))

    # =========================================================================
    # CREATE config_templates TABLE
    # =========================================================================
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS config_templates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT,
            content TEXT NOT NULL,
            variables JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(tenant_id, name)
        )
    """)
    )

    # =========================================================================
    # CREATE config_template_tags TABLE
    # =========================================================================
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS config_template_tags (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            template_id UUID NOT NULL REFERENCES config_templates(id) ON DELETE CASCADE,
            UNIQUE(template_id, name)
        )
    """)
    )

    # =========================================================================
    # CREATE template_push_jobs TABLE
    # =========================================================================
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS template_push_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            template_id UUID REFERENCES config_templates(id) ON DELETE SET NULL,
            device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            rollout_id UUID,
            rendered_content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            pre_push_backup_sha TEXT,
            error_message TEXT,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    )

    # =========================================================================
    # RLS POLICIES
    # =========================================================================
    for table in ("config_templates", "config_template_tags", "template_push_jobs"):
        conn.execute(sa.text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        conn.execute(
            sa.text(f"""
            CREATE POLICY {table}_tenant_isolation ON {table}
            USING (tenant_id = current_setting('app.current_tenant')::uuid)
        """)
        )
        conn.execute(sa.text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO app_user"))
        conn.execute(sa.text(f"GRANT ALL ON {table} TO poller_user"))

    # =========================================================================
    # INDEXES
    # =========================================================================
    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_config_templates_tenant ON config_templates (tenant_id)"
        )
    )
    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_config_template_tags_template "
            "ON config_template_tags (template_id)"
        )
    )
    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_template_push_jobs_tenant_rollout "
            "ON template_push_jobs (tenant_id, rollout_id)"
        )
    )
    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_template_push_jobs_device_status "
            "ON template_push_jobs (device_id, status)"
        )
    )

    # =========================================================================
    # SEED STARTER TEMPLATES for all existing tenants
    # =========================================================================

    # 1. Basic Firewall
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
            '[{"name":"wan_interface","type":"string","default":"ether1","description":"WAN-facing interface"},{"name":"allowed_network","type":"subnet","default":"192.168.1.0/24","description":"Allowed source network"}]'::jsonb
        FROM tenants t
        ON CONFLICT DO NOTHING
    """)
    )

    # 2. DHCP Server Setup
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
            '[{"name":"pool_start","type":"ip","default":"192.168.1.100","description":"DHCP pool start address"},{"name":"pool_end","type":"ip","default":"192.168.1.254","description":"DHCP pool end address"},{"name":"gateway","type":"ip","default":"192.168.1.1","description":"Default gateway"},{"name":"dns_server","type":"ip","default":"8.8.8.8","description":"DNS server address"},{"name":"interface","type":"string","default":"bridge1","description":"Interface to serve DHCP on"}]'::jsonb
        FROM tenants t
        ON CONFLICT DO NOTHING
    """)
    )

    # 3. Wireless AP Config
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
        ON CONFLICT DO NOTHING
    """)
    )

    # 4. Initial Device Setup
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
        ON CONFLICT DO NOTHING
    """)
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Drop tables in reverse dependency order
    conn.execute(sa.text("DROP TABLE IF EXISTS template_push_jobs CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS config_template_tags CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS config_templates CASCADE"))

    # Drop location columns from devices
    conn.execute(sa.text("ALTER TABLE devices DROP COLUMN IF EXISTS latitude"))
    conn.execute(sa.text("ALTER TABLE devices DROP COLUMN IF EXISTS longitude"))
