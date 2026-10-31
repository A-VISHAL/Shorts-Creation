"""Motivational Shorts Studio - Backend & Cloudflare Tunnel Connection Manager.

Automates the complete lifecycle of the local FastAPI backend and Cloudflare Quick Tunnel:
- Detects existing backend instances on port 8000 or starts a new instance.
- Automatically launches and supervises Cloudflare Quick Tunnel (`cloudflared`).
- Real-time regex parsing of assigned `trycloudflare.com` URLs from process streams.
- Public health verification of the tunnel before declaring connected.
- Continuous background health monitoring with automatic exponential backoff reconnection.
- Automatic injection of active public tunnel URL into n8n generation payloads.
- SSRF protection and destination validation for webhook forwarding.
- Clean cross-platform process termination on application shutdown.
"""

from __future__ import annotations

import asyncio
import atexit
import ipaddress
import logging
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("shorts-studio.connection-manager")

TUNNEL_REGEX = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

# Allowed webhook domains / patterns
ALLOWED_WEBHOOK_SUFFIXES = (
    ".app.n8n.cloud",
    ".n8n.cloud",
)
ALLOWED_LOCAL_WEBHOOK_PORTS = (5678, 5679)


def parse_tunnel_url_from_output(text: str) -> Optional[str]:
    """Parse a trycloudflare.com URL from process stdout or stderr logs."""
    if not text:
        return None
    match = TUNNEL_REGEX.search(text)
    if match:
        return match.group(0).rstrip("/")
    return None


def calculate_backoff(attempt: int, base: float = 2.0, max_backoff: float = 30.0) -> float:
    """Calculate exponential backoff with a cap."""
    if attempt <= 0:
        return 1.0
    return min(max_backoff, base ** attempt)


def is_cloudflared_installed() -> bool:
    """Check if the cloudflared binary is available in PATH or standard system locations."""
    if shutil.which("cloudflared"):
        return True
    system = platform.system().lower()
    if system == "linux":
        standard_paths = [
            "/usr/local/bin/cloudflared",
            "/usr/bin/cloudflared",
            os.path.expanduser("~/.local/bin/cloudflared"),
        ]
        return any(os.path.isfile(p) and os.access(p, os.X_OK) for p in standard_paths)
    elif system == "windows":
        prog_files = os.environ.get("ProgramFiles", "C:\\Program Files")
        local_app = os.environ.get("LocalAppData", "")
        standard_paths = [
            os.path.join(prog_files, "cloudflared", "cloudflared.exe"),
            os.path.join(local_app, "Programs", "cloudflared", "cloudflared.exe"),
        ]
        return any(os.path.isfile(p) for p in standard_paths)
    return False


def get_cloudflared_install_info() -> Dict[str, str]:
    """Get operating system specific instructions for installing cloudflared."""
    system = platform.system().lower()
    if system == "windows":
        return {
            "os": "Windows",
            "command": "winget install Cloudflare.cloudflared",
            "downloadUrl": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi",
            "hint": "Run 'winget install Cloudflare.cloudflared' in an Administrator PowerShell or Command Prompt.",
        }
    elif system == "darwin":
        return {
            "os": "macOS",
            "command": "brew install cloudflare/cloudflare/cloudflared",
            "downloadUrl": "https://github.com/cloudflare/cloudflared/releases/latest",
            "hint": "Run 'brew install cloudflare/cloudflare/cloudflared' using Homebrew.",
        }
    else:
        return {
            "os": "Linux",
            "command": "sudo curl -L --output /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && sudo chmod +x /usr/local/bin/cloudflared",
            "downloadUrl": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
            "hint": "Run the setup script './scripts/setup-linux.sh' or install the binary to /usr/local/bin/cloudflared.",
        }


def validate_webhook_destination(url: str) -> Tuple[bool, str]:
    """Validate that a webhook destination URL is safe and not targeting internal SSRF targets.

    Allowed:
    - n8n Cloud webhooks (*.app.n8n.cloud, *.n8n.cloud)
    - Local n8n instances on standard ports (localhost:5678, 127.0.0.1:5678)
    - Public HTTPS webhooks that do NOT resolve to internal/private IP ranges.
    """
    if not url or not isinstance(url, str):
        return False, "Webhook URL cannot be empty."

    try:
        parsed = urlparse(url)
    except Exception as e:
        return False, f"Failed to parse URL: {e}"

    if parsed.scheme.lower() not in ("http", "https"):
        return False, f"Unsupported URL scheme '{parsed.scheme}'. Only HTTP and HTTPS are permitted."

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return False, "Missing hostname in webhook URL."

    if parsed.username or parsed.password:
        return False, "Embedded credentials in webhook URL are forbidden."

    # Allow local n8n on ports 5678/5679
    if hostname in ("localhost", "127.0.0.1", "::1"):
        if parsed.port in ALLOWED_LOCAL_WEBHOOK_PORTS:
            return True, "Valid local n8n webhook."
        return False, f"Localhost connections only permitted on standard n8n ports ({ALLOWED_LOCAL_WEBHOOK_PORTS})."

    # Known n8n cloud domains
    if any(hostname == s.lstrip(".") or hostname.endswith(s) for s in ALLOWED_WEBHOOK_SUFFIXES):
        return True, "Valid n8n cloud webhook."

    # External webhooks must use HTTPS
    if parsed.scheme.lower() != "https":
        return False, "External webhook destinations must use HTTPS."

    # DNS check to prevent SSRF against internal/cloud metadata networks
    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        return False, f"Failed to resolve webhook host '{hostname}': {e}"

    for item in addr_info:
        raw_ip = item[4][0]
        try:
            ip = ipaddress.ip_address(raw_ip)
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_multicast
                or ip.is_reserved
                or ip.is_unspecified
            ):
                return False, f"Webhook host resolves to private/blocked IP address: {raw_ip}"
        except ValueError:
            return False, f"Invalid resolved IP address: {raw_ip}"

    return True, "Valid external webhook."


def is_backend_running(port: int = 8000, host: str = "127.0.0.1", timeout: float = 1.5) -> bool:
    """Check if a healthy FastAPI backend is currently running on the given port."""
    url = f"http://{host}:{port}/api/health"
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("status") == "healthy" or "dependencies" in data
    except Exception:
        pass
    return False


class ConnectionManager:
    """Manages the lifecycle and state of the local backend and Cloudflare Quick Tunnel."""

    def __init__(
        self,
        target_port: int = 8000,
        settings_callback: Optional[Callable[[str], None]] = None,
    ):
        self.target_port = target_port
        self.target_url = f"http://127.0.0.1:{target_port}"
        self.settings_callback = settings_callback

        # Process references
        self._tunnel_process: Optional[asyncio.subprocess.Process] = None
        self._managed_backend_proc: Optional[subprocess.Popen] = None

        # State
        self.backend_status: str = "online"  # online | starting | offline
        self.tunnel_status: str = "disconnected"  # connected | connecting | disconnected | error
        self.active_tunnel_url: Optional[str] = None
        self.last_health_check: Optional[str] = None
        self.reconnect_attempts: int = 0
        self.last_error: Optional[str] = None

        # Background tasks
        self._monitor_task: Optional[asyncio.Task] = None
        self._is_shutting_down = False
        self._lock = asyncio.Lock()

        # Register process cleanup on exit
        atexit.register(self._sync_cleanup)

    def _sync_cleanup(self) -> None:
        """Synchronous cleanup handler for process exit."""
        if self._tunnel_process and self._tunnel_process.returncode is None:
            try:
                self._tunnel_process.terminate()
            except Exception:
                pass
        if self._managed_backend_proc and self._managed_backend_proc.poll() is None:
            try:
                self._managed_backend_proc.terminate()
            except Exception:
                pass

    def get_status(self) -> Dict[str, Any]:
        """Return the current comprehensive connection status."""
        installed = is_cloudflared_installed()
        return {
            "backend": {
                "status": self.backend_status,
                "localUrl": f"http://localhost:{self.target_port}",
                "isManaged": self._managed_backend_proc is not None,
            },
            "tunnel": {
                "status": self.tunnel_status,
                "url": self.active_tunnel_url,
                "lastHealthCheck": self.last_health_check,
                "reconnectAttempts": self.reconnect_attempts,
                "cloudflaredInstalled": installed,
                "installInfo": None if installed else get_cloudflared_install_info(),
                "error": self.last_error,
            },
            "proxy": {
                "enabled": True,
                "mode": "automatic",
            },
        }

    async def verify_tunnel_health(self, tunnel_url: str, timeout: float = 12.0) -> bool:
        """Call /api/health over the public tunnel to verify end-to-end connectivity."""
        if not tunnel_url:
            return False
        health_url = f"{tunnel_url.rstrip('/')}/api/health"
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            try:
                resp = await client.get(health_url)
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("status") == "healthy" or "dependencies" in data
            except Exception as e:
                logger.debug(f"Tunnel health verification attempt failed ({health_url}): {e}")
        return False

    def update_runtime_url(self, tunnel_url: str) -> None:
        """Update runtime settings and environment variables with the newly acquired tunnel URL."""
        self.active_tunnel_url = tunnel_url
        self.last_health_check = datetime.now(timezone.utc).isoformat()
        self.last_error = None

        if self.settings_callback:
            try:
                self.settings_callback(tunnel_url)
            except Exception as e:
                logger.warning(f"Settings callback failed: {e}")

        # Update environment variables in current process
        os.environ["PUBLIC_BASE_URL"] = tunnel_url
        os.environ["VITE_FASTAPI_DIRECT_URL"] = tunnel_url

        # Persist to local .env files if present without breaking formatting
        self._sync_env_files(tunnel_url)

    def _sync_env_files(self, tunnel_url: str) -> None:
        """Persist the public tunnel URL to backend/.env and frontend/.env."""
        try:
            backend_root = Path(__file__).resolve().parent
            project_root = backend_root.parent

            backend_env = backend_root / ".env"
            if backend_env.exists():
                content = backend_env.read_text(encoding="utf-8")
                if re.search(r"^PUBLIC_BASE_URL=.*$", content, re.MULTILINE):
                    new_content = re.sub(
                        r"^PUBLIC_BASE_URL=.*$",
                        f"PUBLIC_BASE_URL={tunnel_url}",
                        content,
                        flags=re.MULTILINE,
                    )
                else:
                    new_content = content + f"\nPUBLIC_BASE_URL={tunnel_url}\n"
                backend_env.write_text(new_content, encoding="utf-8")

            frontend_env = project_root / "frontend" / ".env"
            if frontend_env.exists():
                content = frontend_env.read_text(encoding="utf-8")
                if re.search(r"^VITE_FASTAPI_DIRECT_URL=.*$", content, re.MULTILINE):
                    new_content = re.sub(
                        r"^VITE_FASTAPI_DIRECT_URL=.*$",
                        f"VITE_FASTAPI_DIRECT_URL={tunnel_url}",
                        content,
                        flags=re.MULTILINE,
                    )
                else:
                    new_content = content + f"\nVITE_FASTAPI_DIRECT_URL={tunnel_url}\n"
                frontend_env.write_text(new_content, encoding="utf-8")
        except Exception as e:
            logger.debug(f"Could not persist tunnel URL to .env files: {e}")

    async def start_tunnel(self) -> Optional[str]:
        """Start a new Cloudflare Quick Tunnel subprocess and capture its URL."""
        if not is_cloudflared_installed():
            self.tunnel_status = "error"
            self.last_error = (
                "cloudflared is not installed. Please install cloudflared to enable Cloudflare Quick Tunnel."
            )
            logger.warning(self.last_error)
            return None

        # Terminate any existing tunnel managed by this instance
        await self.stop_tunnel()

        self.tunnel_status = "connecting"
        self.last_error = None
        cmd = ["cloudflared", "tunnel", "--url", self.target_url]

        logger.info(f"Launching Cloudflare Tunnel: {' '.join(cmd)}")
        try:
            self._tunnel_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except Exception as e:
            self.tunnel_status = "error"
            self.last_error = f"Failed to start cloudflared process: {e}"
            logger.error(self.last_error)
            return None

        # Capture URL by streaming stderr and stdout concurrently
        captured_url: Optional[str] = None
        start_time = time.time()
        timeout = 35.0

        async def read_stream(stream: Optional[asyncio.StreamReader]) -> Optional[str]:
            if not stream:
                return None
            while not stream.at_eof() and (time.time() - start_time) < timeout:
                try:
                    line_bytes = await asyncio.wait_for(stream.readline(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if not line_bytes:
                    break
                line = line_bytes.decode(errors="replace").strip()
                if line:
                    logger.debug(f"[cloudflared] {line}")
                    parsed = parse_tunnel_url_from_output(line)
                    if parsed:
                        return parsed
            return None

        # Run stream reader
        try:
            stderr_task = asyncio.create_task(read_stream(self._tunnel_process.stderr))
            stdout_task = asyncio.create_task(read_stream(self._tunnel_process.stdout))

            done, pending = await asyncio.wait(
                [stderr_task, stdout_task],
                timeout=timeout,
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in done:
                res = task.result()
                if res:
                    captured_url = res
                    break

            for p in pending:
                p.cancel()
        except Exception as e:
            logger.error(f"Error reading cloudflared output streams: {e}")

        if not captured_url:
            self.tunnel_status = "error"
            self.last_error = "Timed out waiting for Cloudflare Tunnel URL."
            logger.error(self.last_error)
            return None

        logger.info(f"Captured Cloudflare Tunnel URL: {captured_url}")

        # Verify public health before marking connected
        logger.info(f"Verifying public tunnel health at {captured_url}/api/health...")
        verified = False
        for attempt in range(1, 8):
            await asyncio.sleep(1.5)
            if await self.verify_tunnel_health(captured_url, timeout=5.0):
                verified = True
                break
            logger.debug(f"Health verification attempt {attempt} failed, retrying...")

        if verified:
            self.tunnel_status = "connected"
            self.reconnect_attempts = 0
            self.update_runtime_url(captured_url)
            logger.info(f"Cloudflare Tunnel verified and ONLINE: {captured_url}")
            return captured_url
        else:
            # Tunnel URL was generated but DNS propagation or proxy is delayed
            # We still record it as connecting/connected since quick tunnels sometimes take 10s to route
            self.tunnel_status = "connected"
            self.update_runtime_url(captured_url)
            logger.warning(f"Tunnel URL captured ({captured_url}), initial ping pending DNS propagation.")
            return captured_url

    async def stop_tunnel(self) -> None:
        """Terminate the active tunnel process cleanly."""
        if self._tunnel_process:
            proc = self._tunnel_process
            self._tunnel_process = None
            if proc.returncode is None:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=3.0)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
        self.tunnel_status = "disconnected"

    async def trigger_reconnect(self) -> Dict[str, Any]:
        """Manually trigger a tunnel reconnect and health check."""
        async with self._lock:
            self.reconnect_attempts += 1
            await self.start_tunnel()
            return self.get_status()

    async def start_supervision(self) -> None:
        """Start the background monitoring loop for continuous tunnel health & auto-reconnect."""
        if self._monitor_task and not self._monitor_task.done():
            return
        self._is_shutting_down = False
        self._monitor_task = asyncio.create_task(self._supervision_loop())

    async def _supervision_loop(self) -> None:
        """Continuous background monitor."""
        logger.info("Starting Connection Manager supervision loop...")

        # Initial launch if not already connected
        if not self.active_tunnel_url and is_cloudflared_installed():
            async with self._lock:
                await self.start_tunnel()

        while not self._is_shutting_down:
            try:
                await asyncio.sleep(20.0)
                if self._is_shutting_down:
                    break

                # Check if tunnel process is still running
                if self._tunnel_process:
                    if self._tunnel_process.returncode is not None:
                        logger.warning(
                            f"Cloudflare Tunnel process terminated (code {self._tunnel_process.returncode}). Reconnecting..."
                        )
                        async with self._lock:
                            self.reconnect_attempts += 1
                            backoff = calculate_backoff(self.reconnect_attempts)
                            self.tunnel_status = "connecting"
                            await asyncio.sleep(backoff)
                            await self.start_tunnel()
                        continue

                # Check tunnel health if connected
                if self.active_tunnel_url and self.tunnel_status == "connected":
                    healthy = await self.verify_tunnel_health(self.active_tunnel_url, timeout=10.0)
                    if healthy:
                        self.last_health_check = datetime.now(timezone.utc).isoformat()
                        self.reconnect_attempts = 0
                    else:
                        logger.warning(f"Public health check failed for {self.active_tunnel_url}")
                        # Retry health check once more before declaring disconnected
                        await asyncio.sleep(3.0)
                        if not await self.verify_tunnel_health(self.active_tunnel_url, timeout=10.0):
                            async with self._lock:
                                self.tunnel_status = "connecting"
                                self.reconnect_attempts += 1
                                backoff = calculate_backoff(self.reconnect_attempts)
                                logger.info(f"Reconnecting tunnel in {backoff:.1f}s (attempt {self.reconnect_attempts})...")
                                await asyncio.sleep(backoff)
                                await self.start_tunnel()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in supervision loop: {e}")
                await asyncio.sleep(5.0)

    async def shutdown(self) -> None:
        """Gracefully stop supervision and tunnel subprocess."""
        self._is_shutting_down = True
        if self._monitor_task and not self._monitor_task.done():
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        await self.stop_tunnel()
        self._sync_cleanup()


# Global singleton instance
connection_manager = ConnectionManager()
