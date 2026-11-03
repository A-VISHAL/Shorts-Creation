"""Unit tests for Multi-Platform Publishing Service and endpoints."""

import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app import app
from publishing_service import publishing_service, DISCORD_MAX_BYTES, TELEGRAM_MAX_BYTES
from sheets_service import PUBLISHING_COLUMNS


@pytest.fixture
def client():
    return TestClient(app)


def test_format_captions_consistent_quote():
    title = "Rise Above Limits"
    quote = "The secret of getting ahead is getting started."

    captions = publishing_service.format_captions(title, quote)
    assert captions["title"] == title
    assert captions["quote"] == quote

    # Check consistent quote across all platforms
    assert quote in captions["youtube"]["description"]
    assert quote in captions["discord"]["content"]
    assert quote in captions["telegram"]["caption"]
    assert quote in captions["instagram"]["caption"]

    # Check hashtags
    assert "#Shorts" in captions["youtube"]["title"]
    assert "#Shorts" in captions["discord"]["content"]
    assert "#Shorts" in captions["telegram"]["caption"]
    assert "#shorts" in captions["instagram"]["caption"]


@pytest.mark.asyncio
async def test_get_all_connection_statuses_no_secrets():
    statuses = await publishing_service.get_all_connection_statuses()
    assert "youtube" in statuses
    assert "discord" in statuses
    assert "telegram" in statuses
    assert "instagram" in statuses

    # Verify no secret tokens leaked in status payloads
    for key, info in statuses.items():
        assert "password" not in info
        assert "access_token" not in info
        assert "client_secret" not in info
        assert "webhook_url" not in info
        assert "token" not in info


@pytest.mark.asyncio
async def test_discord_size_limit_rejection():
    # Oversized payload (> 25 MB) with unparseable bytes fails compression and rejects
    oversized_bytes = b"0" * (DISCORD_MAX_BYTES + 1024)
    with patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/mock/test"}):
        result = await publishing_service.publish_to_discord(
            video_bytes=oversized_bytes,
            title="Too Big",
            quote="Oversized test quote",
        )
    assert result["status"] == "Failed"
    assert "exceeds Discord standard upload limit" in result["error"]


@pytest.mark.asyncio
async def test_discord_auto_compresses_oversized_video():
    # Oversized video that successfully auto-compresses under 25 MB
    oversized_bytes = b"0" * (DISCORD_MAX_BYTES + 5 * 1024 * 1024)  # 30 MB
    compressed_bytes = b"compressed_mp4_bytes_under_25mb"

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"id": "123456789", "channel_id": "987654321"}

    with patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/mock/test"}), \
         patch.object(publishing_service, "compress_video_to_limit", return_value=compressed_bytes) as mock_comp, \
         patch("httpx.AsyncClient.post", return_value=mock_resp) as mock_post:
        result = await publishing_service.publish_to_discord(
            video_bytes=oversized_bytes,
            title="Auto Compress Test",
            quote="Quote for auto compress",
        )

    assert mock_comp.called
    assert result["status"] == "Published"
    assert result["messageId"] == "123456789"
    # Ensure the uploaded file bytes were the compressed bytes
    _, kwargs = mock_post.call_args
    assert kwargs["files"]["file"][1] == compressed_bytes


@pytest.mark.asyncio
async def test_telegram_size_limit_rejection():
    # Oversized payload (> 50 MB)
    oversized_bytes = b"0" * (TELEGRAM_MAX_BYTES + 1024)
    with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "123:mock", "TELEGRAM_CHAT_ID": "@mock_chan"}):
        result = await publishing_service.publish_to_telegram(
            video_bytes=oversized_bytes,
            title="Too Big for TG",
            quote="Oversized TG quote",
        )
    assert result["status"] == "Failed"
    assert "exceeds Telegram Bot API limit" in result["error"]


@pytest.mark.asyncio
async def test_instagram_rejects_localhost_url():
    with patch.dict(os.environ, {"INSTAGRAM_ACCOUNT_ID": "12345", "META_ACCESS_TOKEN": "EAABmock"}):
        result = await publishing_service.publish_to_instagram(
            video_public_url="http://localhost:8000/media/sample.mp4",
            title="Local Video",
            quote="Cannot be fetched by Meta",
        )
    assert result["status"] == "Failed"
    assert "publicly accessible HTTPS" in result["error"]


@pytest.mark.asyncio
async def test_publish_all_parallel_independence():
    """Verify that failure on one platform does NOT stop other platforms."""
    mock_bytes = b"mock mp4 content"

    async def mock_resolve(*args, **kwargs):
        return mock_bytes, "https://public-tunnel.trycloudflare.com/media/sample.mp4", len(mock_bytes)

    async def mock_yt(*args, **kwargs):
        return {"platform": "youtube", "status": "Failed", "error": "Auth missing"}

    async def mock_dc(*args, **kwargs):
        return {"platform": "discord", "status": "Published", "messageId": "msg_123", "url": "https://discord.com/msg/123"}

    async def mock_tg(*args, **kwargs):
        return {"platform": "telegram", "status": "Published", "messageId": "tg_456"}

    async def mock_ig(*args, **kwargs):
        return {"platform": "instagram", "status": "Failed", "error": "Container timeout"}

    with patch.object(publishing_service, "validate_video_file", return_value=(True, None)), \
         patch.object(publishing_service, "resolve_video_bytes_and_url", side_effect=mock_resolve), \
         patch.object(publishing_service, "publish_to_youtube", side_effect=mock_yt), \
         patch.object(publishing_service, "publish_to_discord", side_effect=mock_dc), \
         patch.object(publishing_service, "publish_to_telegram", side_effect=mock_tg), \
         patch.object(publishing_service, "publish_to_instagram", side_effect=mock_ig):

        report = await publishing_service.publish_all(
            video_path_or_url="sample.mp4",
            title="Test Independence",
            quote="Never give up.",
        )

        assert report["overall_publish_status"] == "Partially Completed"
        assert report["platforms"]["youtube"]["status"] == "Failed"
        assert report["platforms"]["discord"]["status"] == "Published"
        assert report["platforms"]["telegram"]["status"] == "Published"
        assert report["platforms"]["instagram"]["status"] == "Failed"

        sheet_data = report["sheetData"]
        for col in PUBLISHING_COLUMNS:
            assert col in sheet_data



def test_api_publish_status_endpoint(client):
    resp = client.get("/api/publish/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "youtube" in data
    assert "discord" in data
    assert "telegram" in data
    assert "instagram" in data


def test_api_publish_dispatch_endpoint(client):
    mock_report = {
        "overall_publish_status": "Skipped",
        "last_publish_attempt": "2026-10-31T22:45:00Z",
        "platforms": {
            "youtube": {"platform": "youtube", "status": "Skipped"},
            "discord": {"platform": "discord", "status": "Skipped"},
            "telegram": {"platform": "telegram", "status": "Skipped"},
            "instagram": {"platform": "instagram", "status": "Skipped"},
        },
        "sheetData": {},
    }

    with patch.object(publishing_service, "publish_all", new_callable=AsyncMock) as mock_pub:
        mock_pub.return_value = mock_report
        payload = {
            "videoUrl": "test_sample.mp4",
            "title": "Dispatch Test",
            "quote": "Success comes to those who persevere.",
            "platforms": {"youtube": False, "discord": False, "telegram": False, "instagram": False},
        }
        resp = client.post("/api/publish/dispatch", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["overallStatus"] == "Skipped"


def test_discord_default_webhook_resolution():
    """Verify that custom webhook is only used if provided, otherwise default is used."""
    default_url = "https://discord.com/api/webhooks/123456789012345678/mockDefaultDiscordWebhookTokenAlphaNum"
    custom_url = "https://discord.com/api/webhooks/9999999999/customToken123"

    # Case 1: DISCORD_WEBHOOK_URL is empty -> falls back to default
    with patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": "", "DEFAULT_DISCORD_WEBHOOK_URL": default_url}):
        resolved = publishing_service.get_discord_webhook_url()
        assert resolved == default_url
        assert publishing_service.is_default_discord_webhook() is True

    # Case 2: User provides custom DISCORD_WEBHOOK_URL -> only custom is used
    with patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": custom_url, "DEFAULT_DISCORD_WEBHOOK_URL": default_url}):
        resolved = publishing_service.get_discord_webhook_url()
        assert resolved == custom_url
        assert publishing_service.is_default_discord_webhook() is False

    # Case 3: Explicit parameter passed -> takes priority over both
    explicit_url = "https://discord.com/api/webhooks/1111111111/explicitOverride"
    with patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": custom_url, "DEFAULT_DISCORD_WEBHOOK_URL": default_url}):
        resolved = publishing_service.get_discord_webhook_url(explicit_url)
        assert resolved == explicit_url


def test_youtube_default_credentials_resolution():
    """Verify YouTube uses default OAuth Client ID and Secret when custom values are empty."""
    default_cid = "mock-default-yt-client-id.apps.googleusercontent.com"
    default_csec = "mockDefaultSecret123"
    custom_cid = "999888777-custom.apps.googleusercontent.com"
    custom_csec = "mockCustomSecret456"

    # Case 1: Empty custom environment -> falls back to system defaults
    with patch.dict(os.environ, {
        "YOUTUBE_CLIENT_ID": "",
        "YOUTUBE_CLIENT_SECRET": "",
        "DEFAULT_YOUTUBE_CLIENT_ID": default_cid,
        "DEFAULT_YOUTUBE_CLIENT_SECRET": default_csec,
    }):
        assert publishing_service.get_youtube_client_id() == default_cid
        assert publishing_service.get_youtube_client_secret() == default_csec
        assert publishing_service.is_default_youtube() is True

    # Case 2: Custom credentials provided -> uses custom
    with patch.dict(os.environ, {
        "YOUTUBE_CLIENT_ID": custom_cid,
        "YOUTUBE_CLIENT_SECRET": custom_csec,
        "DEFAULT_YOUTUBE_CLIENT_ID": default_cid,
        "DEFAULT_YOUTUBE_CLIENT_SECRET": default_csec,
    }):
        assert publishing_service.get_youtube_client_id() == custom_cid
        assert publishing_service.get_youtube_client_secret() == custom_csec
        assert publishing_service.is_default_youtube() is False

    # Case 3: Explicit argument passed
    with patch.dict(os.environ, {
        "YOUTUBE_CLIENT_ID": custom_cid,
        "YOUTUBE_CLIENT_SECRET": custom_csec,
    }):
        assert publishing_service.get_youtube_client_id("explicit-cid") == "explicit-cid"
        assert publishing_service.get_youtube_client_secret("explicit-csec") == "explicit-csec"


def test_discord_config_reporting():
    default_url = "https://discord.com/api/webhooks/123456789012345678/mockDefaultDiscordWebhookTokenAlphaNum"
    with patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": "", "DEFAULT_DISCORD_WEBHOOK_URL": default_url}):
        cfg = publishing_service.get_discord_config()
        assert cfg["configured"] is True
        assert cfg["isDefault"] is True
        assert cfg["hasCustomOverride"] is False
        assert cfg["missingKeys"] == []

    with patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/123/abc", "DEFAULT_DISCORD_WEBHOOK_URL": default_url}):
        cfg = publishing_service.get_discord_config()
        assert cfg["configured"] is True
        assert cfg["isDefault"] is False
        assert cfg["hasCustomOverride"] is True
        assert cfg["missingKeys"] == []


def test_telegram_default_credentials_resolution():
    """Verify Telegram uses default credentials unless custom are provided."""
    default_tok = "1234567890:mockDefaultTelegramBotTokenAlphaNum"
    default_chat = "@mockchannel"
    custom_tok = "111222333:CustomBotToken"
    custom_chat = "@my_custom_channel"

    # Case 1: Empty environment -> falls back to defaults
    with patch.dict(os.environ, {
        "TELEGRAM_BOT_TOKEN": "",
        "TELEGRAM_CHAT_ID": "",
        "DEFAULT_TELEGRAM_BOT_TOKEN": default_tok,
        "DEFAULT_TELEGRAM_CHAT_ID": default_chat,
    }):
        assert publishing_service.get_telegram_bot_token() == default_tok
        assert publishing_service.get_telegram_chat_id() == default_chat
        assert publishing_service.is_default_telegram() is True
        assert publishing_service.get_missing_keys("telegram") == []

    # Case 2: Custom token and chat set -> custom values used
    with patch.dict(os.environ, {
        "TELEGRAM_BOT_TOKEN": custom_tok,
        "TELEGRAM_CHAT_ID": custom_chat,
        "DEFAULT_TELEGRAM_BOT_TOKEN": default_tok,
        "DEFAULT_TELEGRAM_CHAT_ID": default_chat,
    }):
        assert publishing_service.get_telegram_bot_token() == custom_tok
        assert publishing_service.get_telegram_chat_id() == custom_chat
        assert publishing_service.is_default_telegram() is False

    # Case 3: Explicit parameters override
    explicit_tok = "999888777:Explicit"
    explicit_chat = "@explicit_chan"
    with patch.dict(os.environ, {
        "TELEGRAM_BOT_TOKEN": custom_tok,
        "TELEGRAM_CHAT_ID": custom_chat,
    }):
        assert publishing_service.get_telegram_bot_token(explicit_tok) == explicit_tok
        assert publishing_service.get_telegram_chat_id(explicit_chat) == explicit_chat


def test_telegram_config_reporting():
    default_tok = "1234567890:mockDefaultTelegramBotTokenAlphaNum"
    default_chat = "@mockchannel"

    with patch.dict(os.environ, {
        "TELEGRAM_BOT_TOKEN": "",
        "TELEGRAM_CHAT_ID": "",
        "DEFAULT_TELEGRAM_BOT_TOKEN": default_tok,
        "DEFAULT_TELEGRAM_CHAT_ID": default_chat,
    }):
        cfg = publishing_service.get_telegram_config()
        assert cfg["configured"] is True
        assert cfg["isDefault"] is True
        assert cfg["hasCustomOverride"] is False
        assert cfg["chatId"] == default_chat
        assert cfg["missingKeys"] == []

    with patch.dict(os.environ, {
        "TELEGRAM_BOT_TOKEN": "123:custom",
        "TELEGRAM_CHAT_ID": "@custom",
        "DEFAULT_TELEGRAM_BOT_TOKEN": default_tok,
        "DEFAULT_TELEGRAM_CHAT_ID": default_chat,
    }):
        cfg = publishing_service.get_telegram_config()
        assert cfg["configured"] is True
        assert cfg["isDefault"] is False
        assert cfg["hasCustomOverride"] is True
        assert cfg["chatId"] == "@custom"
        assert cfg["missingKeys"] == []


def test_instagram_default_credentials_resolution():
    default_acc = "17841400000000000"
    default_tok = "mockDefaultMetaAccessToken1234567890"
    custom_acc = "99999999999999999"
    custom_tok = "EAACUSTOMTOKEN123456789"

    # Case 1: Custom keys empty -> default values used
    with patch.dict(os.environ, {
        "INSTAGRAM_ACCOUNT_ID": "",
        "META_ACCESS_TOKEN": "",
        "DEFAULT_INSTAGRAM_ACCOUNT_ID": default_acc,
        "DEFAULT_META_ACCESS_TOKEN": default_tok,
    }):
        assert publishing_service.get_instagram_account_id() == default_acc
        assert publishing_service.get_meta_access_token() == default_tok
        assert publishing_service.is_default_instagram() is True
        assert publishing_service.get_missing_keys("instagram") == []

    # Case 2: Custom account and token set -> custom values used
    with patch.dict(os.environ, {
        "INSTAGRAM_ACCOUNT_ID": custom_acc,
        "META_ACCESS_TOKEN": custom_tok,
        "DEFAULT_INSTAGRAM_ACCOUNT_ID": default_acc,
        "DEFAULT_META_ACCESS_TOKEN": default_tok,
    }):
        assert publishing_service.get_instagram_account_id() == custom_acc
        assert publishing_service.get_meta_access_token() == custom_tok
        assert publishing_service.is_default_instagram() is False

    # Case 3: Explicit parameters override
    explicit_acc = "111222333444555"
    explicit_tok = "EAAEXPLICIT123"
    with patch.dict(os.environ, {
        "INSTAGRAM_ACCOUNT_ID": custom_acc,
        "META_ACCESS_TOKEN": custom_tok,
    }):
        assert publishing_service.get_instagram_account_id(explicit_acc) == explicit_acc
        assert publishing_service.get_meta_access_token(explicit_tok) == explicit_tok


def test_instagram_config_reporting():
    default_acc = "17841400000000000"
    default_tok = "mockDefaultMetaAccessToken1234567890"

    with patch.dict(os.environ, {
        "INSTAGRAM_ACCOUNT_ID": "",
        "META_ACCESS_TOKEN": "",
        "DEFAULT_INSTAGRAM_ACCOUNT_ID": default_acc,
        "DEFAULT_META_ACCESS_TOKEN": default_tok,
    }):
        cfg = publishing_service.get_instagram_config()
        assert cfg["configured"] is True
        assert cfg["isDefault"] is True
        assert cfg["hasCustomOverride"] is False
        assert cfg["accountId"] == default_acc
        assert cfg["missingKeys"] == []

    with patch.dict(os.environ, {
        "INSTAGRAM_ACCOUNT_ID": "12345custom",
        "META_ACCESS_TOKEN": "customtok",
        "DEFAULT_INSTAGRAM_ACCOUNT_ID": default_acc,
        "DEFAULT_META_ACCESS_TOKEN": default_tok,
    }):
        cfg = publishing_service.get_instagram_config()
        assert cfg["configured"] is True
        assert cfg["isDefault"] is False
        assert cfg["hasCustomOverride"] is True
        assert cfg["accountId"] == "12345custom"
        assert cfg["missingKeys"] == []

    with patch.dict(os.environ, {
        "INSTAGRAM_ACCOUNT_ID": "",
        "META_ACCESS_TOKEN": "",
        "DEFAULT_INSTAGRAM_ACCOUNT_ID": default_acc,
        "DEFAULT_META_ACCESS_TOKEN": default_tok,
    }):
        cfg = publishing_service.get_instagram_config()
        assert cfg["configured"] is True
        assert cfg["isDefault"] is True
        assert cfg["hasCustomOverride"] is False
        assert cfg["accountId"] == default_acc
        assert cfg["missingKeys"] == []

    with patch.dict(os.environ, {
        "INSTAGRAM_ACCOUNT_ID": "12345custom",
        "META_ACCESS_TOKEN": "customtok",
        "DEFAULT_INSTAGRAM_ACCOUNT_ID": default_acc,
        "DEFAULT_META_ACCESS_TOKEN": default_tok,
    }):
        cfg = publishing_service.get_instagram_config()
        assert cfg["configured"] is True
        assert cfg["isDefault"] is False
        assert cfg["hasCustomOverride"] is True
        assert cfg["accountId"] == "12345custom"
        assert cfg["missingKeys"] == []
