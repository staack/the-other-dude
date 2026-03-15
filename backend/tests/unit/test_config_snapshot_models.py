"""Unit tests for RouterConfigSnapshot, RouterConfigDiff, RouterConfigChange models.

Verifies STOR-01 (table/column structure) and STOR-05 (config_text stores ciphertext).
"""

from sqlalchemy import String, Text


def test_router_config_snapshot_importable():
    """RouterConfigSnapshot can be imported from app.models."""
    from app.models import RouterConfigSnapshot

    assert RouterConfigSnapshot is not None


def test_router_config_diff_importable():
    """RouterConfigDiff can be imported from app.models."""
    from app.models import RouterConfigDiff

    assert RouterConfigDiff is not None


def test_router_config_change_importable():
    """RouterConfigChange can be imported from app.models."""
    from app.models import RouterConfigChange

    assert RouterConfigChange is not None


def test_snapshot_tablename():
    """RouterConfigSnapshot.__tablename__ is correct."""
    from app.models import RouterConfigSnapshot

    assert RouterConfigSnapshot.__tablename__ == "router_config_snapshots"


def test_diff_tablename():
    """RouterConfigDiff.__tablename__ is correct."""
    from app.models import RouterConfigDiff

    assert RouterConfigDiff.__tablename__ == "router_config_diffs"


def test_change_tablename():
    """RouterConfigChange.__tablename__ is correct."""
    from app.models import RouterConfigChange

    assert RouterConfigChange.__tablename__ == "router_config_changes"


def test_snapshot_columns():
    """RouterConfigSnapshot has all required columns."""
    from app.models import RouterConfigSnapshot

    table = RouterConfigSnapshot.__table__
    expected = {
        "id",
        "device_id",
        "tenant_id",
        "config_text",
        "sha256_hash",
        "collected_at",
        "created_at",
    }
    actual = {c.name for c in table.columns}
    assert expected.issubset(actual), f"Missing columns: {expected - actual}"


def test_diff_columns():
    """RouterConfigDiff has all required columns."""
    from app.models import RouterConfigDiff

    table = RouterConfigDiff.__table__
    expected = {
        "id",
        "device_id",
        "tenant_id",
        "old_snapshot_id",
        "new_snapshot_id",
        "diff_text",
        "lines_added",
        "lines_removed",
        "created_at",
    }
    actual = {c.name for c in table.columns}
    assert expected.issubset(actual), f"Missing columns: {expected - actual}"


def test_change_columns():
    """RouterConfigChange has all required columns."""
    from app.models import RouterConfigChange

    table = RouterConfigChange.__table__
    expected = {
        "id",
        "diff_id",
        "device_id",
        "tenant_id",
        "component",
        "summary",
        "raw_line",
        "created_at",
    }
    actual = {c.name for c in table.columns}
    assert expected.issubset(actual), f"Missing columns: {expected - actual}"


def test_snapshot_config_text_is_text_type():
    """config_text column type is Text (documents Transit ciphertext contract)."""
    from app.models import RouterConfigSnapshot

    col = RouterConfigSnapshot.__table__.c.config_text
    assert isinstance(col.type, Text), f"Expected Text, got {type(col.type)}"


def test_snapshot_sha256_hash_is_string_64():
    """sha256_hash column type is String(64) for plaintext hash deduplication."""
    from app.models import RouterConfigSnapshot

    col = RouterConfigSnapshot.__table__.c.sha256_hash
    assert isinstance(col.type, String), f"Expected String, got {type(col.type)}"
    assert col.type.length == 64, f"Expected length 64, got {col.type.length}"
