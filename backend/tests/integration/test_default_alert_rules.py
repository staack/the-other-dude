"""
Integration test that default alert rules include wireless metrics.
"""

import pytest

pytestmark = pytest.mark.integration


class TestDefaultAlertRules:
    """Verify default alert rules are seeded on tenant creation."""

    async def test_tenant_creation_seeds_wireless_rules(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """Creating a tenant via API seeds default rules including wireless."""
        auth = await auth_headers_factory(admin_session, role="super_admin")

        # Create a new tenant
        resp = await client.post(
            "/api/tenants",
            json={"name": f"test-wireless-rules-{__import__('uuid').uuid4().hex[:8]}"},
            headers=auth["headers"],
        )
        assert resp.status_code in (200, 201)
        tenant_id = resp.json()["id"]

        # Get alert rules for the new tenant
        rules_resp = await client.get(
            f"/api/tenants/{tenant_id}/alert-rules",
            headers=auth["headers"],
        )
        assert rules_resp.status_code == 200
        rules = rules_resp.json()

        rule_metrics = {r["metric"] for r in rules}

        # Should have the standard health rules
        assert "cpu_load" in rule_metrics
        assert "memory_used_pct" in rule_metrics

        # Should have wireless rules
        assert "signal_strength" in rule_metrics, "Missing default wireless signal rule"
        assert "ccq" in rule_metrics, "Missing default wireless CCQ rule"
