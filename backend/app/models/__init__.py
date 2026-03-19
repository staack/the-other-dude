"""SQLAlchemy ORM models."""

from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.models.device import (
    Device,
    DeviceGroup,
    DeviceTag,
    DeviceGroupMembership,
    DeviceTagAssignment,
    DeviceStatus,
)
from app.models.alert import AlertRule, NotificationChannel, AlertRuleChannel, AlertEvent
from app.models.firmware import FirmwareVersion, FirmwareUpgradeJob
from app.models.config_template import ConfigTemplate, ConfigTemplateTag, TemplatePushJob
from app.models.site import Site
from app.models.audit_log import AuditLog
from app.models.maintenance_window import MaintenanceWindow
from app.models.api_key import ApiKey
from app.models.config_backup import RouterConfigSnapshot, RouterConfigDiff, RouterConfigChange
from app.models.device_interface import DeviceInterface
from app.models.wireless_link import WirelessLink, LinkState

__all__ = [
    "Tenant",
    "User",
    "UserRole",
    "Device",
    "DeviceGroup",
    "DeviceTag",
    "DeviceGroupMembership",
    "DeviceTagAssignment",
    "DeviceStatus",
    "Site",
    "AlertRule",
    "NotificationChannel",
    "AlertRuleChannel",
    "AlertEvent",
    "FirmwareVersion",
    "FirmwareUpgradeJob",
    "ConfigTemplate",
    "ConfigTemplateTag",
    "TemplatePushJob",
    "AuditLog",
    "MaintenanceWindow",
    "ApiKey",
    "RouterConfigSnapshot",
    "RouterConfigDiff",
    "RouterConfigChange",
    "DeviceInterface",
    "WirelessLink",
    "LinkState",
]
