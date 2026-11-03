"""Multi-Platform Video Publishing Service for Motivational Shorts Studio.

Supports simultaneous, independent publishing to:
1. YouTube Shorts (YouTube Data API v3)
2. Discord (Webhook or Bot attachment upload with size limit validation)
3. Telegram (Bot API sendVideo with size limit validation)
4. Instagram Reels (Meta Instagram Graph API: Container -> Poll -> Publish -> Permalink)

Includes real live authentication tests, missing credentials detection, and secure
credential persistence in backend/.env.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

# Ensure backend/.env is automatically loaded into os.environ
env_path = Path(__file__).parent / ".env"
if env_path.is_file():
    load_dotenv(dotenv_path=env_path, override=False)

logger = logging.getLogger("shorts-studio.publishing")

# File size limits enforced per platform
DISCORD_MAX_BYTES = 25 * 1024 * 1024   # 25 MB standard upload limit
TELEGRAM_MAX_BYTES = 50 * 1024 * 1024  # 50 MB bot API upload limit

# Default Discord Webhook URL fallback
DEFAULT_DISCORD_WEBHOOK_URL = (
    os.getenv("DEFAULT_DISCORD_WEBHOOK_URL", "").strip()
    or "https://discord.com/api/webhooks/1566147524891377846/dXkNoX_h4o-aMNOJTaoOe4gPGGgmSMDUqaI2iYLpveFleZitlM6-4TcsvddQ_0SKCaEh"
)

# Default Telegram Bot Token and Chat ID fallback
DEFAULT_TELEGRAM_BOT_TOKEN = (
    os.getenv("DEFAULT_TELEGRAM_BOT_TOKEN", "").strip()
    or "9004895062:AAGZS4lwUumLy0130bOFwj7dZLM1dHWSK2I"
)
DEFAULT_TELEGRAM_CHAT_ID = (
    os.getenv("DEFAULT_TELEGRAM_CHAT_ID", "").strip()
    or "@lukizerkshorts"
)

# Required environment keys per platform
PLATFORM_REQUIRED_KEYS: Dict[str, List[str]] = {
    "youtube": ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"],
    "discord": ["DISCORD_WEBHOOK_URL"],
    "telegram": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
    "instagram": ["INSTAGRAM_ACCOUNT_ID", "META_ACCESS_TOKEN"],
}


class PublishingService:
    """Manages multi-platform automated video publishing, credential configuration, and live testing."""

    def __init__(self, backend_dir: Optional[Path] = None):
        self.backend_dir = backend_dir or Path(__file__).parent.resolve()
        # Cache for live connection test results
        self._test_cache: Dict[str, Dict[str, Any]] = {}

    # -------------------------------------------------------------------------
    # Credential & Missing Keys Detection
    # -------------------------------------------------------------------------

    @property
    def default_discord_webhook_url(self) -> str:
        """Return configured or system default Discord webhook URL."""
        return (
            os.getenv("DEFAULT_DISCORD_WEBHOOK_URL", "").strip()
            or DEFAULT_DISCORD_WEBHOOK_URL
        )

    def get_discord_webhook_url(self, explicit_url: Optional[str] = None) -> str:
        """Return active Discord webhook URL with priority:
        1. Explicit URL parameter (e.g. from input form or live test).
        2. Custom DISCORD_WEBHOOK_URL from environment (if set by user).
        3. DEFAULT_DISCORD_WEBHOOK_URL (system default).
        """
        if explicit_url and explicit_url.strip():
            return explicit_url.strip()
        custom = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
        if custom:
            return custom
        return self.default_discord_webhook_url

    def is_default_discord_webhook(self, url: Optional[str] = None) -> bool:
        """Check whether the active or given URL is the system default Discord webhook."""
        active = (url or self.get_discord_webhook_url()).strip()
        return bool(active and active == self.default_discord_webhook_url.strip())

    @property
    def default_telegram_bot_token(self) -> str:
        """Return configured or system default Telegram bot token."""
        return (
            os.getenv("DEFAULT_TELEGRAM_BOT_TOKEN", "").strip()
            or DEFAULT_TELEGRAM_BOT_TOKEN
        )

    @property
    def default_telegram_chat_id(self) -> str:
        """Return configured or system default Telegram chat ID / handle."""
        return (
            os.getenv("DEFAULT_TELEGRAM_CHAT_ID", "").strip()
            or DEFAULT_TELEGRAM_CHAT_ID
        )

    def get_telegram_bot_token(self, explicit_token: Optional[str] = None) -> str:
        """Return active Telegram bot token with priority:
        1. Explicit parameter (if non-empty)
        2. Custom TELEGRAM_BOT_TOKEN from environment
        3. DEFAULT_TELEGRAM_BOT_TOKEN
        """
        if explicit_token and explicit_token.strip():
            return explicit_token.strip()
        custom = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        if custom:
            return custom
        return self.default_telegram_bot_token

    def get_telegram_chat_id(self, explicit_chat_id: Optional[str] = None) -> str:
        """Return active Telegram chat ID with priority:
        1. Explicit parameter (if non-empty)
        2. Custom TELEGRAM_CHAT_ID from environment
        3. DEFAULT_TELEGRAM_CHAT_ID
        """
        if explicit_chat_id and explicit_chat_id.strip():
            return explicit_chat_id.strip()
        custom = os.getenv("TELEGRAM_CHAT_ID", "").strip()
        if custom:
            return custom
        return self.default_telegram_chat_id

    def is_default_telegram(
        self,
        bot_token: Optional[str] = None,
        chat_id: Optional[str] = None,
    ) -> bool:
        """Check whether active or given Telegram credentials match the system defaults."""
        tok = (bot_token or self.get_telegram_bot_token()).strip()
        chat = (chat_id or self.get_telegram_chat_id()).strip()
        return bool(
            tok == self.default_telegram_bot_token.strip()
            and chat == self.default_telegram_chat_id.strip()
        )

    def get_missing_keys(self, platform: str) -> List[str]:
        """Detect which environment variables are missing or empty for a platform."""
        if platform == "discord":
            # Discord has a system default webhook. It is only considered missing if
            # no webhook (custom or default) and no bot credentials exist.
            url = self.get_discord_webhook_url()
            bot_token = os.getenv("DISCORD_BOT_TOKEN", "").strip()
            channel_id = os.getenv("DISCORD_CHANNEL_ID", "").strip()
            if url or (bot_token and channel_id):
                return []
            return ["DISCORD_WEBHOOK_URL"]

        if platform == "telegram":
            # Telegram has system default bot credentials. Only missing if both
            # custom and default token/chat ID are missing.
            tok = self.get_telegram_bot_token()
            chat = self.get_telegram_chat_id()
            missing = []
            if not tok:
                missing.append("TELEGRAM_BOT_TOKEN")
            if not chat:
                missing.append("TELEGRAM_CHAT_ID")
            return missing

        required = PLATFORM_REQUIRED_KEYS.get(platform, [])
        missing = []
        for key in required:
            val = os.getenv(key, "").strip()
            if not val:
                missing.append(key)
        return missing

    def get_youtube_config(self) -> Dict[str, Any]:
        client_id = os.getenv("YOUTUBE_CLIENT_ID", "").strip()
        client_secret = os.getenv("YOUTUBE_CLIENT_SECRET", "").strip()
        refresh_token = os.getenv("YOUTUBE_REFRESH_TOKEN", "").strip()
        access_token = os.getenv("YOUTUBE_ACCESS_TOKEN", "").strip()
        default_privacy = os.getenv("YOUTUBE_DEFAULT_PRIVACY", "private").strip().lower()
        if default_privacy not in ("private", "public", "unlisted"):
            default_privacy = "private"

        missing = self.get_missing_keys("youtube")
        configured = len(missing) == 0 or bool(access_token)
        return {
            "configured": configured,
            "missingKeys": missing,
            "privacy": default_privacy,
            "hasOAuth": bool(client_id and refresh_token),
        }

    def get_discord_config(self) -> Dict[str, Any]:
        webhook_url = self.get_discord_webhook_url()
        custom_webhook = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
        bot_token = os.getenv("DISCORD_BOT_TOKEN", "").strip()
        channel_id = os.getenv("DISCORD_CHANNEL_ID", "").strip()

        missing = self.get_missing_keys("discord")
        configured = len(missing) == 0 or bool(bot_token and channel_id)
        target_mode = "webhook" if webhook_url else ("bot_channel" if (bot_token and channel_id) else "unconfigured")
        is_default = self.is_default_discord_webhook(webhook_url)

        return {
            "configured": configured,
            "missingKeys": [] if configured else missing,
            "mode": target_mode,
            "isDefault": is_default,
            "hasCustomOverride": bool(custom_webhook and custom_webhook != self.default_discord_webhook_url),
            "maskedWebhook": (webhook_url[:32] + "...") if webhook_url else None,
            "channelId": channel_id if channel_id else None,
        }

    def get_telegram_config(self) -> Dict[str, Any]:
        bot_token = self.get_telegram_bot_token()
        chat_id = self.get_telegram_chat_id()
        custom_tok = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        custom_chat = os.getenv("TELEGRAM_CHAT_ID", "").strip()

        missing = self.get_missing_keys("telegram")
        configured = len(missing) == 0
        is_default = self.is_default_telegram(bot_token, chat_id)
        has_custom = bool(
            (custom_tok and custom_tok != self.default_telegram_bot_token)
            or (custom_chat and custom_chat != self.default_telegram_chat_id)
        )

        return {
            "configured": configured,
            "missingKeys": missing,
            "chatId": chat_id if chat_id else None,
            "hasBotToken": bool(bot_token),
            "isDefault": is_default,
            "hasCustomOverride": has_custom,
            "defaultChatId": self.default_telegram_chat_id,
        }

    def get_instagram_config(self) -> Dict[str, Any]:
        account_id = os.getenv("INSTAGRAM_ACCOUNT_ID", "").strip()
        access_token = os.getenv("META_ACCESS_TOKEN", "").strip()
        api_version = os.getenv("META_API_VERSION", "v19.0").strip()

        missing = self.get_missing_keys("instagram")
        configured = len(missing) == 0
        return {
            "configured": configured,
            "missingKeys": missing,
            "accountId": account_id if account_id else None,
            "hasAccessToken": bool(access_token),
            "apiVersion": api_version,
        }

    # -------------------------------------------------------------------------
    # Live Connection Tests (Real Authentication & API Reachability)
    # -------------------------------------------------------------------------

    async def test_youtube_connection(
        self,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        refresh_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Test YouTube Data API v3 authentication by refreshing token and fetching channel info."""
        cid = client_id or os.getenv("YOUTUBE_CLIENT_ID", "").strip()
        csec = client_secret or os.getenv("YOUTUBE_CLIENT_SECRET", "").strip()
        rtok = refresh_token or os.getenv("YOUTUBE_REFRESH_TOKEN", "").strip()
        atok = os.getenv("YOUTUBE_ACCESS_TOKEN", "").strip()

        missing = []
        if not cid: missing.append("YOUTUBE_CLIENT_ID")
        if not csec: missing.append("YOUTUBE_CLIENT_SECRET")
        if not rtok: missing.append("YOUTUBE_REFRESH_TOKEN")

        if missing and not atok:
            return {
                "platform": "youtube",
                "connected": False,
                "status": "Not Connected",
                "missingKeys": missing,
                "error": f"Missing required credentials: {', '.join(missing)}.",
                "accountName": None,
            }

        # Attempt OAuth token refresh
        test_access_token = atok
        if rtok and cid and csec:
            try:
                timeout = httpx.Timeout(15.0)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    token_resp = await client.post(
                        "https://oauth2.googleapis.com/token",
                        data={
                            "client_id": cid,
                            "client_secret": csec,
                            "refresh_token": rtok,
                            "grant_type": "refresh_token",
                        },
                    )
                    if token_resp.status_code == 200:
                        test_access_token = token_resp.json().get("access_token", "")
                    else:
                        err_text = token_resp.json().get("error_description") or token_resp.text
                        return {
                            "platform": "youtube",
                            "connected": False,
                            "status": "Error",
                            "missingKeys": [],
                            "error": f"OAuth token refresh failed (HTTP {token_resp.status_code}): {err_text}",
                            "accountName": None,
                        }
            except Exception as e:
                return {
                    "platform": "youtube",
                    "connected": False,
                    "status": "Error",
                    "missingKeys": [],
                    "error": f"Google OAuth reachability error: {str(e)}",
                    "accountName": None,
                }

        if not test_access_token:
            return {
                "platform": "youtube",
                "connected": False,
                "status": "Error",
                "missingKeys": [],
                "error": "Could not obtain a valid access token from refresh token.",
                "accountName": None,
            }

        # Verify access token against YouTube Data API
        try:
            timeout = httpx.Timeout(15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                yt_resp = await client.get(
                    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
                    headers={"Authorization": f"Bearer {test_access_token}"},
                )

            if yt_resp.status_code == 200:
                yt_data = yt_resp.json()
                items = yt_data.get("items", [])
                channel_name = items[0]["snippet"]["title"] if items else "Authenticated YouTube Channel"
                return {
                    "platform": "youtube",
                    "connected": True,
                    "status": "Connected",
                    "missingKeys": [],
                    "accountName": channel_name,
                    "error": None,
                }
            else:
                err_text = yt_resp.json().get("error", {}).get("message") or yt_resp.text
                return {
                    "platform": "youtube",
                    "connected": False,
                    "status": "Error",
                    "missingKeys": [],
                    "error": f"YouTube API authorization check failed (HTTP {yt_resp.status_code}): {err_text}",
                    "accountName": None,
                }
        except Exception as e:
            return {
                "platform": "youtube",
                "connected": False,
                "status": "Error",
                "missingKeys": [],
                "error": f"YouTube API reachability error: {str(e)}",
                "accountName": None,
            }

    async def test_discord_connection(self, webhook_url: Optional[str] = None) -> Dict[str, Any]:
        """Test Discord webhook reachability and verify valid channel target."""
        url = self.get_discord_webhook_url(webhook_url)
        bot_tok = os.getenv("DISCORD_BOT_TOKEN", "").strip()
        chan_id = os.getenv("DISCORD_CHANNEL_ID", "").strip()

        if not url and not (bot_tok and chan_id):
            return {
                "platform": "discord",
                "connected": False,
                "status": "Not Connected",
                "missingKeys": ["DISCORD_WEBHOOK_URL"],
                "error": "Missing DISCORD_WEBHOOK_URL in backend/.env.",
                "accountName": None,
            }

        if url:
            parsed = urlparse(url)
            if not parsed.hostname or "discord.com" not in parsed.hostname.lower():
                return {
                    "platform": "discord",
                    "connected": False,
                    "status": "Error",
                    "missingKeys": [],
                    "error": "Invalid Discord Webhook URL. Must be in the format: https://discord.com/api/webhooks/...",
                    "accountName": None,
                }

            try:
                timeout = httpx.Timeout(10.0)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.get(url)

                if resp.status_code == 200:
                    data = resp.json()
                    name = data.get("name", "Discord Webhook")
                    guild = data.get("guild_id", "")
                    is_default = self.is_default_discord_webhook(url)
                    account_title = f"{name} (Server: {guild})" if guild else name
                    if is_default:
                        account_title += " [Default Channel]"
                    return {
                        "platform": "discord",
                        "connected": True,
                        "status": "Connected (Default)" if is_default else "Connected",
                        "isDefault": is_default,
                        "missingKeys": [],
                        "accountName": account_title,
                        "error": None,
                    }
                else:
                    return {
                        "platform": "discord",
                        "connected": False,
                        "status": "Error",
                        "missingKeys": [],
                        "error": f"Discord Webhook check returned HTTP {resp.status_code}: {resp.text}",
                        "accountName": None,
                    }
            except Exception as e:
                return {
                    "platform": "discord",
                    "connected": False,
                    "status": "Error",
                    "missingKeys": [],
                    "error": f"Failed to contact Discord webhook: {str(e)}",
                    "accountName": None,
                }

        # Bot channel mode
        return {
            "platform": "discord",
            "connected": True,
            "status": "Connected",
            "missingKeys": [],
            "accountName": f"Bot Channel: {chan_id}",
            "error": None,
        }

    async def test_telegram_connection(
        self,
        bot_token: Optional[str] = None,
        chat_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Test Telegram Bot API authentication and channel write access."""
        token = self.get_telegram_bot_token(bot_token)
        target_chat = self.get_telegram_chat_id(chat_id)

        missing = []
        if not token: missing.append("TELEGRAM_BOT_TOKEN")
        if not target_chat: missing.append("TELEGRAM_CHAT_ID")

        if missing:
            return {
                "platform": "telegram",
                "connected": False,
                "status": "Not Connected",
                "missingKeys": missing,
                "error": f"Missing required credentials: {', '.join(missing)}.",
                "accountName": None,
            }

        try:
            timeout = httpx.Timeout(12.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                # 1. Test Bot Token via getMe
                me_resp = await client.get(f"https://api.telegram.org/bot{token}/getMe")
                me_data = me_resp.json()
                if not me_data.get("ok"):
                    desc = me_data.get("description", "Invalid Bot Token")
                    return {
                        "platform": "telegram",
                        "connected": False,
                        "status": "Error",
                        "missingKeys": [],
                        "error": f"Telegram Bot Token verification failed: {desc}",
                        "accountName": None,
                    }

                bot_username = me_data.get("result", {}).get("username", "bot")

                # 2. Test Channel Access via getChat
                chat_resp = await client.get(
                    f"https://api.telegram.org/bot{token}/getChat",
                    params={"chat_id": target_chat},
                )
                chat_data = chat_resp.json()
                if not chat_data.get("ok"):
                    desc = chat_data.get("description", "Channel not found or bot lacks admin permissions")
                    return {
                        "platform": "telegram",
                        "connected": False,
                        "status": "Error",
                        "missingKeys": [],
                        "error": (
                            f"Telegram channel check failed for '{target_chat}': {desc}. "
                            "Ensure the bot is added as an Administrator to the channel."
                        ),
                        "accountName": f"Bot: @{bot_username}",
                    }

                chat_title = chat_data.get("result", {}).get("title") or target_chat
                is_default = self.is_default_telegram(token, target_chat)
                account_name = f"@{bot_username} → {chat_title}"
                if is_default:
                    account_name += " [Default Channel]"

                return {
                    "platform": "telegram",
                    "connected": True,
                    "status": "Connected (Default)" if is_default else "Connected",
                    "isDefault": is_default,
                    "missingKeys": [],
                    "accountName": account_name,
                    "error": None,
                }
        except Exception as e:
            return {
                "platform": "telegram",
                "connected": False,
                "status": "Error",
                "missingKeys": [],
                "error": f"Telegram API connection failed: {str(e)}",
                "accountName": None,
            }

    async def test_instagram_connection(
        self,
        account_id: Optional[str] = None,
        access_token: Optional[str] = None,
        api_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Test Meta Instagram Graph API token validity and professional account status."""
        acc_id = (account_id or os.getenv("INSTAGRAM_ACCOUNT_ID", "")).strip()
        token = (access_token or os.getenv("META_ACCESS_TOKEN", "")).strip()
        api_ver = (api_version or os.getenv("META_API_VERSION", "v19.0")).strip()

        missing = []
        if not acc_id: missing.append("INSTAGRAM_ACCOUNT_ID")
        if not token: missing.append("META_ACCESS_TOKEN")

        if missing:
            return {
                "platform": "instagram",
                "connected": False,
                "status": "Not Connected",
                "missingKeys": missing,
                "error": f"Missing required credentials: {', '.join(missing)}.",
                "accountName": None,
            }

        try:
            timeout = httpx.Timeout(15.0)
            url = f"https://graph.facebook.com/{api_ver}/{acc_id}"
            params = {
                "fields": "id,username,name",
                "access_token": token,
            }
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, params=params)

            if resp.status_code == 200:
                data = resp.json()
                username = data.get("username") or data.get("name") or acc_id
                return {
                    "platform": "instagram",
                    "connected": True,
                    "status": "Connected",
                    "missingKeys": [],
                    "accountName": f"@{username}",
                    "error": None,
                }
            else:
                err_data = resp.json() if "application/json" in resp.headers.get("content-type", "") else {}
                err_msg = err_data.get("error", {}).get("message") or resp.text
                return {
                    "platform": "instagram",
                    "connected": False,
                    "status": "Error",
                    "missingKeys": [],
                    "error": f"Meta Graph API error (HTTP {resp.status_code}): {err_msg}",
                    "accountName": None,
                }
        except Exception as e:
            return {
                "platform": "instagram",
                "connected": False,
                "status": "Error",
                "missingKeys": [],
                "error": f"Meta Graph API reachability failed: {str(e)}",
                "accountName": None,
            }

    async def test_connection(
        self,
        platform: str,
        credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Dispatch live connection test for a specific platform."""
        p = platform.lower().strip()
        creds = credentials or {}

        if p == "youtube":
            res = await self.test_youtube_connection(
                client_id=creds.get("YOUTUBE_CLIENT_ID"),
                client_secret=creds.get("YOUTUBE_CLIENT_SECRET"),
                refresh_token=creds.get("YOUTUBE_REFRESH_TOKEN"),
            )
        elif p == "discord":
            res = await self.test_discord_connection(
                webhook_url=creds.get("DISCORD_WEBHOOK_URL"),
            )
        elif p == "telegram":
            res = await self.test_telegram_connection(
                bot_token=creds.get("TELEGRAM_BOT_TOKEN"),
                chat_id=creds.get("TELEGRAM_CHAT_ID"),
            )
        elif p == "instagram":
            res = await self.test_instagram_connection(
                account_id=creds.get("INSTAGRAM_ACCOUNT_ID"),
                access_token=creds.get("META_ACCESS_TOKEN"),
                api_version=creds.get("META_API_VERSION"),
            )
        else:
            raise ValueError(f"Unknown platform: '{platform}'. Choose from youtube, discord, telegram, instagram.")

        res["testedAt"] = datetime.now(timezone.utc).isoformat()
        self._test_cache[p] = res
        return res

    # -------------------------------------------------------------------------
    # Credential Persistence (.env Safe Updater)
    # -------------------------------------------------------------------------

    async def save_credentials(
        self,
        platform: str,
        credentials: Dict[str, str],
    ) -> Dict[str, Any]:
        """Safely write new credentials into backend/.env and update os.environ immediately."""
        env_file = self.backend_dir / ".env"
        existing_lines = []
        if env_file.is_file():
            existing_lines = env_file.read_text(encoding="utf-8").splitlines()

        # Update in-memory os.environ
        for key, val in credentials.items():
            clean_val = str(val).strip()
            if clean_val:
                os.environ[key] = clean_val
            elif key in ("DISCORD_WEBHOOK_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
                # Clear custom override so it falls back to system defaults
                os.environ[key] = ""

        # Update .env file contents line by line
        updated_keys = set()
        new_lines = []
        for line in existing_lines:
            stripped = line.strip()
            if stripped.startswith("#") or not stripped or "=" not in stripped:
                new_lines.append(line)
                continue

            k = stripped.split("=", 1)[0].strip()
            if k in credentials:
                clean_v = credentials[k].strip()
                new_lines.append(f"{k}={clean_v}")
                updated_keys.add(k)
            else:
                new_lines.append(line)

        # Append any new keys that were not already in the file
        for k, v in credentials.items():
            clean_v = str(v).strip()
            if k not in updated_keys:
                new_lines.append(f"{k}={clean_v}")

        # Ensure system default environment variables are retained in .env
        if not any(l.strip().startswith("DEFAULT_DISCORD_WEBHOOK_URL=") for l in new_lines):
            new_lines.append(f"DEFAULT_DISCORD_WEBHOOK_URL={self.default_discord_webhook_url}")
        if not any(l.strip().startswith("DEFAULT_TELEGRAM_BOT_TOKEN=") for l in new_lines):
            new_lines.append(f"DEFAULT_TELEGRAM_BOT_TOKEN={self.default_telegram_bot_token}")
        if not any(l.strip().startswith("DEFAULT_TELEGRAM_CHAT_ID=") for l in new_lines):
            new_lines.append(f"DEFAULT_TELEGRAM_CHAT_ID={self.default_telegram_chat_id}")

        env_file.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        logger.info(f"Updated credentials for {platform} in {env_file.name}: {list(credentials.keys())}")

        # Immediately execute connection test
        test_result = await self.test_connection(platform)
        return {
            "saved": True,
            "platform": platform,
            "testResult": test_result,
        }

    # -------------------------------------------------------------------------
    # Comprehensive Status Aggregator
    # -------------------------------------------------------------------------

    async def get_all_connection_statuses(self, force_test: bool = False) -> Dict[str, Any]:
        """Return rich connection statuses for all platforms without leaking secrets."""
        results = {}
        for p in ["youtube", "discord", "telegram", "instagram"]:
            missing = self.get_missing_keys(p)
            req_keys = PLATFORM_REQUIRED_KEYS.get(p, [])

            if missing:
                results[p] = {
                    "platform": p,
                    "connected": False,
                    "status": "Not Connected",
                    "missingKeys": missing,
                    "requiredKeys": req_keys,
                    "accountName": None,
                    "error": f"Missing environment variables: {', '.join(missing)}.",
                    "testedAt": None,
                }
            else:
                if force_test or p not in self._test_cache:
                    try:
                        results[p] = await self.test_connection(p)
                    except Exception as e:
                        results[p] = {
                            "platform": p,
                            "connected": False,
                            "status": "Error",
                            "missingKeys": [],
                            "requiredKeys": req_keys,
                            "accountName": None,
                            "error": str(e),
                            "testedAt": datetime.now(timezone.utc).isoformat(),
                        }
                else:
                    results[p] = self._test_cache[p]

                results[p]["requiredKeys"] = req_keys
                results[p]["missingKeys"] = missing

        return results

    # -------------------------------------------------------------------------
    # Video Accessibility Verification
    # -------------------------------------------------------------------------

    async def validate_video_file(self, video_path_or_url: str) -> Tuple[bool, Optional[str]]:
        """Verify that the video file exists and is accessible before publishing."""
        clean = (video_path_or_url or "").strip()
        if not clean:
            return False, "No video URL or file path specified."

        # Check local file
        p = Path(clean)
        if not p.is_file():
            cand = self.backend_dir / "media" / clean
            if cand.is_file():
                p = cand

        if p.is_file():
            size = p.stat().st_size
            if size == 0:
                return False, f"Video file '{p.name}' is empty (0 bytes)."
            return True, None

        # Check HTTP URL
        if clean.startswith("http://") or clean.startswith("https://"):
            try:
                timeout = httpx.Timeout(10.0)
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                    resp = await client.head(clean)
                    if resp.status_code == 200:
                        return True, None
                    # Fallback GET with stream
                    get_resp = await client.get(clean, headers={"Range": "bytes=0-1024"})
                    if get_resp.status_code in (200, 206):
                        return True, None
                    return False, f"Video URL returned HTTP status {resp.status_code}. Ensure the file exists."
            except Exception as e:
                return False, f"Could not reach video URL: {str(e)}"

        return False, f"Video file '{clean}' was not found in backend/media or as a reachable URL."

    # -------------------------------------------------------------------------
    # Caption Formatting (Consistent Motivational Quote)
    # -------------------------------------------------------------------------

    def format_captions(self, title: str, quote: str) -> Dict[str, Any]:
        """Generate platform-tailored captions while keeping the quote consistent."""
        clean_title = (title or "Motivational Short").strip()
        clean_quote = (quote or "Keep pushing forward.").strip()

        yt_title = f"{clean_title} #Shorts"
        if len(yt_title) > 95:
            yt_title = yt_title[:92] + "..."

        yt_desc = (
            f"\"{clean_quote}\"\n\n"
            f"Daily motivational reminder. Transform your mindset, stay disciplined, and rise above limits.\n\n"
            f"#Shorts #Motivation #Success #Inspiration #Mindset"
        )

        discord_content = (
            f"**{clean_title}**\n\n"
            f"> \"{clean_quote}\"\n\n"
            f"#Shorts #Motivation #Success"
        )

        tg_caption = (
            f"🎬 **{clean_title}**\n\n"
            f"❝ {clean_quote} ❞\n\n"
            f"#Shorts #Motivation #Success #Discipline"
        )

        ig_caption = (
            f"{clean_title}\n\n"
            f"❝ {clean_quote} ❞\n\n"
            f".\n"
            f".\n"
            f"#shorts #motivation #success #mindset #reels #growth #discipline #inspiration"
        )

        return {
            "title": clean_title,
            "quote": clean_quote,
            "youtube": {
                "title": yt_title,
                "description": yt_desc,
                "tags": ["Shorts", "Motivation", "Success", "Inspiration", "Mindset"],
            },
            "discord": {
                "content": discord_content,
            },
            "telegram": {
                "caption": tg_caption,
            },
            "instagram": {
                "caption": ig_caption,
            },
        }

    # -------------------------------------------------------------------------
    # Media File Resolution Helper
    # -------------------------------------------------------------------------

    async def resolve_video_bytes_and_url(
        self,
        video_path_or_url: str,
        public_base_url: Optional[str] = None,
    ) -> Tuple[bytes, str, int]:
        """Return (video_bytes, public_https_url, file_size)."""
        clean = video_path_or_url.strip()

        # Check if local file path
        p = Path(clean)
        if not p.is_file():
            cand = self.backend_dir / "media" / clean
            if cand.is_file():
                p = cand

        if p.is_file():
            data = p.read_bytes()
            size = len(data)
            if public_base_url:
                public_url = f"{public_base_url.rstrip('/')}/media/{p.name}"
            else:
                public_url = f"http://localhost:8000/media/{p.name}"
            return data, public_url, size

        # It's an HTTP URL
        if clean.startswith("http://") or clean.startswith("https://"):
            timeout = httpx.Timeout(connect=20.0, read=180.0, write=20.0, pool=10.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                resp = await client.get(clean)
                if resp.status_code != 200:
                    raise ValueError(f"Failed to fetch video file from {clean} (HTTP {resp.status_code})")
                data = resp.content
                return data, clean, len(data)

        raise FileNotFoundError(f"Video file or URL not accessible: {video_path_or_url}")

    # -------------------------------------------------------------------------
    # Platform 1: YouTube Shorts Publisher
    # -------------------------------------------------------------------------

    async def publish_to_youtube(
        self,
        video_bytes: bytes,
        title: str,
        quote: str,
        privacy: str = "private",
        video_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Upload video to YouTube Shorts using YouTube Data API v3."""
        missing = self.get_missing_keys("youtube")
        access_token = os.getenv("YOUTUBE_ACCESS_TOKEN", "").strip()

        if missing and not access_token:
            return {
                "platform": "youtube",
                "status": "Failed",
                "videoId": None,
                "url": None,
                "error": f"YouTube credentials not configured. Missing in backend/.env: {', '.join(missing)}.",
            }

        client_id = os.getenv("YOUTUBE_CLIENT_ID", "").strip()
        client_secret = os.getenv("YOUTUBE_CLIENT_SECRET", "").strip()
        refresh_token = os.getenv("YOUTUBE_REFRESH_TOKEN", "").strip()

        if refresh_token and client_id and client_secret:
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    token_resp = await client.post(
                        "https://oauth2.googleapis.com/token",
                        data={
                            "client_id": client_id,
                            "client_secret": client_secret,
                            "refresh_token": refresh_token,
                            "grant_type": "refresh_token",
                        },
                    )
                    if token_resp.status_code == 200:
                        token_data = token_resp.json()
                        access_token = token_data.get("access_token", access_token)
            except Exception as e:
                logger.warning(f"Could not refresh YouTube access token: {e}")

        if not access_token:
            return {
                "platform": "youtube",
                "status": "Failed",
                "videoId": None,
                "url": None,
                "error": "Could not obtain valid YouTube OAuth access token.",
            }

        captions = self.format_captions(title, quote)
        yt_title = captions["youtube"]["title"]
        yt_desc = captions["youtube"]["description"]
        yt_tags = captions["youtube"]["tags"]

        try:
            upload_url = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": "video/mp4",
                "X-Upload-Content-Length": str(len(video_bytes)),
            }
            body = {
                "snippet": {
                    "title": yt_title,
                    "description": yt_desc,
                    "tags": yt_tags,
                    "categoryId": "22",
                },
                "status": {
                    "privacyStatus": privacy or "private",
                    "selfDeclaredMadeForKids": False,
                },
            }

            async with httpx.AsyncClient(timeout=300.0) as client:
                init_resp = await client.post(upload_url, headers=headers, json=body)
                if init_resp.status_code not in (200, 201):
                    err_text = init_resp.text
                    return {
                        "platform": "youtube",
                        "status": "Failed",
                        "videoId": None,
                        "url": None,
                        "error": f"YouTube upload init failed (HTTP {init_resp.status_code}): {err_text}",
                    }

                upload_session_url = init_resp.headers.get("Location")
                if not upload_session_url:
                    return {
                        "platform": "youtube",
                        "status": "Failed",
                        "videoId": None,
                        "url": None,
                        "error": "YouTube upload session URL was missing in response headers.",
                    }

                upload_resp = await client.put(
                    upload_session_url,
                    headers={"Content-Type": "video/mp4"},
                    content=video_bytes,
                )

                if upload_resp.status_code in (200, 201):
                    yt_data = upload_resp.json()
                    video_id = yt_data.get("id")
                    watch_url = f"https://youtube.com/shorts/{video_id}"
                    logger.info(f"YouTube upload succeeded! Video ID: {video_id}, URL: {watch_url}")
                    return {
                        "platform": "youtube",
                        "status": "Published",
                        "videoId": video_id,
                        "url": watch_url,
                        "privacy": privacy,
                        "error": None,
                    }
                else:
                    return {
                        "platform": "youtube",
                        "status": "Failed",
                        "videoId": None,
                        "url": None,
                        "error": f"YouTube video upload failed (HTTP {upload_resp.status_code}): {upload_resp.text}",
                    }
        except Exception as e:
            logger.error(f"YouTube publishing exception: {e}", exc_info=True)
            return {
                "platform": "youtube",
                "status": "Failed",
                "videoId": None,
                "url": None,
                "error": str(e),
            }

    # -------------------------------------------------------------------------
    # Platform 2: Discord Publisher (Attachment Upload + Size Limit Checks)
    # -------------------------------------------------------------------------

    async def publish_to_discord(
        self,
        video_bytes: bytes,
        title: str,
        quote: str,
        filename: str = "motivational_short.mp4",
    ) -> Dict[str, Any]:
        """Upload actual MP4 video file to Discord webhook or channel with size validation."""
        webhook_url = self.get_discord_webhook_url()
        bot_token = os.getenv("DISCORD_BOT_TOKEN", "").strip()
        channel_id = os.getenv("DISCORD_CHANNEL_ID", "").strip()

        if not webhook_url and not (bot_token and channel_id):
            return {
                "platform": "discord",
                "status": "Failed",
                "messageId": None,
                "url": None,
                "error": "Missing DISCORD_WEBHOOK_URL in backend/.env. Connect Discord first.",
            }

        # Size check
        file_size = len(video_bytes)
        if file_size > DISCORD_MAX_BYTES:
            size_mb = file_size / (1024 * 1024)
            limit_mb = DISCORD_MAX_BYTES / (1024 * 1024)
            return {
                "platform": "discord",
                "status": "Failed",
                "messageId": None,
                "url": None,
                "error": (
                    f"Video file size ({size_mb:.2f} MB) exceeds Discord standard upload limit of {limit_mb:.0f} MB. "
                    "Compress the video or reduce duration to publish to Discord."
                ),
            }

        captions = self.format_captions(title, quote)
        content_text = captions["discord"]["content"]

        try:
            target_url = webhook_url
            headers = {}
            if not target_url and bot_token and channel_id:
                target_url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
                headers["Authorization"] = f"Bot {bot_token}"

            if "webhooks" in target_url and "?" not in target_url:
                target_url += "?wait=true"

            files = {
                "file": (filename, video_bytes, "video/mp4"),
            }
            data = {
                "content": content_text,
            }

            timeout = httpx.Timeout(connect=20.0, read=120.0, write=60.0, pool=5.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(target_url, headers=headers, data=data, files=files)

            if resp.status_code in (200, 204):
                try:
                    res_data = resp.json()
                    msg_id = str(res_data.get("id", ""))
                    msg_channel = str(res_data.get("channel_id", channel_id or ""))
                    msg_url = f"https://discord.com/channels/@me/{msg_channel}/{msg_id}" if (msg_id and msg_channel) else None
                except Exception:
                    msg_id = f"msg_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
                    msg_url = None

                logger.info(f"Discord video upload succeeded! Message ID: {msg_id}")
                return {
                    "platform": "discord",
                    "status": "Published",
                    "messageId": msg_id,
                    "url": msg_url,
                    "error": None,
                }
            else:
                return {
                    "platform": "discord",
                    "status": "Failed",
                    "messageId": None,
                    "url": None,
                    "error": f"Discord upload failed (HTTP {resp.status_code}): {resp.text}",
                }
        except Exception as e:
            logger.error(f"Discord publishing exception: {e}", exc_info=True)
            return {
                "platform": "discord",
                "status": "Failed",
                "messageId": None,
                "url": None,
                "error": str(e),
            }

    # -------------------------------------------------------------------------
    # Platform 3: Telegram Publisher (sendVideo + Size Limit Checks)
    # -------------------------------------------------------------------------

    async def publish_to_telegram(
        self,
        video_bytes: bytes,
        title: str,
        quote: str,
        filename: str = "motivational_short.mp4",
    ) -> Dict[str, Any]:
        """Send video to Telegram channel via Telegram Bot API sendVideo."""
        missing = self.get_missing_keys("telegram")
        if missing:
            return {
                "platform": "telegram",
                "status": "Failed",
                "messageId": None,
                "url": None,
                "error": f"Missing Telegram credentials in backend/.env: {', '.join(missing)}. Connect Telegram first.",
            }

        file_size = len(video_bytes)
        if file_size > TELEGRAM_MAX_BYTES:
            size_mb = file_size / (1024 * 1024)
            limit_mb = TELEGRAM_MAX_BYTES / (1024 * 1024)
            return {
                "platform": "telegram",
                "status": "Failed",
                "messageId": None,
                "url": None,
                "error": f"Video size ({size_mb:.2f} MB) exceeds Telegram Bot API limit of {limit_mb:.0f} MB.",
            }

        captions = self.format_captions(title, quote)
        caption_text = captions["telegram"]["caption"]

        bot_token = self.get_telegram_bot_token()
        chat_id = self.get_telegram_chat_id()

        api_url = f"https://api.telegram.org/bot{bot_token}/sendVideo"

        try:
            files = {
                "video": (filename, video_bytes, "video/mp4"),
            }
            data = {
                "chat_id": chat_id,
                "caption": caption_text,
                "parse_mode": "Markdown",
                "supports_streaming": "true",
            }

            timeout = httpx.Timeout(connect=25.0, read=180.0, write=90.0, pool=5.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(api_url, data=data, files=files)

            if resp.status_code == 200:
                res_data = resp.json()
                if res_data.get("ok"):
                    result_obj = res_data.get("result", {})
                    msg_id = str(result_obj.get("message_id", ""))
                    chat_obj = result_obj.get("chat", {})
                    chat_username = chat_obj.get("username")
                    msg_url = f"https://t.me/{chat_username}/{msg_id}" if (chat_username and msg_id) else None
                    logger.info(f"Telegram sendVideo succeeded! Message ID: {msg_id}")
                    return {
                        "platform": "telegram",
                        "status": "Published",
                        "messageId": msg_id,
                        "url": msg_url,
                        "error": None,
                    }
                else:
                    return {
                        "platform": "telegram",
                        "status": "Failed",
                        "messageId": None,
                        "url": None,
                        "error": f"Telegram API error: {res_data.get('description', 'Unknown error')}",
                    }
            else:
                return {
                    "platform": "telegram",
                    "status": "Failed",
                    "messageId": None,
                    "url": None,
                    "error": f"Telegram HTTP {resp.status_code}: {resp.text}",
                }
        except Exception as e:
            logger.error(f"Telegram publishing exception: {e}", exc_info=True)
            return {
                "platform": "telegram",
                "status": "Failed",
                "messageId": None,
                "url": None,
                "error": str(e),
            }

    # -------------------------------------------------------------------------
    # Platform 4: Instagram Reels Publisher (Official Meta Graph API)
    # -------------------------------------------------------------------------

    async def publish_to_instagram(
        self,
        video_public_url: str,
        title: str,
        quote: str,
    ) -> Dict[str, Any]:
        """Publish Reel using official Meta Instagram Graph API with polling and status verification."""
        missing = self.get_missing_keys("instagram")
        if missing:
            return {
                "platform": "instagram",
                "status": "Failed",
                "mediaId": None,
                "url": None,
                "error": f"Missing Instagram credentials in backend/.env: {', '.join(missing)}. Connect Instagram first.",
            }

        parsed = urlparse(video_public_url)
        if parsed.scheme.lower() != "https" or "localhost" in (parsed.hostname or "") or "127.0.0.1" in (parsed.hostname or ""):
            return {
                "platform": "instagram",
                "status": "Failed",
                "mediaId": None,
                "url": None,
                "error": (
                    f"Instagram Reels requires a publicly accessible HTTPS video URL. Current URL: '{video_public_url}'. "
                    "Ensure your Cloudflare Tunnel is connected."
                ),
            }

        account_id = os.getenv("INSTAGRAM_ACCOUNT_ID", "").strip()
        access_token = os.getenv("META_ACCESS_TOKEN", "").strip()
        api_ver = os.getenv("META_API_VERSION", "v19.0").strip()

        captions = self.format_captions(title, quote)
        caption_text = captions["instagram"]["caption"]

        graph_base = f"https://graph.facebook.com/{api_ver}"

        try:
            # 1. Create Media Container
            container_endpoint = f"{graph_base}/{account_id}/media"
            create_payload = {
                "media_type": "REELS",
                "video_url": video_public_url,
                "caption": caption_text,
                "share_to_feed": "true",
                "access_token": access_token,
            }

            timeout = httpx.Timeout(connect=20.0, read=60.0, write=20.0, pool=5.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                create_resp = await client.post(container_endpoint, data=create_payload)

            if create_resp.status_code != 200:
                err_data = create_resp.json() if "application/json" in create_resp.headers.get("content-type", "") else {}
                err_msg = err_data.get("error", {}).get("message") or create_resp.text
                return {
                    "platform": "instagram",
                    "status": "Failed",
                    "mediaId": None,
                    "url": None,
                    "error": f"Failed to create Instagram Reel container: {err_msg}",
                }

            container_id = create_resp.json().get("id")
            if not container_id:
                return {
                    "platform": "instagram",
                    "status": "Failed",
                    "mediaId": None,
                    "url": None,
                    "error": "Instagram API did not return a container ID.",
                }

            logger.info(f"Instagram container created: {container_id}. Polling for completion...")

            # 2. Poll Container Status
            max_poll_attempts = 15
            poll_interval_seconds = 5
            container_ready = False

            for attempt in range(max_poll_attempts):
                await asyncio.sleep(poll_interval_seconds)
                status_url = f"{graph_base}/{container_id}"
                params = {
                    "fields": "status_code,status",
                    "access_token": access_token,
                }
                async with httpx.AsyncClient(timeout=timeout) as client:
                    status_resp = await client.get(status_url, params=params)

                if status_resp.status_code == 200:
                    status_data = status_resp.json()
                    status_code = status_data.get("status_code", "").upper()
                    logger.info(f"Instagram container {container_id} status (poll #{attempt+1}): {status_code}")

                    if status_code == "FINISHED":
                        container_ready = True
                        break
                    elif status_code == "ERROR":
                        err_desc = status_data.get("status", "Video processing failed on Instagram servers")
                        return {
                            "platform": "instagram",
                            "status": "Failed",
                            "mediaId": None,
                            "url": None,
                            "error": f"Instagram container processing error: {err_desc}",
                        }
                    elif status_code in ("IN_PROGRESS", "PUBLISHED"):
                        continue
                else:
                    logger.warning(f"Poll check #{attempt+1} failed with HTTP {status_resp.status_code}")

            if not container_ready:
                return {
                    "platform": "instagram",
                    "status": "Failed",
                    "mediaId": None,
                    "url": None,
                    "error": "Instagram Reel container processing timed out after 75 seconds. Try again.",
                }

            # 3. Publish Container
            publish_endpoint = f"{graph_base}/{account_id}/media_publish"
            publish_payload = {
                "creation_id": container_id,
                "access_token": access_token,
            }
            async with httpx.AsyncClient(timeout=timeout) as client:
                publish_resp = await client.post(publish_endpoint, data=publish_payload)

            if publish_resp.status_code != 200:
                err_data = publish_resp.json() if "application/json" in publish_resp.headers.get("content-type", "") else {}
                err_msg = err_data.get("error", {}).get("message") or publish_resp.text
                return {
                    "platform": "instagram",
                    "status": "Failed",
                    "mediaId": None,
                    "url": None,
                    "error": f"Failed to publish Instagram container: {err_msg}",
                }

            media_id = str(publish_resp.json().get("id", ""))

            # 4. Fetch Permalink
            permalink = None
            try:
                media_info_url = f"{graph_base}/{media_id}"
                async with httpx.AsyncClient(timeout=timeout) as client:
                    media_resp = await client.get(
                        media_info_url,
                        params={"fields": "permalink,shortcode", "access_token": access_token},
                    )
                if media_resp.status_code == 200:
                    permalink = media_resp.json().get("permalink")
            except Exception as e:
                logger.warning(f"Could not retrieve Instagram permalink: {e}")

            logger.info(f"Instagram Reel published! Media ID: {media_id}, Permalink: {permalink}")
            return {
                "platform": "instagram",
                "status": "Published",
                "mediaId": media_id,
                "url": permalink,
                "error": None,
            }

        except Exception as e:
            logger.error(f"Instagram publishing exception: {e}", exc_info=True)
            return {
                "platform": "instagram",
                "status": "Failed",
                "mediaId": None,
                "url": None,
                "error": str(e),
            }

    # -------------------------------------------------------------------------
    # Parallel Multi-Platform Dispatch
    # -------------------------------------------------------------------------

    async def publish_all(
        self,
        video_path_or_url: str,
        title: str,
        quote: str,
        platforms: Optional[Dict[str, bool]] = None,
        youtube_privacy: str = "private",
        public_base_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Publish video to all enabled platforms simultaneously in parallel.

        Independent execution: One platform failure NEVER blocks other platforms.
        Pre-checks credentials and video availability before attempting uploads.
        """
        # Step 1: Verify video file availability
        is_valid_video, video_err = await self.validate_video_file(video_path_or_url)
        if not is_valid_video:
            raise FileNotFoundError(video_err or f"Video '{video_path_or_url}' is not accessible.")

        active_platforms = platforms or {
            "youtube": True,
            "discord": True,
            "telegram": True,
            "instagram": True,
        }

        # Resolve media bytes and public URL
        video_bytes, public_url, file_size = await self.resolve_video_bytes_and_url(
            video_path_or_url, public_base_url
        )

        tasks = []
        platform_keys = []

        # 1. YouTube
        if active_platforms.get("youtube", False):
            tasks.append(
                self.publish_to_youtube(
                    video_bytes=video_bytes,
                    title=title,
                    quote=quote,
                    privacy=youtube_privacy,
                    video_url=public_url,
                )
            )
            platform_keys.append("youtube")

        # 2. Discord
        if active_platforms.get("discord", False):
            tasks.append(
                self.publish_to_discord(
                    video_bytes=video_bytes,
                    title=title,
                    quote=quote,
                )
            )
            platform_keys.append("discord")

        # 3. Telegram
        if active_platforms.get("telegram", False):
            tasks.append(
                self.publish_to_telegram(
                    video_bytes=video_bytes,
                    title=title,
                    quote=quote,
                )
            )
            platform_keys.append("telegram")

        # 4. Instagram
        if active_platforms.get("instagram", False):
            tasks.append(
                self.publish_to_instagram(
                    video_public_url=public_url,
                    title=title,
                    quote=quote,
                )
            )
            platform_keys.append("instagram")

        # Run all selected branches in parallel with return_exceptions=True
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        platform_results: Dict[str, Any] = {}
        for key, res in zip(platform_keys, raw_results):
            if isinstance(res, Exception):
                logger.error(f"Platform {key} raised an uncaught exception: {res}")
                platform_results[key] = {
                    "platform": key,
                    "status": "Failed",
                    "error": str(res),
                }
            else:
                platform_results[key] = res

        # Mark skipped platforms
        for p in ["youtube", "discord", "telegram", "instagram"]:
            if p not in platform_results:
                platform_results[p] = {
                    "platform": p,
                    "status": "Skipped",
                    "error": None,
                }

        # Determine overall_publish_status
        attempted = [platform_results[k] for k in platform_keys]
        if not attempted:
            overall_status = "Skipped"
        else:
            success_count = sum(1 for r in attempted if r.get("status") == "Published")
            fail_count = sum(1 for r in attempted if r.get("status") == "Failed")

            if success_count == len(attempted) and success_count > 0:
                overall_status = "Completed"
            elif success_count > 0:
                overall_status = "Partially Completed"
            else:
                overall_status = "Failed"

        attempt_time = datetime.now(timezone.utc).isoformat()

        sheet_publishing_data = {
            "youtube_status": platform_results["youtube"].get("status", "Skipped"),
            "youtube_video_id": platform_results["youtube"].get("videoId", "") or "",
            "youtube_url": platform_results["youtube"].get("url", "") or "",
            "discord_status": platform_results["discord"].get("status", "Skipped"),
            "discord_message_id": platform_results["discord"].get("messageId", "") or "",
            "telegram_status": platform_results["telegram"].get("status", "Skipped"),
            "telegram_message_id": platform_results["telegram"].get("messageId", "") or "",
            "instagram_status": platform_results["instagram"].get("status", "Skipped"),
            "instagram_media_id": platform_results["instagram"].get("mediaId", "") or "",
            "instagram_url": platform_results["instagram"].get("url", "") or "",
            "overall_publish_status": overall_status,
            "last_publish_attempt": attempt_time,
        }

        return {
            "overall_publish_status": overall_status,
            "last_publish_attempt": attempt_time,
            "platforms": platform_results,
            "sheetData": sheet_publishing_data,
        }


# Global singleton
publishing_service = PublishingService()
