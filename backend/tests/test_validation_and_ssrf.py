"""Tests for input validation and SSRF protections."""

import pytest
from fastapi.testclient import TestClient


def test_ssrf_blocks_localhost(client: TestClient, auth_headers: dict):
    targets = [
        "http://localhost:8080/secret.mp4",
        "http://127.0.0.1:8080/secret.mp4",
        "http://127.0.0.1/video.mp4",
        "http://0.0.0.0:8000/media.mp4",
    ]
    for url in targets:
        response = client.post(
            "/api/media/download",
            headers=auth_headers,
            json={"url": url, "media_type": "video"},
        )
        assert response.status_code == 400
        assert "private" in response.text.lower() or "localhost" in response.text.lower()


def test_ssrf_blocks_private_networks(client: TestClient, auth_headers: dict):
    targets = [
        "http://10.0.0.1/video.mp4",
        "http://192.168.1.100/video.mp4",
        "http://172.16.0.5/video.mp4",
        "http://169.254.169.254/latest/meta-data/",  # Cloud metadata
    ]
    for url in targets:
        response = client.post(
            "/api/media/download",
            headers=auth_headers,
            json={"url": url, "media_type": "video"},
        )
        assert response.status_code == 400
        assert "blocked" in response.text.lower() or "private" in response.text.lower()


def test_validation_unsupported_scheme(client: TestClient, auth_headers: dict):
    response = client.post(
        "/api/media/download",
        headers=auth_headers,
        json={"url": "ftp://example.com/video.mp4", "media_type": "video"},
    )
    assert response.status_code in (400, 422)


def test_validation_render_parameters(client: TestClient, auth_headers: dict):
    # Empty text
    res = client.post(
        "/api/video/render",
        headers=auth_headers,
        json={
            "videoUrl": "https://example.com/v.mp4",
            "musicUrl": "https://example.com/m.mp3",
            "text": "   ",
            "durationSeconds": 30,
        },
    )
    assert res.status_code == 422

    # Duration too small (<5) or too large (>120)
    res = client.post(
        "/api/video/render",
        headers=auth_headers,
        json={
            "videoUrl": "https://example.com/v.mp4",
            "musicUrl": "https://example.com/m.mp3",
            "text": "Valid inspirational quote",
            "durationSeconds": 2,
        },
    )
    assert res.status_code == 422

    res = client.post(
        "/api/video/render",
        headers=auth_headers,
        json={
            "videoUrl": "https://example.com/v.mp4",
            "musicUrl": "https://example.com/m.mp3",
            "text": "Valid inspirational quote",
            "durationSeconds": 500,
        },
    )
    assert res.status_code == 422


def test_media_path_traversal_protection(client: TestClient):
    # Attempt to traverse outside media directory
    response = client.get("/media/../../../../etc/passwd")
    assert response.status_code in (404, 400)

    response = client.get("/media/..%2F..%2Fetc%2Fpasswd")
    assert response.status_code in (404, 400)


@pytest.mark.asyncio
async def test_local_media_resolution_known_assets():
    import app

    vid = await app.resolve_or_download_media("http://localhost:8000/media/test_source_vid.mp4", "video")
    assert vid.is_file()

    aud = await app.resolve_or_download_media("http://localhost:8000/media/test_source_aud.mp3", "audio")
    assert aud.is_file()


@pytest.mark.asyncio
async def test_local_media_resolution_nonexistent_raises_404():
    import app
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        await app.resolve_or_download_media("http://localhost:8000/media/nonexistent_video_12345.mp4", "video")
    assert exc_info.value.status_code == 404
    assert "was not found in media storage" in exc_info.value.detail
