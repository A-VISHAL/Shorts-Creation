"""Tests for the webhook proxy endpoint and dynamic tunnel header resolution."""

import pytest
from fastapi.testclient import TestClient


def test_dynamic_tunnel_header_detection(client: TestClient):
    """Verify that incoming requests through a Cloudflare Tunnel have their public base URL dynamically resolved."""
    tunnel_host = "custom-test-subdomain.trycloudflare.com"
    response = client.get(
        "/api/health",
        headers={
            "X-Forwarded-Host": tunnel_host,
            "X-Forwarded-Proto": "https",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["config"]["detectedPublicBaseUrl"] == f"https://{tunnel_host}"


def test_proxy_webhook_invalid_scheme(client: TestClient):
    """Verify that proxy endpoint rejects invalid URL schemes."""
    response = client.post(
        "/api/webhook/proxy",
        json={
            "webhookUrl": "ftp://example.com/webhook",
            "payload": {"test": True},
        },
    )
    assert response.status_code == 400
    assert "Invalid webhook URL" in response.json()["detail"]


def test_proxy_webhook_missing_url(client: TestClient):
    """Verify that proxy endpoint rejects missing webhook URL."""
    response = client.post(
        "/api/webhook/proxy",
        json={
            "payload": {"test": True},
        },
    )
    assert response.status_code == 422
