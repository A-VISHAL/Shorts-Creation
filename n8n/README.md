# n8n Orchestration Workflow: Motivational Shorts Generator

This directory contains the importable n8n workflow for orchestrating YouTube Shorts generation:

`motivational-shorts-workflow.json`

## Workflow Architecture Diagram

```text
[ React Frontend / Studio UI ]
        │
        ▼ (POST /api/webhook/proxy on FastAPI — Bypasses Browser CORS)
┌─────────────────────────────────┐
│ Webhook — Generate Short        │  (https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short)
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Validate Input (Code Node)      │  (Validates URLs, text, style, extracts fastApiBaseUrl)
└────────┬───────────────┬────────┘
         │ (Valid)       │ (Invalid)
         │               └───────────────────────────┐
         ▼                                           ▼
┌─────────────────────────────────┐        ┌───────────────────────────┐
│ Download Source Video (HTTP)    │        │ Respond Validation Error  │
│ (Calls Cloudflare Tunnel URL)   │        │ (HTTP 400 + CORS Headers) │
└────────────────┬────────────────┘        └───────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Download Soundtrack (HTTP)      │
│ (Calls Cloudflare Tunnel URL)   │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Prepare Render Payload (Code)   │  (Merges downloaded files into render JSON)
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Render Short (FFmpeg HTTP)      │  (Calls Cloudflare Tunnel /api/video/render)
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Is Render Successful? (If Node) │
└────────┬───────────────┬────────┘
         │ (Success)     │ (Failed)
         │               └───────────────────────────┐
         ▼                                           ▼
┌─────────────────────────────────┐        ┌───────────────────────────┐
│ Respond Webhook Success         │        │ Respond Render Error      │
│ (HTTP 200 + videoUrl + CORS)    │        │ (HTTP 500 + Error Detail) │
└─────────────────────────────────┘        └───────────────────────────┘
```

---

## 1. How to Import into Cloud n8n

1. Open your cloud n8n instance:
   `https://lukizerk4.app.n8n.cloud`
2. Go to **Workflows** in the left sidebar.
3. Click the three dots icon (`...`) in the top right or click **Add workflow**.
4. Select **Import from File...**.
5. Choose [`n8n/motivational-shorts-workflow.json`](file:///home/vishal/Downloads/shorts%20creation/n8n/motivational-shorts-workflow.json).
6. The workflow will appear with all 11 nodes, layout, and connections intact.
7. Click **Save** in the top right.
8. **CRITICAL**: Toggle the switch in the top-right from **Inactive** to **Active**.
   *(If inactive, cloud n8n returns HTTP 404 "webhook not registered" on production calls!)*

---

## 2. Dynamic FastAPI URL Resolution & Configuration

The workflow is designed to be **resilient to Quick Tunnel restarts**:

### Dynamic Resolution Order:
When executing `Download Source Video`, `Download Soundtrack`, and `Render Short (FFmpeg)`, n8n resolves the FastAPI base URL in this order:
1. `fastApiBaseUrl` sent in the request payload from the frontend.
2. Workflow variable (`$vars.FASTAPI_BASE_URL`).
3. Cloud environment variable (`$env.FASTAPI_BASE_URL`).
4. Fallback URL (`https://disclose-oil-half-spending.trycloudflare.com`).

This means: **Whenever your Cloudflare Tunnel restarts and generates a new URL, you only need to enter it into the Studio Configuration modal in the frontend (or run `scripts/start-dev.sh`). The frontend transmits the active tunnel URL with the generation request, and cloud n8n automatically targets the new tunnel URL without requiring manual node edits in n8n!**

### Configuring Environment Variables in Cloud n8n (Optional):
In your n8n workspace settings:
- `FASTAPI_BASE_URL`: `https://disclose-oil-half-spending.trycloudflare.com` (or your active tunnel)
- `SHORTS_API_KEY`: `dev-shorts-secret-key-2024` (matches `SHORTS_API_KEY` in `backend/.env`)

---

## 3. Webhook URLs

- **Production Webhook URL**:
  ```text
  https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short
  ```
  *(Requires workflow to be Active)*

- **Test Webhook URL**:
  ```text
  https://lukizerk4.app.n8n.cloud/webhook-test/generate-motivational-short
  ```
  *(Requires clicking "Test workflow" on the n8n canvas before sending)*

---

## 4. How the CORS Issue is Solved

### The Problem:
When a browser at `http://localhost:5173` calls a cloud webhook directly (`https://lukizerk4.app.n8n.cloud/...`), the browser sends an HTTP `OPTIONS` preflight request. Cloud n8n's ingress returns HTTP 500 without `Access-Control-Allow-Origin` headers, causing the browser to abort with `Generation Error: Failed to fetch`.

### The Solution:
1. **Backend Proxy Mode (Default & Active)**:
   The frontend routes the request to `POST http://localhost:8000/api/webhook/proxy` (or through the active tunnel).
   FastAPI has full CORS enabled, approves the browser's preflight request, and forwards the payload server-to-server to cloud n8n using Python `httpx`.
   Server-to-server HTTP requests have **zero browser CORS restrictions**.
2. **CORS Response Headers in n8n**:
   The workflow's `Respond to Webhook` nodes now include explicit `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *`, and `Access-Control-Allow-Methods: POST, OPTIONS, GET` headers.

---

## 5. Testing the Workflow via cURL

Test the complete workflow directly:

```bash
curl -X POST "https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short" \
  -H "Content-Type: application/json" \
  -d '{
    "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "musicUrl": "https://actions.google.com/sounds/v1/ambient/ambient_hum.ogg",
    "text": "The secret of getting ahead is getting started right now.",
    "title": "Start Today",
    "durationSeconds": 15,
    "width": 1080,
    "height": 1920,
    "style": "dark-motivational",
    "fastApiBaseUrl": "https://disclose-oil-half-spending.trycloudflare.com"
  }'
```

### Expected Response:
```json
{
  "success": true,
  "jobId": "job_a1b2c3d4e5f6",
  "status": "completed",
  "videoUrl": "https://disclose-oil-half-spending.trycloudflare.com/media/rendered_job_a1b2c3d4e5f6.mp4",
  "downloadUrl": "https://disclose-oil-half-spending.trycloudflare.com/api/video/job_a1b2c3d4e5f6/download",
  "title": "Start Today",
  "durationSeconds": 15,
  "width": 1080,
  "height": 1920,
  "style": "dark-motivational"
}
```

---

## 6. Troubleshooting Cloud n8n

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| `HTTP 404: The requested webhook "POST generate-motivational-short" is not registered` | The workflow is Inactive in cloud n8n | In `https://lukizerk4.app.n8n.cloud`, toggle the workflow switch to **Active** and click **Save**. |
| `Browser CORS Rejection / Failed to fetch` | Direct browser request blocked by browser preflight | Ensure **Backend Proxy Mode** is enabled in Studio Configuration. |
| `ECONNREFUSED / Connection timed out to FastAPI` | Cloudflare Tunnel is not running or URL changed | Run `./scripts/start-dev.sh` to refresh and verify the tunnel URL. |
| `HTTP 401 Unauthorized from FastAPI` | API Key mismatch | Verify `SHORTS_API_KEY` in n8n matches `SHORTS_API_KEY` in `backend/.env`. |
| `Download failed or yt-dlp error` | URL unavailable or blocked | Ensure source video/audio URL is publicly accessible or test with the built-in Quick Presets. |
