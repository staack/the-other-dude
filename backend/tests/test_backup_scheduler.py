"""Tests for dynamic backup scheduling."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.backup_scheduler import (
    build_schedule_map,
    _cron_to_trigger,
)


def test_cron_to_trigger_parses_standard_cron():
    """Parse '0 2 * * *' into CronTrigger with hour=2, minute=0."""
    trigger = _cron_to_trigger("0 2 * * *")
    assert trigger is not None


def test_cron_to_trigger_parses_every_6_hours():
    """Parse '0 */6 * * *' into CronTrigger."""
    trigger = _cron_to_trigger("0 */6 * * *")
    assert trigger is not None


def test_cron_to_trigger_invalid_returns_none():
    """Invalid cron returns None (fallback to default)."""
    trigger = _cron_to_trigger("not a cron")
    assert trigger is None


@pytest.mark.asyncio
async def test_build_schedule_map_groups_by_cron():
    """Devices sharing a cron expression should be grouped together."""
    schedules = [
        MagicMock(device_id="dev1", tenant_id="t1", cron_expression="0 2 * * *", enabled=True),
        MagicMock(device_id="dev2", tenant_id="t1", cron_expression="0 2 * * *", enabled=True),
        MagicMock(device_id="dev3", tenant_id="t2", cron_expression="0 6 * * *", enabled=True),
    ]
    schedule_map = build_schedule_map(schedules)
    assert "0 2 * * *" in schedule_map
    assert "0 6 * * *" in schedule_map
    assert len(schedule_map["0 2 * * *"]) == 2
    assert len(schedule_map["0 6 * * *"]) == 1
