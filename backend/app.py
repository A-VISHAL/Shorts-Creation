"""Motivational Shorts Studio - FastAPI Backend.

Provides endpoints for downloading media, rendering 9:16 vertical YouTube Shorts
with text overlays and background music using FFmpeg, and securely serving media.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlparse

import httpx
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Request,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("shorts-studio")


class Settings(BaseSettings):
    shorts_api_key: str = Field(default="dev-shorts-secret-key-2024", alias="SHORTS_API_KEY")
    public_base_url: str = Field(default="http://localhost:8000", alias="PUBLIC_BASE_URL")
    media_dir: str = Field(default="./media", alias="MEDIA_DIR")
    max_download_mb: int = Field(default=250, alias="MAX_DOWNLOAD_MB")
    render_timeout_seconds: int = Field(default=300, alias="RENDER_TIMEOUT_SECONDS")
    allowed_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000",
        alias="ALLOWED_ORIGINS",
    )
    media_retention_hours: int = Field(default=48, alias="MEDIA_RETENTION_HOURS")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

MEDIA_PATH = Path(settings.media_dir).resolve()
MEDIA_PATH.mkdir(parents=True, exist_ok=True)

# -----------------------------------------------------------------------------
# Application Setup & CORS
# -----------------------------------------------------------------------------

app = FastAPI(
    title="Motivational Shorts Studio API",
    description="Backend service for generating motivational YouTube Shorts with FFmpeg and n8n",
    version="1.0.0",
)

allowed_origins_list = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
if not allowed_origins_list:
    allowed_origins_list = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job state store
jobs_lock = asyncio.Lock()
JOBS: Dict[str, Dict[str, Any]] = {}

# -----------------------------------------------------------------------------
# Security & SSRF Protection
# -----------------------------------------------------------------------------

BLOCKED_IP_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("255.255.255.255/32"),
    # IPv6 blocked
    ipaddress.ip_network("::/128"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Check if an IP address belongs to private, loopback, or reserved ranges."""
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return True
    return any(ip in net for net in BLOCKED_IP_NETWORKS)


def get_public_base_url(request: Optional[Request] = None) -> str:
    """Return configured PUBLIC_BASE_URL, or deduce dynamically from reverse proxy/tunnel headers."""
    if request:
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if host and ("trycloudflare.com" in host or "ngrok" in host):
            return f"{proto}://{host}"
    return settings.public_base_url.rstrip("/")


def is_local_media_url(url: str, request: Optional[Request] = None) -> bool:
    """Check if the URL points directly to this backend's own media directory."""
    parsed = urlparse(url)
    public_parsed = urlparse(settings.public_base_url)
    current_public = urlparse(get_public_base_url(request))

    # Match public base url host/port, tunnel host, or local host
    is_same_host = (
        parsed.netloc == public_parsed.netloc
        or parsed.netloc == current_public.netloc
        or (parsed.hostname and "trycloudflare.com" in parsed.hostname)
        or parsed.hostname in ("localhost", "127.0.0.1", "0.0.0.0")
    )
    if is_same_host and parsed.path.startswith("/media/"):
        return True
    return False


def validate_url_safety(url: str, request: Optional[Request] = None) -> None:
    """Validate URL scheme and resolve host IP to block SSRF and local network access.

    Permits self-referencing media URLs configured in PUBLIC_BASE_URL.
    """
    if is_local_media_url(url, request):
        return

    parsed = urlparse(url)
    if parsed.scheme.lower() not in ("http", "https"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported URL scheme: '{parsed.scheme}'. Only HTTP and HTTPS are permitted.",
        )

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid URL: Missing hostname.",
        )

    if parsed.username or parsed.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URLs with embedded credentials are not allowed.",
        )

    # Check hostname against known localhost aliases
    if hostname.lower() in ("localhost", "localhost.localdomain", "127.0.0.1", "::1"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Access to localhost or private network targets is prohibited.",
        )

    # DNS Resolution and IP validation
    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to resolve host '{hostname}': {e}",
        )

    for item in addr_info:
        sockaddr = item[4]
        raw_ip = sockaddr[0]
        try:
            ip = ipaddress.ip_address(raw_ip)
            if is_ip_blocked(ip):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Target host '{hostname}' resolves to blocked private/local IP: {raw_ip}",
                )
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid IP address resolved: {raw_ip}",
            )


def verify_api_key(x_api_key: Optional[str] = Header(None, alias="X-API-Key")) -> str:
    """Authenticate request using constant-time API key comparison."""
    if not x_api_key:
        logger.warning("Request rejected: Missing X-API-Key header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing required 'X-API-Key' header.",
        )

    if not secrets.compare_digest(x_api_key, settings.shorts_api_key):
        logger.warning("Request rejected: Invalid API key provided")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key provided.",
        )
    return x_api_key


# -----------------------------------------------------------------------------
# Font Detection Helper
# -----------------------------------------------------------------------------

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def get_default_font_path() -> Optional[str]:
    """Find a readable, bold TrueType font on the system for FFmpeg drawtext."""
    for font_path in FONT_CANDIDATES:
        if os.path.exists(font_path):
            return font_path
    return None


def get_ytdlp_binary() -> str:
    """Return the absolute path to the latest yt-dlp binary, preferring venv/local installation over outdated system package."""
    # Priority 1: Current Python virtual environment bin (where the latest version is installed)
    venv_ytdlp = Path(sys.prefix) / "bin" / "yt-dlp"
    if venv_ytdlp.is_file() and os.access(venv_ytdlp, os.X_OK):
        return str(venv_ytdlp)

    # Priority 2: User local bin (~/.local/bin/yt-dlp)
    user_ytdlp = Path.home() / ".local" / "bin" / "yt-dlp"
    if user_ytdlp.is_file() and os.access(user_ytdlp, os.X_OK):
        return str(user_ytdlp)

    # Priority 3: System PATH
    found = shutil.which("yt-dlp")
    if found:
        return found

    return "yt-dlp"


# -----------------------------------------------------------------------------
# Pydantic Request & Response Models
# -----------------------------------------------------------------------------


class DownloadRequest(BaseModel):
    url: str = Field(..., description="Source video or audio URL (direct or yt-dlp supported)")
    media_type: Literal["video", "audio"] = Field(
        default="video", description="Type of media to download and process"
    )

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def normalize_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Accept sourceUrl as alias for url
            if "url" not in data and "sourceUrl" in data:
                data["url"] = data["sourceUrl"]
            # Accept mediaType as alias for media_type
            if "media_type" not in data and "mediaType" in data:
                data["media_type"] = data["mediaType"]
        return data

    @field_validator("url")
    def validate_url_format(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v


class DownloadResponse(BaseModel):
    success: bool
    mediaUrl: str
    downloadUrl: Optional[str] = None
    filename: str
    mediaType: str
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    sizeBytes: int
    contentType: str


class RenderRequest(BaseModel):
    videoUrl: str = Field(..., description="Source video URL or local media URL")
    musicUrl: str = Field(..., description="Source music/soundtrack URL or local media URL")
    text: str = Field(..., min_length=3, max_length=500, description="Motivational quote or overlay text")
    title: Optional[str] = Field(default="Motivational Short", max_length=100)
    durationSeconds: int = Field(default=30, ge=5, le=120, description="Target duration in seconds")
    width: int = Field(default=1080, ge=480, le=2160, description="Canvas width (default 1080 for 9:16)")
    height: int = Field(default=1920, ge=480, le=3840, description="Canvas height (default 1920 for 9:16)")
    style: Literal["dark-motivational", "minimal-white", "bold-motivational"] = Field(
        default="dark-motivational", description="Visual styling preset"
    )

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def normalize_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "videoUrl" not in data and "video_url" in data:
                data["videoUrl"] = data["video_url"]
            if "musicUrl" not in data and "music_url" in data:
                data["musicUrl"] = data["music_url"]
            if "durationSeconds" not in data and "duration" in data:
                try:
                    data["durationSeconds"] = int(data["duration"])
                except Exception:
                    pass
        return data

    @field_validator("text")
    def clean_text(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Motivational text cannot be empty or whitespace only.")
        return clean


class RenderResponse(BaseModel):
    success: bool
    jobId: str
    status: str
    videoUrl: str
    downloadUrl: str
    filename: str
    title: str
    durationSeconds: int
    width: int
    height: int
    sizeBytes: int
    style: str


class JobStatusResponse(BaseModel):
    jobId: str
    status: Literal["pending", "processing", "completed", "failed"]
    progressStage: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    createdAt: float
    completedAt: Optional[float] = None


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    timestamp: float
    dependencies: Dict[str, bool]
    storage: Dict[str, Any]
    config: Dict[str, Any]


class WebhookProxyRequest(BaseModel):
    webhookUrl: str = Field(..., description="Target n8n webhook URL")
    payload: Dict[str, Any] = Field(..., description="Short payload to forward to n8n webhook")


# -----------------------------------------------------------------------------
# FFprobe & Media Inspection
# -----------------------------------------------------------------------------


def probe_media_file(file_path: Path) -> Dict[str, Any]:
    """Run ffprobe on a file to inspect dimensions, duration, format, and codecs."""
    if not file_path.exists():
        raise FileNotFoundError(f"Media file not found: {file_path}")

    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,duration",
        "-of",
        "json",
        str(file_path),
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if proc.returncode != 0:
            logger.warning(f"ffprobe returned non-zero code {proc.returncode}: {proc.stderr}")
            return {"size": file_path.stat().st_size}

        data = json.loads(proc.stdout)
        fmt = data.get("format", {})
        streams = data.get("streams", [])

        video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

        duration = None
        if "duration" in fmt and fmt["duration"] != "N/A":
            try:
                duration = float(fmt["duration"])
            except ValueError:
                pass

        if duration is None and video_stream and "duration" in video_stream:
            try:
                duration = float(video_stream["duration"])
            except ValueError:
                pass

        return {
            "duration": duration,
            "size": file_path.stat().st_size,
            "format": fmt.get("format_name"),
            "width": video_stream.get("width") if video_stream else None,
            "height": video_stream.get("height") if video_stream else None,
            "video_codec": video_stream.get("codec_name") if video_stream else None,
            "audio_codec": audio_stream.get("codec_name") if audio_stream else None,
        }
    except Exception as e:
        logger.error(f"Error inspecting media with ffprobe: {e}")
        return {"size": file_path.stat().st_size}


# -----------------------------------------------------------------------------
# Media Downloader Implementation
# -----------------------------------------------------------------------------


async def download_direct_stream(url: str, output_path: Path, max_bytes: int) -> int:
    """Download direct media URL via HTTP streaming with strict size enforcement."""
    total_bytes = 0
    timeout = httpx.Timeout(connect=20.0, read=45.0, write=20.0, pool=10.0)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        # Pre-check HEAD if supported
        try:
            head_resp = await client.head(url)
            cl = head_resp.headers.get("content-length")
            if cl and int(cl) > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Source file exceeds maximum allowed download size of {max_bytes // (1024*1024)} MB.",
                )
        except HTTPException:
            raise
        except Exception:
            pass  # Fall back to stream counting

        async with client.stream("GET", url) as response:
            if response.status_code >= 400:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to fetch media from {url}: HTTP {response.status_code}",
                )

            with open(output_path, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        if output_path.exists():
                            output_path.unlink()
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Download aborted: file exceeds size limit of {max_bytes // (1024*1024)} MB.",
                        )
                    f.write(chunk)

    return total_bytes


async def download_with_ytdlp(url: str, output_template: Path, media_type: str, max_mb: int) -> Path:
    """Download video or audio using yt-dlp with argument array (no shell=True)."""
    ytdlp_bin = get_ytdlp_binary()
    logger.info(f"Using yt-dlp binary: {ytdlp_bin}")

    cmd = [
        ytdlp_bin,
        "--no-playlist",
        "--max-filesize",
        f"{max_mb}M",
        "--socket-timeout",
        "30",
        "--no-warnings",
    ]

    if media_type == "audio":
        # Extract best audio to mp3
        cmd.extend([
            "-f",
            "ba[ext=m4a]/ba/b/best",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "-o",
            f"{output_template}.%(ext)s",
            url,
        ])
    else:
        # Video: prefer MP4 container, merge audio/video if separate streams, fallback to best
        cmd.extend([
            "-f",
            "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b/best",
            "--merge-output-format",
            "mp4",
            "-o",
            f"{output_template}.%(ext)s",
            url,
        ])

    logger.info(f"Executing yt-dlp command for url={url}")
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=180.0)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Media download timed out after 180 seconds.",
        )

    if proc.returncode != 0:
        err_msg = stderr.decode(errors="replace").strip()
        logger.error(f"yt-dlp failed (code {proc.returncode}): {err_msg}")

        # Provide actionable, friendly messages for common YouTube/yt-dlp errors
        if "Private video" in err_msg or "Sign in to confirm" in err_msg:
            detail = "The video is private, restricted, or requires YouTube authentication. Please use a public video URL."
        elif "Video unavailable" in err_msg or "This video is unavailable" in err_msg:
            detail = "The requested video is unavailable or has been removed."
        elif "age-restricted" in err_msg.lower():
            detail = "The video is age-restricted and cannot be downloaded without authentication. Please use a public unrestricted video."
        elif "Unsupported URL" in err_msg or "is not a valid URL" in err_msg:
            detail = f"The URL '{url}' is not supported by yt-dlp or is invalid."
        elif "Requested format is not available" in err_msg:
            detail = "Requested media format was not available for this URL. Please verify the URL or try another media source."
        else:
            clean_err = err_msg.split("\n")[-1] if err_msg else "Unknown download error"
            detail = f"Failed to download media via yt-dlp: {clean_err}"

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )

    # Locate generated output file matching prefix, ignoring temporary download files (.part, .ytdl, etc.)
    parent_dir = output_template.parent
    prefix = output_template.name
    candidates = [
        f for f in parent_dir.glob(f"{prefix}.*")
        if not f.name.endswith((".part", ".ytdl", ".temp", ".tmp"))
    ]

    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="yt-dlp completed but output file could not be located.",
        )

    # Pick the primary media file with the largest size
    chosen = max(candidates, key=lambda f: f.stat().st_size)
    if chosen.stat().st_size == 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Downloaded media file is empty (0 bytes).",
        )

    return chosen


async def resolve_or_download_media(url: str, media_type: str, request: Optional[Request] = None) -> Path:
    """Resolve a local media URL or download an external source to MEDIA_PATH."""
    validate_url_safety(url, request)

    # 1. Check if it's already a local media file served by this instance
    if is_local_media_url(url, request):
        filename = urlparse(url).path.split("/")[-1]
        local_file = (MEDIA_PATH / filename).resolve()
        if local_file.is_file() and local_file.is_relative_to(MEDIA_PATH):
            logger.info(f"Reusing already downloaded local media file: {filename}")
            return local_file

    # 2. Check if it is a direct media file (e.g., .mp4, .mp3, etc.)
    parsed_path = urlparse(url).path.lower()
    is_direct_video = any(parsed_path.endswith(ext) for ext in (".mp4", ".mov", ".webm", ".mkv"))
    is_direct_audio = any(parsed_path.endswith(ext) for ext in (".mp3", ".wav", ".m4a", ".aac", ".ogg"))
    max_bytes = settings.max_download_mb * 1024 * 1024
    unique_id = uuid.uuid4().hex[:10]

    if (media_type == "video" and is_direct_video) or (media_type == "audio" and is_direct_audio):
        ext = ".mp4" if media_type == "video" else ".mp3"
        dest = MEDIA_PATH / f"dl_{media_type}_{unique_id}{ext}"
        logger.info(f"Downloading direct media stream to {dest.name}")
        await download_direct_stream(url, dest, max_bytes)
        return dest

    # 3. Use yt-dlp for YouTube, generic web pages, or streaming providers
    output_prefix = MEDIA_PATH / f"dl_{media_type}_{unique_id}"
    return await download_with_ytdlp(url, output_prefix, media_type, settings.max_download_mb)


# -----------------------------------------------------------------------------
# FFmpeg Render Engine
# -----------------------------------------------------------------------------


def format_quote_lines(text: str, max_line_width: int = 28) -> str:
    """Smart word-wrapping for motivational quote display on 9:16 vertical canvas."""
    # Split paragraphs by explicit user newlines first
    paragraphs = text.split("\n")
    wrapped_lines: List[str] = []

    for p in paragraphs:
        cleaned = p.strip()
        if not cleaned:
            continue
        wrapped = textwrap.wrap(
            cleaned,
            width=max_line_width,
            break_long_words=False,
            break_on_hyphens=False,
        )
        wrapped_lines.extend(wrapped)

    return "\n".join(wrapped_lines)


def build_drawtext_filter(
    text_file_path: Path,
    style: str,
    font_file: Optional[str],
    width: int,
    height: int,
) -> str:
    """Generate FFmpeg drawtext filter string with styling and safe textfile reference."""
    # Escape path characters for FFmpeg filter argument
    escaped_text_path = str(text_file_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")

    font_arg = ""
    if font_file:
        escaped_font_path = font_file.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        font_arg = f":fontfile='{escaped_font_path}'"

    # Responsive font size calculation relative to canvas width
    font_size = max(36, int(width * 0.052))
    line_spacing = max(16, int(font_size * 0.4))

    # Base styling
    if style == "minimal-white":
        border_w = 2
        border_color = "black@0.6"
        shadow_x = 2
        shadow_y = 2
        shadow_color = "black@0.4"
        font_color = "white"
    elif style == "bold-motivational":
        border_w = 4
        border_color = "black@0.9"
        shadow_x = 4
        shadow_y = 4
        shadow_color = "black@0.8"
        font_color = "0xFFD700"  # Gold accent
    else:  # dark-motivational (default)
        border_w = 3
        border_color = "black@0.85"
        shadow_x = 3
        shadow_y = 4
        shadow_color = "black@0.75"
        font_color = "white"

    drawtext_filter = (
        f"drawtext=textfile='{escaped_text_path}'"
        f"{font_arg}"
        f":fontsize={font_size}"
        f":fontcolor={font_color}"
        f":borderw={border_w}"
        f":bordercolor={border_color}"
        f":shadowx={shadow_x}"
        f":shadowy={shadow_y}"
        f":shadowcolor={shadow_color}"
        f":x=(w-text_w)/2"
        f":y=(h-text_h)/2"
        f":line_spacing={line_spacing}"
    )
    return drawtext_filter


async def render_short_video(
    video_path: Path,
    music_path: Path,
    quote_text: str,
    title: str,
    duration: int,
    width: int,
    height: int,
    style: str,
    output_path: Path,
) -> Path:
    """Render 9:16 vertical video Short using FFmpeg subprocess execution."""
    font_file = get_default_font_path()
    formatted_quote = format_quote_lines(quote_text, max_line_width=28)

    # Dark overlay intensity per style
    if style == "minimal-white":
        overlay_alpha = "0.3"
    elif style == "bold-motivational":
        overlay_alpha = "0.5"
    else:
        overlay_alpha = "0.45"

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as tf:
        tf.write(formatted_quote)
        temp_text_path = Path(tf.name)

    try:
        drawtext_filter = build_drawtext_filter(temp_text_path, style, font_file, width, height)

        # Video filter chain:
        # 1. Scale to fit vertical dimension while preserving aspect ratio, then center crop to exact 9:16
        # 2. Draw semi-transparent dark overlay across canvas to enhance quote readability
        # 3. Draw centered motivational text
        video_filters = (
            f"[0:v]scale=w={width}:h={height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},"
            f"drawbox=x=0:y=0:w=iw:h=ih:color=black@{overlay_alpha}:t=fill,"
            f"{drawtext_filter}[v_out]"
        )

        # Audio filter: smooth fade-out during the last 1.5 seconds
        fade_start = max(1.0, float(duration) - 1.5)
        audio_filters = f"[1:a]afade=t=out:st={fade_start:.2f}:d=1.5[a_out]"

        filter_complex = f"{video_filters};{audio_filters}"

        cmd = [
            "ffmpeg",
            "-y",  # Overwrite output without asking
            "-stream_loop",
            "-1",  # Loop video stream if shorter than duration
            "-i",
            str(video_path),
            "-stream_loop",
            "-1",  # Loop audio stream if shorter than duration
            "-i",
            str(music_path),
            "-filter_complex",
            filter_complex,
            "-map",
            "[v_out]",
            "-map",
            "[a_out]",
            "-t",
            str(duration),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "44100",
            str(output_path),
        ]

        logger.info(f"Starting FFmpeg rendering to {output_path.name} (duration={duration}s, size={width}x{height})")
        start_time = time.time()

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=float(settings.render_timeout_seconds),
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"FFmpeg rendering exceeded timeout of {settings.render_timeout_seconds} seconds.",
            )

        elapsed = time.time() - start_time
        if proc.returncode != 0:
            err_output = stderr.decode(errors="replace").strip()
            logger.error(f"FFmpeg failed with code {proc.returncode}: {err_output}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"FFmpeg render failed: {err_output[-400:]}",
            )

        logger.info(f"FFmpeg render completed successfully in {elapsed:.2f}s")

        # Probe and verify output
        probe_info = probe_media_file(output_path)
        out_size = probe_info.get("size", 0)
        out_w = probe_info.get("width")
        out_h = probe_info.get("height")
        out_dur = probe_info.get("duration")

        if out_size < 5000:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Render verification failed: output file is empty or corrupted.",
            )

        if out_w and out_h and (out_w != width or out_h != height):
            logger.warning(f"Rendered dimensions ({out_w}x{out_h}) differ from requested ({width}x{height})")

        logger.info(f"Verified render output: size={out_size} bytes, duration={out_dur}s, dimensions={out_w}x{out_h}")
        return output_path

    finally:
        if temp_text_path.exists():
            temp_text_path.unlink()


# -----------------------------------------------------------------------------
# Periodic File Retention Cleanup
# -----------------------------------------------------------------------------


def cleanup_expired_media() -> None:
    """Remove generated videos and temp files older than retention policy."""
    try:
        now = time.time()
        max_age_seconds = settings.media_retention_hours * 3600
        for item in MEDIA_PATH.iterdir():
            if item.is_file():
                age = now - item.stat().st_mtime
                if age > max_age_seconds:
                    logger.info(f"Removing expired media file: {item.name} (age: {age/3600:.1f}h)")
                    item.unlink(missing_ok=True)
    except Exception as e:
        logger.error(f"Error during media retention cleanup: {e}")


# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------


@app.get("/", summary="Service Status")
async def root_status() -> Dict[str, Any]:
    """Basic service status."""
    return {
        "service": "Motivational Shorts Studio API",
        "status": "online",
        "version": "1.0.0",
        "docsUrl": "/docs",
    }


@app.get("/api/health", response_model=HealthResponse, summary="Backend Health Check")
async def health_check(request: Request) -> HealthResponse:
    """Return backend health and verify dependencies without leaking secret values."""
    ffmpeg_ok = shutil.which("ffmpeg") is not None
    ffprobe_ok = shutil.which("ffprobe") is not None
    ytdlp_ok = shutil.which("yt-dlp") is not None

    total, used, free = shutil.disk_usage(str(MEDIA_PATH))
    current_base = get_public_base_url(request)

    return HealthResponse(
        status="healthy" if (ffmpeg_ok and ffprobe_ok and ytdlp_ok) else "degraded",
        service="Motivational Shorts Studio",
        version="1.0.0",
        timestamp=time.time(),
        dependencies={
            "ffmpeg": ffmpeg_ok,
            "ffprobe": ffprobe_ok,
            "yt-dlp": ytdlp_ok,
            "fontAvailable": get_default_font_path() is not None,
        },
        storage={
            "mediaDir": str(MEDIA_PATH),
            "freeSpaceMb": free // (1024 * 1024),
            "totalSpaceMb": total // (1024 * 1024),
        },
        config={
            "apiKeyConfigured": bool(settings.shorts_api_key),
            "publicBaseUrl": settings.public_base_url,
            "detectedPublicBaseUrl": current_base,
            "maxDownloadMb": settings.max_download_mb,
            "renderTimeoutSeconds": settings.render_timeout_seconds,
            "retentionHours": settings.media_retention_hours,
        },
    )


@app.post(
    "/api/webhook/proxy",
    summary="Forward request to n8n webhook (eliminates browser CORS issues)",
)
async def api_proxy_webhook(req: WebhookProxyRequest, request: Request) -> Any:
    """Proxy request to cloud n8n webhook server-side to eliminate browser CORS preflight errors."""
    parsed = urlparse(req.webhookUrl)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook URL. Must start with http:// or https:// with a valid hostname.",
        )

    payload = dict(req.payload)
    base_url = get_public_base_url(request)
    if "fastApiBaseUrl" not in payload or not payload["fastApiBaseUrl"] or "localhost" in str(payload.get("fastApiBaseUrl", "")):
        payload["fastApiBaseUrl"] = base_url

    logger.info(f"Proxy forwarding to n8n webhook: {req.webhookUrl} (fastApiBaseUrl={payload.get('fastApiBaseUrl')})")

    timeout = httpx.Timeout(connect=25.0, read=300.0, write=30.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        try:
            resp = await client.post(
                req.webhookUrl,
                json=payload,
                headers={"Content-Type": "application/json"},
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Request to n8n webhook timed out after 300 seconds.",
            )
        except Exception as e:
            logger.error(f"Failed to communicate with n8n webhook: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to reach n8n webhook ({req.webhookUrl}): {str(e)}",
            )

    try:
        data = resp.json()
    except Exception:
        data = {"rawResponse": resp.text}

    if resp.status_code >= 400:
        logger.warning(f"n8n webhook returned status {resp.status_code}: {data}")
        err_msg = data.get("message") or data.get("detail") or resp.text or f"n8n webhook returned HTTP {resp.status_code}"
        hint = data.get("hint")
        if resp.status_code == 404 and not hint:
            hint = "If using production URL, ensure the workflow is toggled to Active in n8n. If using test URL, click 'Test workflow' in n8n first."
        return JSONResponse(
            status_code=resp.status_code,
            content={
                "success": False,
                "status": "failed",
                "statusCode": resp.status_code,
                "error": {
                    "code": "N8N_WEBHOOK_ERROR",
                    "message": err_msg,
                    "hint": hint,
                },
                "details": data,
            },
        )

    return data


@app.post(
    "/api/media/download",
    response_model=DownloadResponse,
    summary="Download video or audio source",
    dependencies=[Depends(verify_api_key)],
)
async def api_download_media(req: DownloadRequest, request: Request) -> DownloadResponse:
    """Download supported video or audio via yt-dlp or direct HTTP streaming."""
    logger.info(f"Media download requested for type={req.media_type}, url={req.url}")
    output_file = await resolve_or_download_media(req.url, req.media_type, request)
    probe = probe_media_file(output_file)

    base_url = get_public_base_url(request)
    public_url = f"{base_url}/media/{output_file.name}"
    content_type = "video/mp4" if req.media_type == "video" else "audio/mpeg"

    return DownloadResponse(
        success=True,
        mediaUrl=public_url,
        downloadUrl=public_url,
        filename=output_file.name,
        mediaType=req.media_type,
        duration=probe.get("duration"),
        width=probe.get("width"),
        height=probe.get("height"),
        sizeBytes=probe.get("size", output_file.stat().st_size),
        contentType=content_type,
    )


@app.post(
    "/api/video/render",
    response_model=RenderResponse,
    summary="Render 9:16 Motivational Short",
    dependencies=[Depends(verify_api_key)],
)
async def api_render_video(
    req: RenderRequest,
    background_tasks: BackgroundTasks,
    request: Request,
) -> RenderResponse:
    """Accept downloaded media or URLs, render 9:16 vertical Short, and return public video URL."""
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    created_at = time.time()

    async with jobs_lock:
        JOBS[job_id] = {
            "jobId": job_id,
            "status": "processing",
            "progressStage": "Preparing media inputs",
            "createdAt": created_at,
            "result": None,
            "error": None,
        }

    background_tasks.add_task(cleanup_expired_media)

    try:
        # Resolve source video
        async with jobs_lock:
            JOBS[job_id]["progressStage"] = "Downloading source video"
        video_local_path = await resolve_or_download_media(req.videoUrl, "video", request)

        # Resolve soundtrack
        async with jobs_lock:
            JOBS[job_id]["progressStage"] = "Downloading soundtrack"
        music_local_path = await resolve_or_download_media(req.musicUrl, "audio", request)

        # Render Short
        async with jobs_lock:
            JOBS[job_id]["progressStage"] = "Rendering Short with FFmpeg"

        output_filename = f"rendered_{job_id}.mp4"
        output_path = MEDIA_PATH / output_filename

        await render_short_video(
            video_path=video_local_path,
            music_path=music_local_path,
            quote_text=req.text,
            title=req.title or "Motivational Short",
            duration=req.durationSeconds,
            width=req.width,
            height=req.height,
            style=req.style,
            output_path=output_path,
        )

        async with jobs_lock:
            JOBS[job_id]["progressStage"] = "Verifying output"

        probe = probe_media_file(output_path)
        base_url = get_public_base_url(request)
        public_url = f"{base_url}/media/{output_filename}"
        download_url = f"{base_url}/api/video/{job_id}/download"

        response_payload = {
            "success": True,
            "jobId": job_id,
            "status": "completed",
            "videoUrl": public_url,
            "downloadUrl": download_url,
            "filename": output_filename,
            "title": req.title or "Motivational Short",
            "durationSeconds": req.durationSeconds,
            "width": req.width,
            "height": req.height,
            "sizeBytes": probe.get("size", output_path.stat().st_size),
            "style": req.style,
        }

        async with jobs_lock:
            JOBS[job_id]["status"] = "completed"
            JOBS[job_id]["progressStage"] = "Ready to download"
            JOBS[job_id]["result"] = response_payload
            JOBS[job_id]["completedAt"] = time.time()

        return RenderResponse(**response_payload)

    except Exception as e:
        logger.error(f"Render failed for job {job_id}: {e}", exc_info=True)
        async with jobs_lock:
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["progressStage"] = "Failed"
            JOBS[job_id]["error"] = str(e)
            JOBS[job_id]["completedAt"] = time.time()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Render error: {str(e)}",
        )


@app.get("/api/jobs/{job_id}", response_model=JobStatusResponse, summary="Query Job Status")
async def get_job_status(job_id: str) -> JobStatusResponse:
    """Retrieve status and output metadata for a rendering job."""
    async with jobs_lock:
        job = JOBS.get(job_id)

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )

    return JobStatusResponse(**job)


@app.api_route("/media/{filename}", methods=["GET", "HEAD"], summary="Serve Media Files Safely")
async def serve_media(filename: str, request: Request):
    """Serve rendered MP4s and temporary media files safely with path traversal protection."""
    # Sanitize and resolve file path
    safe_name = os.path.basename(filename)
    target_path = (MEDIA_PATH / safe_name).resolve()

    # Prevent directory traversal attacks
    if not target_path.is_relative_to(MEDIA_PATH) or not target_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Requested media file does not exist.",
        )

    ext = target_path.suffix.lower()
    media_types = {
        ".mp4": "video/mp4",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
        ".webm": "video/webm",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(
        path=target_path,
        media_type=media_type,
        filename=safe_name,
    )


@app.api_route("/api/video/{job_id}/download", methods=["GET", "HEAD"], summary="Download Rendered Short as Attachment")
async def download_video(job_id: str):
    """Convenience endpoint to download the completed Short MP4 as an attachment."""
    filename = f"rendered_{job_id}.mp4"
    target_path = (MEDIA_PATH / filename).resolve()

    if not target_path.is_file() or not target_path.is_relative_to(MEDIA_PATH):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Completed video for job '{job_id}' not found.",
        )

    clean_filename = f"MotivationalShort_{job_id}.mp4"
    return FileResponse(
        path=target_path,
        media_type="video/mp4",
        filename=clean_filename,
        headers={"Content-Disposition": f'attachment; filename="{clean_filename}"'},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
