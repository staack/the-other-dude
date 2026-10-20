"""Keep shipped per-worker pools inside the default Compose connection budget."""

from pathlib import Path
import pytest
from pydantic import ValidationError
from app.config import Settings


def test_default_api_budget_leaves_database_capacity():
    defaults = Settings(_env_file=None)
    maximum = 2 * (
        defaults.DB_POOL_SIZE
        + defaults.DB_MAX_OVERFLOW
        + defaults.DB_ADMIN_POOL_SIZE
        + defaults.DB_ADMIN_MAX_OVERFLOW
    )
    assert maximum == 30
    compose = (Path(__file__).parents[3] / "docker-compose.yml").read_text()
    assert "max_connections=${POSTGRES_MAX_CONNECTIONS:-100}" in compose
    assert maximum + 20 < 100  # reserve poller/Timescale/admin capacity


@pytest.mark.parametrize(
    "field,value",
    [
        ("DB_POOL_SIZE", 0),
        ("DB_ADMIN_POOL_SIZE", 0),
        ("DB_MAX_OVERFLOW", -1),
        ("DB_ADMIN_MAX_OVERFLOW", -1),
    ],
)
def test_pool_overrides_cannot_disable_bounds(field, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})
