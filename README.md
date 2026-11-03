# Motivational Shorts Studio

A complete, production-ready full-stack application that transforms background footage (nature, scenery, cityscapes, or travel) and audio soundtracks into vertical 9:16 motivational YouTube Shorts (1080 × 1920) with centered dynamic typography, subtle cinematic overlays, and background audio fading.

Orchestrated using **React + TypeScript + Vite**, **Cloud n8n Webhook Workflow**, and a **FastAPI + FFmpeg** rendering backend connected via **Cloudflare Quick Tunnel**.

---

## 1. System Architecture

```text
User Browser (React + TypeScript Studio UI at http://localhost:5173)
    │
    ▼ (POST /api/webhook/proxy on FastAPI — Bypasses Browser CORS Preflight)
FastAPI Backend Proxy (port 8000)
    │
    ▼ (Server-to-Server POST)
Cloud n8n Webhook (https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short)
    │
    ├──► [Validate Input Node] (Length, Duration, Resolution, Style, extracts fastApiBaseUrl)
    │         │ (If Invalid) ──► Respond Validation Error (400)
    │         ▼ (If Valid)
    ├──► [Download Video Node] ──► FastAPI (via Cloudflare Tunnel): POST /api/media/download
    │         │
    │         ▼
    ├──► [Download Music Node] ──► FastAPI (via Cloudflare Tunnel): POST /api/media/download
    │         │
    │         ▼
    ├──► [Prepare Render Payload Node] (Merge explicit media & parameters)
    │         │
    │         ▼
    ├──► [Render Short Node] ──► FastAPI (via Cloudflare Tunnel): POST /api/video/render
    │         │
    │         ▼
    ├──► [Is Render Successful? Node]
    │         ├──► (Success) ──► Respond Webhook Success (200 + videoUrl)
    │         └──► (Failed)  ──► Respond Render Error (500)
    │
    ▼ (JSON Response with public videoUrl)
React Preview in 9:16 Shorts Mockup & Instant MP4 Download
```

---

## 2. Project Folder Structure

```text
motivational-shorts-studio/
├── backend/
│   ├── app.py                     # Complete FastAPI server, security, FFmpeg engine & Webhook proxy
│   ├── connection_manager.py      # Automated lifecycle manager for backend, Cloudflare Tunnel & auto-reconnect
│   ├── publishing_service.py      # Multi-platform publishing engine (YouTube, Discord, Telegram, Instagram)
│   ├── sheets_service.py          # Google Sheets integration & 12-column publishing updater
│   ├── requirements.txt           # Python dependencies
│   ├── .env.example               # Backend configuration template with publishing credentials
│   ├── .env                       # Local environment configuration
│   ├── pytest.ini                 # Pytest runner configuration
│   ├── media/                     # Storage directory for downloads and outputs
│   └── tests/
│       ├── conftest.py            # Synthetic media fixtures (FFmpeg-generated)
│       ├── test_connection_manager.py # Lifecycle, tunnel parsing, backoff, SSRF & health tests
│       ├── test_publishing.py     # Independent parallel publishing, size limits, captions & dispatch tests
│       ├── test_sheets.py         # Google Sheets inspection & 12-column status tests
│       ├── test_health_and_auth.py# Status, health, and X-API-Key tests
│       ├── test_validation_and_ssrf.py # Input bounds, scheme, and SSRF tests
│       ├── test_render_e2e.py     # Real FFmpeg rendering and probe test
│       ├── test_workflow_json.py  # Validation tests for both v1 and v2 n8n workflows
│       └── test_proxy.py          # Webhook proxy and tunnel header tests
├── frontend/
│   ├── package.json               # Frontend dependencies (React, Vite, Lucide)
│   ├── vite.config.ts             # Vite build configuration
│   ├── tsconfig.json              # TypeScript strict configuration
│   ├── index.html                 # Modern typography and viewport meta
│   ├── .env.example               # Frontend environment template
│   ├── .env                       # Frontend local environment
│   └── src/
│       ├── main.tsx               # React DOM entrypoint
│       ├── App.tsx                # Motivational Shorts Studio master dashboard
│       ├── GoogleSheetsMode.tsx   # Google Sheets automated production mode
│       ├── PublishingDashboard.tsx# Multi-platform autonomous publishing dashboard
│       ├── api.ts                 # Typed API client, persistent storage & CORS proxy
│       ├── styles.css             # Dark cinematic responsive UI stylesheet
│       └── vite-env.d.ts          # Vite environment type definitions
├── n8n/
│   ├── motivational-shorts-workflow.json    # Original v1 video rendering workflow JSON
│   ├── motivational-shorts-workflow-v2.json # New v2 multi-platform automated publishing workflow JSON
│   └── README.md                  # Comprehensive setup guide, credential & node reference

├── scripts/
│   ├── start-dev.sh               # Coordinated runner (FastAPI + Vite + Cloudflare Tunnel)
│   ├── run-local.sh               # Local server runner
│   └── setup-linux.sh             # One-step system setup script for Linux Mint
├── examples/
│   ├── generate-request.json      # Sample input payload
│   ├── generate-response-success.json # Sample success response
│   ├── generate-response-error.json   # Sample error response
│   ├── media-download-request.json    # Sample media download request
│   └── media-download-response.json   # Sample media download response
├── start.bat                  # Universal cross-platform launcher (Windows CMD & Linux Bash) with drag & drop
├── stop.bat                   # Universal shutdown script for backend & frontend servers (ports 8000 & 5173)
├── .gitignore
└── README.md
```

---

## 3. Quick Start & Drag-and-Drop (`start.bat` & `stop.bat`)

You can start the entire studio across both **Windows** and **Linux** with **`start.bat`**:

1. **Normal Start:**
   - **Windows:** Double-click `start.bat`.
   - **Linux:** Run `./start.bat` in your terminal or double-click to execute.
   - Automatically verifies Python, prepares virtual environment, installs dependencies, verifies Node/npm packages, starts FastAPI backend (port 8000) and Vite frontend (port 5173), and opens `http://localhost:5173` in your browser.

2. **Drag & Drop Media Launch:**
   - **Windows:** Drag any video (`.mp4`, `.mov`, `.mkv`, `.webm`) or audio (`.mp3`, `.wav`, `.m4a`) file onto the **`start.bat`** file icon.
   - **Linux:** Pass files as arguments: `./start.bat /path/to/video.mp4`
   - Automatically imports media into `backend/media/`, copies the local serving URL (e.g. `http://localhost:8000/media/video.mp4`) to your clipboard, and launches the Studio!

3. **Clean Shutdown:**
   - Double-click **`stop.bat`** (or `./stop.bat`) or choose `[S]` in the interactive launcher menu to terminate background servers.

---

## 4. Linux / macOS Quick Start: Coordinated Development with Tunnel

To start the complete environment with a single command (verifies FastAPI, Vite, and starts the Cloudflare Tunnel):

```bash
cd "/home/vishal/Downloads/shorts creation"
./scripts/start-dev.sh
```

### What `start-dev.sh` Does:
1. Verifies that FastAPI is running on port 8000 (starts it if needed).
2. Verifies that Vite is running on port 5173 (starts it if needed).
3. Launches `cloudflared tunnel --url http://127.0.0.1:8000`.
4. Captures and prints the assigned `https://*.trycloudflare.com` URL.
5. Verifies the public tunnel with a live health check (`curl -s -f "$TUNNEL_URL/api/health"`).
6. Automatically synchronizes `backend/.env` (`PUBLIC_BASE_URL`) and `frontend/.env` (`VITE_FASTAPI_DIRECT_URL`).
7. Prints a status summary banner.
8. Provides clean Ctrl+C shutdown.

---

## 4. Setting Up the n8n Workflow in Cloud n8n

### Step 1: Import Workflow into Cloud n8n
1. Open your cloud n8n instance:
   `https://lukizerk4.app.n8n.cloud`
2. Go to **Workflows** → click the three dots (`...`) in the top right → select **Import from File**.
3. Choose [`n8n/motivational-shorts-workflow.json`](file:///home/vishal/Downloads/shorts%20creation/n8n/motivational-shorts-workflow.json).
4. Click **Save**.

### Step 2: Activate the Workflow
Toggle the workflow switch in the top-right from **Inactive** to **Active**.
The production webhook URL is:
```text
https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short
```

> [!IMPORTANT]
> If the workflow is Inactive, cloud n8n returns `HTTP 404: The requested webhook is not registered`. Always ensure the workflow is toggled to **Active**.

---

## 5. Solving the CORS Preflight Issue

### Why the Error Happened:
Browsers enforce CORS on cross-origin JavaScript requests with `Content-Type: application/json`. When `http://localhost:5173` calls `https://lukizerk4.app.n8n.cloud/...`, the browser sends an `OPTIONS` preflight request. Cloud n8n's ingress drops or rejects `OPTIONS` with HTTP 500 without `Access-Control-Allow-Origin` headers, resulting in `Failed to fetch`.

### How It is Solved:
1. **Backend Proxy Mode (Default)**:
   The frontend calls `POST http://localhost:8000/api/webhook/proxy` (or through the tunnel).
   FastAPI allows requests from `http://localhost:5173`, handles preflight requests cleanly, and forwards the generation payload server-to-server to cloud n8n via Python `httpx`.
   Server-to-server HTTP requests have no browser CORS restrictions!
2. **CORS Headers in n8n**:
   All Respond to Webhook nodes in `n8n/motivational-shorts-workflow.json` include explicit `Access-Control-Allow-Origin: *` response headers.

---

## 6. Studio Configuration in the Browser

Open **`http://localhost:5173`** and click **Studio Config** in the top-right corner:

1. **n8n Webhook URL**:
   Default: `https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short`
2. **FastAPI Public Base URL**:
   Set to your active Cloudflare Tunnel URL:
   `https://disclose-oil-half-spending.trycloudflare.com` (or current tunnel URL printed by `start-dev.sh`).
3. **Backend Proxy Mode**:
   Keep checked (recommended) to route requests via FastAPI and eliminate CORS.
4. Click **Save & Close** to persist your settings in browser `localStorage`.
5. Click **Reset to Defaults** anytime to restore default cloud endpoints.

---

## 7. Automated Tests

Run the backend test suite:

```bash
cd "/home/vishal/Downloads/shorts creation/backend"
./venv/bin/pytest -v
```

All 12 tests pass, including:
- Health and status endpoints
- Missing and invalid API keys
- FFmpeg 9:16 rendering with real synthetic media and FFprobe integrity validation
- SSRF and private network IP shielding
- Directory traversal protection
- n8n workflow JSON structure and CORS response headers
- Webhook proxy forwarding and dynamic tunnel resolution

---

## 8. Troubleshooting Guide

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `HTTP 404: Webhook not registered` | Workflow is not Active in cloud n8n | Open `https://lukizerk4.app.n8n.cloud`, toggle the workflow switch to **Active**, and click **Save**. |
| `Browser CORS Rejection / Failed to fetch` | Direct browser request blocked by browser security | Enable **Backend Proxy Mode** in Studio Configuration. |
| `FastAPI Backend Offline` | FastAPI service or Cloudflare tunnel is not running | Run `./scripts/start-dev.sh` to start and verify all components. |
| `Tunnel URL changed after restart` | Quick Tunnel subdomains are dynamic | Paste the new `trycloudflare.com` URL into Studio Configuration, or run `./scripts/start-dev.sh` which updates it automatically. |
| `HTTP 401 Unauthorized` | API Key mismatch | Verify `SHORTS_API_KEY` in n8n matches `SHORTS_API_KEY` in `backend/.env`. |
| `Port 8000 already in use` | Existing uvicorn process running | Check with `lsof -i :8000` or reuse the healthy existing process. |
