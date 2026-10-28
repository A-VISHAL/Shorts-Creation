"""Tests for root, health, and authentication endpoints."""

import pytest
from fastapi.testclient import TestClient


def test_root_status(client: TestClient):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "Motivational Shorts Studio" in data["service"]


def test_health_check(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("healthy", "degraded")
    assert "dependencies" in data
    assert data["dependencies"]["ffmpeg"] is True
    assert data["dependencies"]["ffprobe"] is True
    assert data["config"]["apiKeyConfigured"] is True
    # Verify no secret leakage
    assert "test-secret-key-12345" not in response.text


def test_auth_missing_key(client: TestClient):
    response = client.post("/api/media/download", json={"url": "https://example.com/test.mp4", "media_type": "video"})
    assert response.status_code == 401
    assert "Missing" in response.json()["detail"]


def test_auth_invalid_key(client: TestClient):
    response = client.post(
        "/api/media/download",
        headers={"X-API-Key": "wrong-key-value"},
        json={"url": "https://example.com/test.mp4", "media_type": "video"},
    )
    assert response.status_code == 401
    assert "Invalid" in response.json()["detail"]
