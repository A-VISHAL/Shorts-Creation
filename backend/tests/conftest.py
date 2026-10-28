"""Pytest fixtures for Motivational Shorts Studio backend tests."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Generator

import pytest
from fastapi.testclient import TestClient

# Ensure test settings before importing app
os.environ["SHORTS_API_KEY"] = "test-secret-key-12345"
os.environ["PUBLIC_BASE_URL"] = "http://testserver:8000"
os.environ["MAX_DOWNLOAD_MB"] = "50"
os.environ["RENDER_TIMEOUT_SECONDS"] = "60"

import app


@pytest.fixture(scope="session")
def client() -> Generator[TestClient, None, None]:
    """Test client instance."""
    with TestClient(app.app) as c:
        yield c


@pytest.fixture(scope="session")
def auth_headers() -> dict[str, str]:
    """Valid auth headers."""
    return {"X-API-Key": "test-secret-key-12345"}


@pytest.fixture(scope="session")
def sample_media_files() -> Generator[dict[str, Path], None, None]:
    """Generate small 1-second synthetic video and audio files using FFmpeg for testing."""
    temp_dir = Path(tempfile.mkdtemp(prefix="shorts_test_media_"))
    video_path = temp_dir / "sample_video.mp4"
    audio_path = temp_dir / "sample_audio.mp3"

    # Create 1s synthetic video: 1280x720 25fps blue background
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x112233:s=1280x720:d=1:r=25",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(video_path),
        ],
        check=True,
        capture_output=True,
    )

    # Create 1s synthetic audio: 440Hz sine wave
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "libmp3lame",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
    )

    yield {"video": video_path, "audio": audio_path}

    shutil.rmtree(temp_dir, ignore_errors=True)
