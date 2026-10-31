"""Automated tests for Backend Connection Manager and Cloudflare Tunnel integration."""

import asyncio
import subprocess
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from connection_manager import (
    ConnectionManager,
    calculate_backoff,
    is_backend_running,
    is_cloudflared_installed,
    parse_tunnel_url_from_output,
    validate_webhook_destination,
)


# -----------------------------------------------------------------------------
# 1. Tunnel URL Parsing Tests
# -----------------------------------------------------------------------------


def test_tunnel_url_parsing_standard_box():
    """Verify parsing trycloudflare.com URL from standard banner output."""
    banner_output = """
    2026-10-31T12:00:00Z INF +--------------------------------------------------------------------------------------------+
    2026-10-31T12:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
    2026-10-31T12:00:00Z INF |  https://creative-mountain-sample.trycloudflare.com                                       |
    2026-10-31T12:00:00Z INF +--------------------------------------------------------------------------------------------+
    """
    url = parse_tunnel_url_from_output(banner_output)
    assert url == "https://creative-mountain-sample.trycloudflare.com"


def test_tunnel_url_parsing_single_log_line():
    """Verify parsing trycloudflare.com URL from a single structured log line."""
    line = '{"time":"2026-10-31T12:00:00Z","level":"info","message":"Tunnel available at https://alpha-bravo-123.trycloudflare.com"}'
    url = parse_tunnel_url_from_output(line)
    assert url == "https://alpha-bravo-123.trycloudflare.com"


def test_tunnel_url_parsing_no_match():
    """Verify parse_tunnel_url_from_output returns None when no URL is present."""
    assert parse_tunnel_url_from_output("Starting tunnel process...") is None
    assert parse_tunnel_url_from_output("") is None
    assert parse_tunnel_url_from_output("https://google.com") is None


# -----------------------------------------------------------------------------
# 2. Existing Backend Detection Tests
# -----------------------------------------------------------------------------


def test_existing_backend_detection_offline():
    """Verify detection returns False for an unused port."""
    assert is_backend_running(port=49999, timeout=0.2) is False


def test_existing_backend_detection_online(monkeypatch):
    """Verify detection returns True when /api/health responds with healthy status."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "healthy", "service": "Test"}

    with patch("httpx.Client.get", return_value=mock_resp):
        assert is_backend_running(port=8000) is True


# -----------------------------------------------------------------------------
# 3. Tunnel Reconnection & Exponential Backoff Tests
# -----------------------------------------------------------------------------


def test_exponential_backoff_calculation():
    """Verify exponential backoff calculation and cap."""
    assert calculate_backoff(0) == 1.0
    assert calculate_backoff(1) == 2.0
    assert calculate_backoff(2) == 4.0
    assert calculate_backoff(3) == 8.0
    assert calculate_backoff(4) == 16.0
    assert calculate_backoff(5) == 30.0  # Capped at max_backoff (30s)
    assert calculate_backoff(10) == 30.0


@pytest.mark.asyncio
async def test_tunnel_reconnection_trigger():
    """Verify trigger_reconnect increments attempts and initiates tunnel start."""
    cm = ConnectionManager(target_port=8000)
    with patch.object(cm, "start_tunnel", new_callable=AsyncMock) as mock_start:
        mock_start.return_value = "https://reconnected-subdomain.trycloudflare.com"
        status = await cm.trigger_reconnect()
        assert cm.reconnect_attempts == 1
        mock_start.assert_called_once()
        assert "tunnel" in status


# -----------------------------------------------------------------------------
# 4. Health Check Failure & Verification Tests
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tunnel_health_verification_success():
    """Verify verify_tunnel_health returns True on 200 OK healthy response."""
    cm = ConnectionManager()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "healthy"}

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_resp
        assert await cm.verify_tunnel_health("https://valid-tunnel.trycloudflare.com") is True


@pytest.mark.asyncio
async def test_tunnel_health_verification_failure():
    """Verify verify_tunnel_health returns False on HTTP 500, connection errors, or timeouts."""
    cm = ConnectionManager()

    # Case 1: Non-200 status
    mock_resp = MagicMock()
    mock_resp.status_code = 502
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_resp
        assert await cm.verify_tunnel_health("https://broken-tunnel.trycloudflare.com") is False

    # Case 2: Exception raised (connection refused / timeout)
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.side_effect = Exception("Connection refused")
        assert await cm.verify_tunnel_health("https://unreachable.trycloudflare.com") is False


# -----------------------------------------------------------------------------
# 5. Invalid Webhook Destination & SSRF Protection Tests
# -----------------------------------------------------------------------------


def test_validate_webhook_allowed_destinations():
    """Verify approved webhook patterns pass destination validation."""
    valid_urls = [
        "https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short",
        "https://mycompany.app.n8n.cloud/webhook-test/generate-short",
        "http://localhost:5678/webhook/generate-motivational-short",
        "http://127.0.0.1:5678/webhook/local-test",
    ]
    for url in valid_urls:
        ok, msg = validate_webhook_destination(url)
        assert ok is True, f"Expected {url} to be allowed, got: {msg}"


def test_validate_webhook_blocked_ssrf_destinations():
    """Verify unsafe, internal, and SSRF destinations are rejected."""
    blocked_urls = [
        "http://169.254.169.254/latest/meta-data/",  # Cloud metadata service
        "http://192.168.1.1/admin",                  # Private LAN
        "http://10.0.0.1:8080/api",                  # Private LAN
        "http://127.0.0.1:8000/api/video/render",    # Recursive loopback non-n8n
        "http://localhost:22",                       # Non-n8n port
        "ftp://example.com/webhook",                 # Unsupported scheme
        "http://admin:secret@n8n.cloud/webhook",     # Embedded credentials
        "",                                          # Empty string
    ]
    for url in blocked_urls:
        ok, msg = validate_webhook_destination(url)
        assert ok is False, f"Expected {url} to be blocked, but it passed: {msg}"


# -----------------------------------------------------------------------------
# 6. Automatic n8n Proxy Routing Tests
# -----------------------------------------------------------------------------


def test_proxy_auto_injects_active_tunnel_url(client: TestClient):
    """Verify /api/webhook/proxy automatically injects the active Cloudflare Tunnel URL."""
    from app import connection_manager

    # Set mock active tunnel URL
    test_tunnel_url = "https://active-test-tunnel.trycloudflare.com"
    orig_url = connection_manager.active_tunnel_url
    connection_manager.active_tunnel_url = test_tunnel_url

    captured_payload = {}

    def mock_post(url, json=None, **kwargs):
        nonlocal captured_payload
        captured_payload = json
        mock_r = MagicMock()
        mock_r.status_code = 200
        mock_r.json.return_value = {
            "success": True,
            "jobId": "job_123",
            "videoUrl": f"{test_tunnel_url}/media/rendered_output.mp4",
        }
        return mock_r

    try:
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=mock_post):
            response = client.post(
                "/api/webhook/proxy",
                json={
                    "webhookUrl": "https://test.app.n8n.cloud/webhook/test-route",
                    "payload": {
                        "title": "Test Motivational Video",
                        "quote": "Keep pushing forward",
                    },
                },
            )
            assert response.status_code == 200
            assert captured_payload.get("fastApiBaseUrl") == test_tunnel_url
    finally:
        connection_manager.active_tunnel_url = orig_url


def test_proxy_rejects_ssrf_destination(client: TestClient):
    """Verify proxy returns HTTP 400 when an invalid or SSRF target is requested."""
    response = client.post(
        "/api/webhook/proxy",
        json={
            "webhookUrl": "http://169.254.169.254/latest/meta-data/",
            "payload": {"test": True},
        },
    )
    assert response.status_code == 400
    assert "Webhook destination rejected" in response.json()["detail"]


# -----------------------------------------------------------------------------
# 7. Connection Status & Verification Endpoints
# -----------------------------------------------------------------------------


def test_connection_status_endpoint(client: TestClient):
    """Verify GET /api/connection/status returns valid structured state."""
    response = client.get("/api/connection/status")
    assert response.status_code == 200
    data = response.json()
    assert "backend" in data
    assert "tunnel" in data
    assert "proxy" in data
    assert data["backend"]["status"] in ("online", "starting", "offline")
    assert data["proxy"]["enabled"] is True


def test_verify_webhook_endpoint(client: TestClient):
    """Verify POST /api/connection/verify-webhook correctly validates endpoints."""
    # Invalid target
    resp_bad = client.post(
        "/api/connection/verify-webhook",
        json={"webhookUrl": "http://10.0.0.1/admin"},
    )
    assert resp_bad.status_code == 400

    # Valid target with mock reachability
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    with patch("httpx.AsyncClient.head", new_callable=AsyncMock, return_value=mock_resp):
        resp_good = client.post(
            "/api/connection/verify-webhook",
            json={"webhookUrl": "https://sample.app.n8n.cloud/webhook/test"},
        )
        assert resp_good.status_code == 200
        assert resp_good.json()["success"] is True


# -----------------------------------------------------------------------------
# 8. Application Shutdown & Process Cleanup Tests
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_application_shutdown_cleans_subprocesses():
    """Verify shutdown() cleanly terminates managed tunnel process."""
    cm = ConnectionManager()
    mock_proc = MagicMock()
    mock_proc.returncode = None
    mock_proc.wait = AsyncMock()

    cm._tunnel_process = mock_proc
    await cm.shutdown()

    mock_proc.terminate.assert_called_once()
    assert cm.tunnel_status == "disconnected"
