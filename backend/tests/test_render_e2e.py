"""End-to-end rendering and media serving integration tests using real FFmpeg."""

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app


def test_render_and_serve_short_e2e(client: TestClient, auth_headers: dict, sample_media_files: dict):
    # Copy sample files into media directory so they can be referenced as local media URLs
    media_dir = app.MEDIA_PATH
    sample_vid_name = "test_source_vid.mp4"
    sample_aud_name = "test_source_aud.mp3"

    shutil.copy(sample_media_files["video"], media_dir / sample_vid_name)
    shutil.copy(sample_media_files["audio"], media_dir / sample_aud_name)

    video_url = f"http://testserver:8000/media/{sample_vid_name}"
    music_url = f"http://testserver:8000/media/{sample_aud_name}"

    render_payload = {
        "videoUrl": video_url,
        "musicUrl": music_url,
        "text": "The secret of getting ahead\nis getting started right now.",
        "title": "Start Today",
        "durationSeconds": 5,
        "width": 720,  # Fast test dimensions (720x1280 9:16)
        "height": 1280,
        "style": "dark-motivational",
    }

    response = client.post("/api/video/render", headers=auth_headers, json=render_payload)
    assert response.status_code == 200, f"Render failed: {response.text}"
    data = response.json()

    assert data["success"] is True
    assert data["status"] == "completed"
    assert "jobId" in data
    assert "videoUrl" in data
    assert data["durationSeconds"] == 5
    assert data["width"] == 720
    assert data["height"] == 1280

    job_id = data["jobId"]
    rendered_filename = data["filename"]
    rendered_file_path = media_dir / rendered_filename

    assert rendered_file_path.exists()
    assert rendered_file_path.stat().st_size > 1000

    # Verify FFprobe output properties
    probe = app.probe_media_file(rendered_file_path)
    assert probe["width"] == 720
    assert probe["height"] == 1280
    assert probe["duration"] is not None
    assert 4.0 <= probe["duration"] <= 6.0
    assert probe["video_codec"] == "h264"
    assert probe["audio_codec"] == "aac"

    # Test GET /api/jobs/{job_id}
    status_resp = client.get(f"/api/jobs/{job_id}")
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    assert status_data["status"] == "completed"
    assert status_data["result"]["videoUrl"] == data["videoUrl"]

    # Test GET /media/{filename} (Serve Media)
    media_resp = client.get(f"/media/{rendered_filename}")
    assert media_resp.status_code == 200
    assert media_resp.headers["content-type"] == "video/mp4"
    assert len(media_resp.content) > 1000

    # Test GET /api/video/{job_id}/download (Download attachment)
    dl_resp = client.get(f"/api/video/{job_id}/download")
    assert dl_resp.status_code == 200
    assert "attachment" in dl_resp.headers.get("content-disposition", "")
