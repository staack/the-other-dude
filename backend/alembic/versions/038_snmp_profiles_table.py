"""Create snmp_profiles table with 6 system-shipped seed profiles.

Revision ID: 038
Revises: 037
Create Date: 2026-03-21

Device profiles define WHAT to collect from a category of SNMP device.
System profiles (tenant_id IS NULL, is_system = TRUE) ship with TOD and
are visible to all tenants.  Tenant profiles are scoped by RLS.

Partial unique indexes enforce name uniqueness separately for system
profiles (WHERE tenant_id IS NULL) and tenant profiles (WHERE tenant_id
IS NOT NULL), avoiding the need for a sentinel UUID.
"""

import json
import textwrap

import sqlalchemy as sa
from alembic import op

revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Profile data definitions — match the v9.8 design spec section 5.2
# ---------------------------------------------------------------------------

_SYSTEM_GROUP = {
    "interval_multiplier": 1,
    "scalars": [
        {
            "oid": "1.3.6.1.2.1.1.1.0",
            "name": "sys_descr",
            "type": "string",
            "map_to": "device.model",
        },
        {
            "oid": "1.3.6.1.2.1.1.3.0",
            "name": "sys_uptime",
            "type": "timeticks",
            "map_to": "device.uptime_seconds",
        },
        {
            "oid": "1.3.6.1.2.1.1.5.0",
            "name": "sys_name",
            "type": "string",
            "map_to": "device.hostname_discovered",
        },
        {
            "oid": "1.3.6.1.2.1.1.2.0",
            "name": "sys_object_id",
            "type": "oid",
            "map_to": "device.sys_object_id",
        },
    ],
}

_INTERFACES_GROUP = {
    "interval_multiplier": 1,
    "tables": [
        {
            "oid": "1.3.6.1.2.1.2.2",
            "name": "ifTable",
            "index_oid": "1.3.6.1.2.1.2.2.1.1",
            "columns": [
                {"oid": "1.3.6.1.2.1.2.2.1.2", "name": "ifDescr", "type": "string"},
                {"oid": "1.3.6.1.2.1.2.2.1.5", "name": "ifSpeed", "type": "gauge"},
                {
                    "oid": "1.3.6.1.2.1.2.2.1.7",
                    "name": "ifAdminStatus",
                    "type": "integer",
                },
                {
                    "oid": "1.3.6.1.2.1.2.2.1.8",
                    "name": "ifOperStatus",
                    "type": "integer",
                },
                {
                    "oid": "1.3.6.1.2.1.2.2.1.10",
                    "name": "ifInOctets",
                    "type": "counter32",
                },
                {
                    "oid": "1.3.6.1.2.1.2.2.1.16",
                    "name": "ifOutOctets",
                    "type": "counter32",
                },
            ],
            "map_to": "interface_metrics",
        },
        {
            "oid": "1.3.6.1.2.1.31.1.1",
            "name": "ifXTable",
            "index_oid": "1.3.6.1.2.1.31.1.1.1.1",
            "columns": [
                {
                    "oid": "1.3.6.1.2.1.31.1.1.1.1",
                    "name": "ifName",
                    "type": "string",
                },
                {
                    "oid": "1.3.6.1.2.1.31.1.1.1.6",
                    "name": "ifHCInOctets",
                    "type": "counter64",
                },
                {
                    "oid": "1.3.6.1.2.1.31.1.1.1.10",
                    "name": "ifHCOutOctets",
                    "type": "counter64",
                },
                {
                    "oid": "1.3.6.1.2.1.31.1.1.1.15",
                    "name": "ifHighSpeed",
                    "type": "gauge",
                },
            ],
            "map_to": "interface_metrics",
            "prefer_over": "ifTable",
        },
    ],
}

_HEALTH_GROUP = {
    "interval_multiplier": 1,
    "scalars": [
        {
            "oid": "1.3.6.1.2.1.25.3.3.1.2",
            "name": "hrProcessorLoad",
            "type": "integer",
            "map_to": "health_metrics.cpu_load",
        },
        {
            "oid": "1.3.6.1.4.1.2021.11.11.0",
            "name": "ssCpuIdle",
            "type": "integer",
            "transform": "invert_percent",
            "map_to": "health_metrics.cpu_load",
            "fallback_for": "hrProcessorLoad",
        },
    ],
    "tables": [
        {
            "oid": "1.3.6.1.2.1.25.2.3",
            "name": "hrStorageTable",
            "index_oid": "1.3.6.1.2.1.25.2.3.1.1",
            "columns": [
                {
                    "oid": "1.3.6.1.2.1.25.2.3.1.2",
                    "name": "hrStorageType",
                    "type": "oid",
                },
                {
                    "oid": "1.3.6.1.2.1.25.2.3.1.3",
                    "name": "hrStorageDescr",
                    "type": "string",
                },
                {
                    "oid": "1.3.6.1.2.1.25.2.3.1.4",
                    "name": "hrStorageAllocationUnits",
                    "type": "integer",
                },
                {
                    "oid": "1.3.6.1.2.1.25.2.3.1.5",
                    "name": "hrStorageSize",
                    "type": "integer",
                },
                {
                    "oid": "1.3.6.1.2.1.25.2.3.1.6",
                    "name": "hrStorageUsed",
                    "type": "integer",
                },
            ],
            "map_to": "health_metrics",
            "filter": {
                "hrStorageType": [
                    "1.3.6.1.2.1.25.2.1.2",
                    "1.3.6.1.2.1.25.2.1.4",
                ]
            },
        },
    ],
}

_CUSTOM_GROUP = {
    "interval_multiplier": 5,
    "scalars": [],
    "tables": [],
}

# -- generic-snmp: the automatic fallback profile -------------------------
_GENERIC_SNMP_DATA = {
    "version": 1,
    "poll_groups": {
        "system": _SYSTEM_GROUP,
        "interfaces": _INTERFACES_GROUP,
        "health": _HEALTH_GROUP,
        "custom": _CUSTOM_GROUP,
    },
}

# -- network-switch: generic + bridge/VLAN tables -------------------------
_SWITCH_DATA = {
    "version": 1,
    "poll_groups": {
        "system": _SYSTEM_GROUP,
        "interfaces": _INTERFACES_GROUP,
        "health": _HEALTH_GROUP,
        "bridge": {
            "interval_multiplier": 5,
            "tables": [
                {
                    "oid": "1.3.6.1.2.1.17.4.3",
                    "name": "dot1dTpFdbTable",
                    "index_oid": "1.3.6.1.2.1.17.4.3.1.1",
                    "columns": [
                        {
                            "oid": "1.3.6.1.2.1.17.4.3.1.1",
                            "name": "dot1dTpFdbAddress",
                            "type": "string",
                        },
                        {
                            "oid": "1.3.6.1.2.1.17.4.3.1.2",
                            "name": "dot1dTpFdbPort",
                            "type": "integer",
                        },
                        {
                            "oid": "1.3.6.1.2.1.17.4.3.1.3",
                            "name": "dot1dTpFdbStatus",
                            "type": "integer",
                        },
                    ],
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.2.1.17.7.1.4.3",
                    "name": "dot1qVlanStaticTable",
                    "index_oid": "1.3.6.1.2.1.17.7.1.4.3.1.1",
                    "columns": [
                        {
                            "oid": "1.3.6.1.2.1.17.7.1.4.3.1.1",
                            "name": "dot1qVlanFdbId",
                            "type": "integer",
                        },
                        {
                            "oid": "1.3.6.1.2.1.17.7.1.4.3.1.5",
                            "name": "dot1qVlanStaticRowStatus",
                            "type": "integer",
                        },
                    ],
                    "map_to": "snmp_metrics",
                },
            ],
        },
        "custom": _CUSTOM_GROUP,
    },
}

# -- network-router: generic + routing tables ------------------------------
_ROUTER_DATA = {
    "version": 1,
    "poll_groups": {
        "system": _SYSTEM_GROUP,
        "interfaces": _INTERFACES_GROUP,
        "health": _HEALTH_GROUP,
        "routing": {
            "interval_multiplier": 5,
            "tables": [
                {
                    "oid": "1.3.6.1.2.1.4.21",
                    "name": "ipRouteTable",
                    "index_oid": "1.3.6.1.2.1.4.21.1.1",
                    "columns": [
                        {
                            "oid": "1.3.6.1.2.1.4.21.1.1",
                            "name": "ipRouteDest",
                            "type": "string",
                        },
                        {
                            "oid": "1.3.6.1.2.1.4.21.1.7",
                            "name": "ipRouteNextHop",
                            "type": "string",
                        },
                        {
                            "oid": "1.3.6.1.2.1.4.21.1.8",
                            "name": "ipRouteType",
                            "type": "integer",
                        },
                    ],
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.2.1.15.3",
                    "name": "bgpPeerTable",
                    "index_oid": "1.3.6.1.2.1.15.3.1.1",
                    "columns": [
                        {
                            "oid": "1.3.6.1.2.1.15.3.1.2",
                            "name": "bgpPeerState",
                            "type": "integer",
                        },
                        {
                            "oid": "1.3.6.1.2.1.15.3.1.9",
                            "name": "bgpPeerRemoteAs",
                            "type": "integer",
                        },
                    ],
                    "map_to": "snmp_metrics",
                },
            ],
        },
        "custom": _CUSTOM_GROUP,
    },
}

# -- wireless-ap: generic + 802.11 MIB ------------------------------------
_WIRELESS_AP_DATA = {
    "version": 1,
    "poll_groups": {
        "system": _SYSTEM_GROUP,
        "interfaces": _INTERFACES_GROUP,
        "health": _HEALTH_GROUP,
        "wireless": {
            "interval_multiplier": 1,
            "tables": [
                {
                    "oid": "1.2.840.10036.1.1",
                    "name": "dot11StationConfigTable",
                    "index_oid": "1.2.840.10036.1.1.1.1",
                    "columns": [
                        {
                            "oid": "1.2.840.10036.1.1.1.9",
                            "name": "dot11DesiredSSID",
                            "type": "string",
                        },
                    ],
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.2.840.10036.2.1",
                    "name": "dot11AssociationTable",
                    "index_oid": "1.2.840.10036.2.1.1.1",
                    "columns": [
                        {
                            "oid": "1.2.840.10036.2.1.1.1",
                            "name": "dot11AssociatedStationCount",
                            "type": "integer",
                        },
                    ],
                    "map_to": "snmp_metrics",
                },
            ],
        },
        "custom": _CUSTOM_GROUP,
    },
}

# -- ups-device: UPS-MIB (RFC 1628) ---------------------------------------
_UPS_DATA = {
    "version": 1,
    "poll_groups": {
        "system": _SYSTEM_GROUP,
        "interfaces": _INTERFACES_GROUP,
        "ups_battery": {
            "interval_multiplier": 1,
            "scalars": [
                {
                    "oid": "1.3.6.1.2.1.33.1.2.1.0",
                    "name": "upsBatteryStatus",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.2.1.33.1.2.2.0",
                    "name": "upsSecondsOnBattery",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.2.1.33.1.2.3.0",
                    "name": "upsEstimatedMinutesRemaining",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.2.1.33.1.2.4.0",
                    "name": "upsEstimatedChargeRemaining",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.2.1.33.1.2.5.0",
                    "name": "upsBatteryVoltage",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.2.1.33.1.2.7.0",
                    "name": "upsBatteryTemperature",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
            ],
        },
        "ups_input": {
            "interval_multiplier": 1,
            "tables": [
                {
                    "oid": "1.3.6.1.2.1.33.1.3.3",
                    "name": "upsInputTable",
                    "index_oid": "1.3.6.1.2.1.33.1.3.3.1.1",
                    "columns": [
                        {
                            "oid": "1.3.6.1.2.1.33.1.3.3.1.2",
                            "name": "upsInputFrequency",
                            "type": "integer",
                        },
                        {
                            "oid": "1.3.6.1.2.1.33.1.3.3.1.3",
                            "name": "upsInputVoltage",
                            "type": "integer",
                        },
                    ],
                    "map_to": "snmp_metrics",
                },
            ],
        },
        "ups_output": {
            "interval_multiplier": 1,
            "scalars": [
                {
                    "oid": "1.3.6.1.2.1.33.1.4.1.0",
                    "name": "upsOutputSource",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
            ],
            "tables": [
                {
                    "oid": "1.3.6.1.2.1.33.1.4.4",
                    "name": "upsOutputTable",
                    "index_oid": "1.3.6.1.2.1.33.1.4.4.1.1",
                    "columns": [
                        {
                            "oid": "1.3.6.1.2.1.33.1.4.4.1.2",
                            "name": "upsOutputVoltage",
                            "type": "integer",
                        },
                        {
                            "oid": "1.3.6.1.2.1.33.1.4.4.1.4",
                            "name": "upsOutputPower",
                            "type": "integer",
                        },
                        {
                            "oid": "1.3.6.1.2.1.33.1.4.4.1.5",
                            "name": "upsOutputPercentLoad",
                            "type": "integer",
                        },
                    ],
                    "map_to": "snmp_metrics",
                },
            ],
        },
        "custom": _CUSTOM_GROUP,
    },
}

# -- mikrotik-snmp: MikroTik private MIB OIDs -----------------------------
_MIKROTIK_DATA = {
    "version": 1,
    "poll_groups": {
        "system": _SYSTEM_GROUP,
        "interfaces": _INTERFACES_GROUP,
        "health": _HEALTH_GROUP,
        "mikrotik": {
            "interval_multiplier": 1,
            "scalars": [
                {
                    "oid": "1.3.6.1.4.1.14988.1.1.3.10.0",
                    "name": "mtxrHlCpuTemperature",
                    "type": "integer",
                    "map_to": "health_metrics.temperature",
                },
                {
                    "oid": "1.3.6.1.4.1.14988.1.1.3.8.0",
                    "name": "mtxrHlPower",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.4.1.14988.1.1.3.100.0",
                    "name": "mtxrHlActiveFan",
                    "type": "string",
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.4.1.14988.1.1.3.11.0",
                    "name": "mtxrHlProcessorTemperature",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
                {
                    "oid": "1.3.6.1.4.1.14988.1.1.3.7.0",
                    "name": "mtxrHlVoltage",
                    "type": "integer",
                    "map_to": "snmp_metrics",
                },
            ],
            "tables": [
                {
                    "oid": "1.3.6.1.4.1.14988.1.1.1.3",
                    "name": "mtxrWlRtabTable",
                    "index_oid": "1.3.6.1.4.1.14988.1.1.1.3.1.1",
                    "columns": [
                        {
                            "oid": "1.3.6.1.4.1.14988.1.1.1.3.1.4",
                            "name": "mtxrWlRtabStrength",
                            "type": "integer",
                        },
                        {
                            "oid": "1.3.6.1.4.1.14988.1.1.1.3.1.5",
                            "name": "mtxrWlRtabTxBytes",
                            "type": "counter64",
                        },
                        {
                            "oid": "1.3.6.1.4.1.14988.1.1.1.3.1.6",
                            "name": "mtxrWlRtabRxBytes",
                            "type": "counter64",
                        },
                    ],
                    "map_to": "snmp_metrics",
                },
            ],
        },
        "custom": _CUSTOM_GROUP,
    },
}

# -- Seed profile definitions ----------------------------------------------
SEED_PROFILES = [
    {
        "name": "generic-snmp",
        "description": "Standard MIB-II collection: system info, interfaces, CPU, memory, storage",
        "category": "generic",
        "sys_object_id": None,
        "vendor": None,
        "profile_data": _GENERIC_SNMP_DATA,
    },
    {
        "name": "network-switch",
        "description": "Network switch: MIB-II + MAC address table, VLANs",
        "category": "switch",
        "sys_object_id": None,
        "vendor": None,
        "profile_data": _SWITCH_DATA,
    },
    {
        "name": "network-router",
        "description": "Network router: MIB-II + IP route table, BGP peers",
        "category": "router",
        "sys_object_id": None,
        "vendor": None,
        "profile_data": _ROUTER_DATA,
    },
    {
        "name": "wireless-ap",
        "description": "Wireless access point: MIB-II + IEEE 802.11 client associations",
        "category": "access_point",
        "sys_object_id": None,
        "vendor": None,
        "profile_data": _WIRELESS_AP_DATA,
    },
    {
        "name": "ups-device",
        "description": "UPS: battery status, voltage, load, runtime (UPS-MIB RFC 1628)",
        "category": "ups",
        "sys_object_id": "1.3.6.1.2.1.33",
        "vendor": None,
        "profile_data": _UPS_DATA,
    },
    {
        "name": "mikrotik-snmp",
        "description": "MikroTik device via SNMP: standard MIB-II + private MIB OIDs",
        "category": "router",
        "sys_object_id": "1.3.6.1.4.1.14988",
        "vendor": "MikroTik",
        "profile_data": _MIKROTIK_DATA,
    },
]


def upgrade() -> None:
    conn = op.get_bind()

    # -- Create table -------------------------------------------------------
    conn.execute(
        sa.text("""
            CREATE TABLE snmp_profiles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                sys_object_id TEXT,
                vendor TEXT,
                category TEXT,
                profile_data JSONB NOT NULL,
                is_system BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
    )

    # -- Partial unique indexes: system vs tenant profiles ------------------
    conn.execute(
        sa.text("""
            CREATE UNIQUE INDEX idx_snmp_profiles_tenant_name
                ON snmp_profiles(tenant_id, name)
                WHERE tenant_id IS NOT NULL
        """)
    )
    conn.execute(
        sa.text("""
            CREATE UNIQUE INDEX idx_snmp_profiles_system_name
                ON snmp_profiles(name)
                WHERE tenant_id IS NULL
        """)
    )

    # -- RLS: system profiles visible to all tenants -----------------------
    conn.execute(
        sa.text("ALTER TABLE snmp_profiles ENABLE ROW LEVEL SECURITY")
    )
    conn.execute(
        sa.text("ALTER TABLE snmp_profiles FORCE ROW LEVEL SECURITY")
    )
    conn.execute(
        sa.text("""
            CREATE POLICY snmp_profiles_tenant_isolation
                ON snmp_profiles
                USING (
                    tenant_id IS NULL
                    OR tenant_id::text = current_setting('app.current_tenant', true)
                    OR current_setting('app.current_tenant', true) = 'super_admin'
                )
        """)
    )

    conn.execute(
        sa.text("GRANT SELECT ON snmp_profiles TO poller_user")
    )

    # -- Seed 6 system profiles --------------------------------------------
    for profile in SEED_PROFILES:
        conn.execute(
            sa.text("""
                INSERT INTO snmp_profiles
                    (tenant_id, name, description, sys_object_id, vendor,
                     category, profile_data, is_system)
                VALUES
                    (NULL, :name, :description, :sys_object_id, :vendor,
                     :category, :profile_data::jsonb, TRUE)
            """),
            {
                "name": profile["name"],
                "description": profile["description"],
                "sys_object_id": profile["sys_object_id"],
                "vendor": profile["vendor"],
                "category": profile["category"],
                "profile_data": json.dumps(profile["profile_data"]),
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DROP POLICY IF EXISTS snmp_profiles_tenant_isolation"
            " ON snmp_profiles"
        )
    )
    op.drop_table("snmp_profiles")
