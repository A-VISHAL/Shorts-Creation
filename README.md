# Motivational Shorts Studio

A complete, production-ready full-stack application that transforms background footage (nature, scenery, cityscapes, or travel) and audio soundtracks into vertical 9:16 motivational YouTube Shorts (1080 × 1920) with centered dynamic typography, subtle cinematic overlays, and background audio fading.

Includes autonomous **Multi-Platform Publishing** to **YouTube Shorts**, **Discord**, **Telegram**, and **Instagram Reels**, plus automated batch generation via **Google Sheets**.

Orchestrated using **React + TypeScript + Vite**, **FastAPI + FFmpeg**, **Cloud n8n Webhook Workflows**, and connected via **Cloudflare Quick Tunnel**.

---

## 1. System Architecture

```text
                                  ┌──────────────────────────┐
                                  │   Browser UI (React UI)  │
                                  │   http://localhost:5173  │
                                  └────────────┬─────────────┘
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               ▼ (Manual Generation / Presets)                                 ▼ (Publishing Dashboard / Sheets)
┌───────────────────────────────────────────────┐               ┌─────────────────────────────────────────────┐
│  FastAPI Backend Proxy (port 8000)            │               │  Multi-Platform Publishing Engine           │
│  POST /api/webhook/proxy (bypasses CORS)      │               │  POST /api/publish/dispatch                 │
└──────────────────────┬────────────────────────┘               └──────────────────────┬──────────────────────┘
                       │                                                               │
                       ▼                                           ┌───────────────────┼───────────────────┐
┌───────────────────────────────────────────────┐                  ▼                   ▼                   ▼
│  Cloud n8n Webhook Pipeline                   │            YouTube Shorts         Discord             Telegram
│  - Parameter Validation                       │           (YouTube Data API)    (Auto-Compressed    (Bot API sendVideo
│  - Media Download (FastAPI + yt-dlp)          │                                    < 25 MB)            < 50 MB)
│  - FFmpeg 9:16 Canvas Render Engine           │                                      │                   │
│  - MP4 Stream Verification                    │                                      ▼                   ▼
└──────────────────────┬────────────────────────┘                              Instagram Reels       Google Sheets
                       │                                                    (Graph API Container     (12-Column Auto
                       ▼                                                     -> Poll -> Publish)      Status Update)
     Output Short Ready (Preview & Download)
```

---

## 2. Key Features

- **⚡ Quick Start Presets**: 1-click generation templates (*Instant Studio Demo*, *YouTube Shorts Demo*, *Clean Minimalist*).
- **🎨 Dynamic Vertical Canvas (1080 × 1920)**: High-performance FFmpeg rendering with customizable dark, minimal-white, and bold-motivational visual styles, auto-wrapped typography, and smooth audio fading.
- **🚀 Multi-Platform Publishing**:
  - **YouTube Shorts**: Resumable video upload via YouTube Data API v3 OAuth2 with `#Shorts` tagging and custom privacy settings.
  - **Discord**: Webhook or Bot attachment delivery featuring **automatic FFmpeg compression** so videos never exceed Discord's 25 MB limit.
  - **Telegram**: High-speed video publishing via Telegram Bot API (`sendVideo`) with size optimization.
  - **Instagram Reels**: Full Meta Graph API flow (Media Container creation → status polling → publish → permalink resolution).
- **📊 Google Sheets Automated Production**: Inspect sheets, map columns, and execute batch video generation while recording per-platform publishing status, URLs, and IDs across 12 spreadsheet columns.
- **🔒 Zero-Leak Security**: All secrets, bot tokens, and OAuth keys reside exclusively in local `backend/.env` files and are never committed to Git.
- **🛡️ SSRF & Path Traversal Protection**: Comprehensive URL scheme validation, loopback restriction, and destination IP shielding on all backend download and proxy endpoints.

---

## 3. Project Folder Structure

```text
motivational-shorts-studio/
├── backend/
│   ├── app.py                     # FastAPI server, endpoints, FFmpeg rendering & proxy
│   ├── connection_manager.py      # Cloudflare Tunnel lifecycle & auto-reconnect manager
│   ├── publishing_service.py      # Multi-platform publishing engine with auto-compression
│   ├── sheets_service.py          # Google Sheets integration & 12-column updater
│   ├── requirements.txt           # Python dependencies
│   ├── .env.example               # Sanitized template for environment variables
│   ├── .env                       # Local private secrets (ignored by Git)
│   ├── pytest.ini                 # Pytest runner configuration
│   ├── media/                     # Storage directory for downloads and rendered videos
│   └── tests/
│       ├── conftest.py            # Synthetic media fixtures (FFmpeg-generated)
│       ├── test_publishing.py     # Multi-platform publishing, size limits & fallback tests
│       ├── test_connection_manager.py # Lifecycle, tunnel parsing & health tests
│       ├── test_sheets.py         # Google Sheets inspection & status update tests
│       ├── test_health_and_auth.py# Status, health, and X-API-Key tests
│       ├── test_validation_and_ssrf.py # Input bounds, scheme, and SSRF tests
│       ├── test_render_e2e.py     # Real FFmpeg rendering and probe tests
│       ├── test_workflow_json.py  # Validation for v1 and v2 n8n workflow files
│       └── test_proxy.py          # Webhook proxy and tunnel header tests
├── frontend/
│   ├── package.json               # Frontend dependencies (React 18, Vite, Lucide)
│   ├── vite.config.ts             # Vite build configuration
│   ├── tsconfig.json              # TypeScript strict configuration
│   ├── index.html                 # HTML entrypoint
│   ├── .env.example               # Frontend environment template
│   ├── .env                       # Frontend local environment (ignored by Git)
│   └── src/
│       ├── main.tsx               # React DOM entrypoint
│       ├── App.tsx                # Motivational Shorts Studio master dashboard
│       ├── GoogleSheetsMode.tsx   # Google Sheets automated production mode
│       ├── PublishingDashboard.tsx# Multi-platform autonomous publishing dashboard
│       ├── api.ts                 # Typed API client, persistent storage & CORS proxy
│       └── styles.css             # Dark cinematic responsive UI stylesheet
├── n8n/
│   ├── motivational-shorts-workflow.json    # Original v1 video rendering workflow JSON
│   ├── motivational-shorts-workflow-v2.json # v2 multi-platform automated publishing workflow JSON
│   └── README.md                  # Workflow import guide & node documentation
├── scripts/
│   ├── start-dev.sh               # Coordinated runner (FastAPI + Vite + Cloudflare Tunnel)
│   ├── run-local.sh               # Local server runner
│   └── setup-linux.sh             # Linux Mint / Ubuntu setup script
├── examples/                      # Sample JSON payloads for requests and responses
├── start.bat                      # Universal cross-platform launcher (Windows CMD & Linux Bash)
├── stop.bat                       # Universal shutdown script for backend & frontend
├── .gitignore                     # Git ignore rules protecting .env and heavy media
└── README.md
```

---

## 4. Quick Start (`start.bat` & `stop.bat`)

Start the full studio across both **Windows** and **Linux**:

1. **Normal Startup:**
   - **Windows:** Double-click `start.bat`.
   - **Linux:** Run `./start.bat` in your terminal.
   - Automatically sets up the Python virtual environment, installs dependencies, verifies npm packages, launches the FastAPI backend (port 8000) and Vite frontend (port 5173), and opens `http://localhost:5173` in your browser.

2. **Drag & Drop Media Launch:**
   - **Windows:** Drag any video (`.mp4`, `.mov`, `.mkv`, `.webm`) or audio (`.mp3`, `.wav`, `.m4a`) onto `start.bat`.
   - **Linux:** Run `./start.bat /path/to/media.mp4`.
   - Automatically imports media into `backend/media/` and copies the local serving URL (e.g., `http://localhost:8000/media/video.mp4`) to your clipboard.

3. **Shutdown:**
   - Run `stop.bat` (or `./stop.bat`) to gracefully terminate all backend and frontend background processes.

---

## 5. Development with Cloudflare Tunnel (`scripts/start-dev.sh`)

For cloud workflows (such as n8n Webhooks and Meta Instagram Graph API) that need to reach your local rendering backend via HTTPS:

```bash
./scripts/start-dev.sh
```

### What `start-dev.sh` Does:
1. Launches FastAPI on port 8000 and Vite on port 5173.
2. Starts `cloudflared tunnel --url http://127.0.0.1:8000`.
3. Detects your public `https://*.trycloudflare.com` tunnel URL.
4. Synchronizes `PUBLIC_BASE_URL` in `backend/.env` and `VITE_FASTAPI_DIRECT_URL` in `frontend/.env`.
5. Runs a live health check to confirm end-to-end reachability.

---

## 6. Multi-Platform Publishing Configuration

All credentials are encrypted and stored in `backend/.env`.

### 1. YouTube Shorts (OAuth 2.0)
- **Google Cloud Console**: Enable **YouTube Data API v3** and create an **OAuth 2.0 Client ID** (Web application).
- **Required Scopes**:
  - `https://www.googleapis.com/auth/youtube.upload` *(video upload)*
  - `https://www.googleapis.com/auth/youtube.readonly` *(channel verification)*
  *(Or `https://www.googleapis.com/auth/youtube` for full management).*
- Obtain a long-lived `refresh_token` using Google OAuth 2.0 Playground.

### 2. Discord (Auto-Compressed Uploads)
- **Standard Upload Limit**: Discord enforces a **25 MB** maximum upload limit.
- **Automatic Compression Engine**: If a rendered video is oversized (e.g. 30+ MB), the backend automatically recompresses it via FFmpeg down to ~21 MB on-the-fly before uploading.

### 3. Telegram
- Create a bot via `@BotFather` to get your `TELEGRAM_BOT_TOKEN`.
- Add the bot as an Administrator to your channel with "Post Messages" permission.
- Set `TELEGRAM_CHAT_ID=@your_channel_name`.

### 4. Instagram Reels
- Requires an **Instagram Professional Account** (Creator or Business) linked to a Facebook Page.
- Requires a Meta Graph API long-lived user/page token with `instagram_content_publish` permission.
- Video must be accessible via public HTTPS URL (provided by active Cloudflare Tunnel).

---

## 7. Security Best Practices & Environment Management

> [!CAUTION]
> **Never commit `.env` files to version control.**

- **Local Secrets**: All private keys, bot tokens, and client secrets belong exclusively in `backend/.env` and `frontend/.env`.
- **Sanitized Templates**: Use [`backend/.env.example`](file:///home/vishal/Downloads/shorts%20creation/backend/.env.example) and [`frontend/.env.example`](file:///home/vishal/Downloads/shorts%20creation/frontend/.env.example) as reference templates.
- **Git Protection**: The root [`.gitignore`](file:///home/vishal/Downloads/shorts%20creation/.gitignore) excludes `.env`, `*.env.local`, `dist/`, and local media storage.

---

## 8. Running Automated Tests

Run the full backend test suite with Pytest:

```bash
cd backend
./venv/bin/pytest -v
```

**54 automated tests** verify:
- Multi-platform publishing dispatch, error isolation, and fallback handling
- Automatic FFmpeg video compression under Discord's 25 MB limit
- YouTube OAuth credential resolution and scope verification
- Cloudflare Tunnel lifecycle and auto-reconnect backoff
- SSRF shielding and private network IP filtering
- FFmpeg 9:16 rendering and stream integrity
- Google Sheets inspection, column mapping, and 12-column status updating
- n8n workflow JSON structure and CORS response headers

---

## 9. Troubleshooting Guide

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `HTTP 404: Webhook not registered` | Workflow is Inactive in n8n | Open `https://lukizerk4.app.n8n.cloud`, toggle the workflow switch to **Active**, and click **Save**. |
| `Browser CORS Rejection / Failed to fetch` | Direct browser request blocked by CORS | Keep **Backend Proxy Mode** enabled in Studio Configuration. |
| `Discord file size exceeds 25 MB` | Source video bitrate was too high | The publishing service now automatically compresses videos to < 25 MB. Re-publish or re-render using the optimized engine. |
| `YouTube connection test failed (403)` | Missing read scope on OAuth token | Ensure your OAuth refresh token was authorized with both `youtube.upload` and `youtube.readonly`. |
| `Instagram: URL not reachable` | Instagram cannot access localhost | Ensure Cloudflare Tunnel is running (`./scripts/start-dev.sh`) so Instagram can fetch the video via public HTTPS. |
| `FastAPI Backend Offline` | Service is not running | Run `./scripts/start-dev.sh` or `./start.bat` to launch the server. |
| `Port 8000 already in use` | Existing uvicorn process running | Run `./stop.bat` to terminate lingering server processes. |
