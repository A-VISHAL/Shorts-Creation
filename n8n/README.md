# n8n Orchestration Workflows: Motivational Shorts Studio

This directory contains the exportable and importable n8n workflows for orchestrating automated Shorts generation and multi-platform publishing:

1. **Version 1 (Rendering Core)**: [`motivational-shorts-workflow.json`](file:///home/vishal/Downloads/shorts%20creation/n8n/motivational-shorts-workflow.json)
   - Downloads source footage and soundtrack via yt-dlp and FastAPI.
   - Renders 9:16 vertical video with typography overlay and background music using FFmpeg.
   - Responds with the rendered video URL and downloadable MP4.

2. **Version 2 (Multi-Platform Automatic Publishing)**: [`motivational-shorts-workflow-v2.json`](file:///home/vishal/Downloads/shorts%20creation/n8n/motivational-shorts-workflow-v2.json)
   - Everything in Version 1, plus:
   - Downloads rendered MP4 into binary data.
   - Formats platform-specific captions with a **consistent motivational quote** across all platforms.
   - Dispatches to **4 independent parallel branches**:
     1. **YouTube Shorts** (Upload MP4, Tags, Category, Privacy status).
     2. **Discord** (Upload actual MP4 attachment with size validation ≤ 25MB).
     3. **Telegram** (Send MP4 video with markdown captions with size validation ≤ 50MB).
     4. **Instagram Reels** (Official Meta Graph API: Container → Poll → Publish → Permalink).
   - Aggregates all publishing results with zero-blocking error tolerance.
   - Automatically updates Google Sheet with all 12 publishing columns.
   - Returns a comprehensive final publishing report.

---

## Version 2 Workflow Architecture Diagram

```text
[ React Frontend / Studio UI / Google Sheet Row ]
        │
        ▼ (POST /api/webhook/proxy on FastAPI)
┌──────────────────────────────────────────────┐
│ Webhook — Generate Short v2                  │  (path: generate-motivational-short-v2)
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Validate Input (Code Node)                   │  (Validates media URLs, quote, platforms)
└──────────────┬───────────────────────────────┘
               │ (Valid)
               ▼
┌──────────────────────────────────────────────┐
│ Download Source Video (HTTP)                 │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│ Download Soundtrack (HTTP)                   │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│ Prepare Render Payload (Code Node)           │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│ Render Short (FFmpeg HTTP)                   │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│ Is Render Successful? (If Node)              │
└──────────────┬───────────────────────────────┘
               │ (Success)
               ▼
┌──────────────────────────────────────────────┐
│ Get Final MP4 and Metadata (HTTP GET File)   │  (Fetches rendered binary MP4 into 'data')
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│ Prepare Platform-Specific Captions (Code)    │  (Consistent quote + tailored captions)
└───────┬──────────────┬──────────────┬────────┘
        │              │              │              │ (Parallel Independent Branches)
        ▼              ▼              ▼              ▼
┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐
│ Publish to   ││ Send to      ││ Send to      ││ Publish      │
│ YouTube      ││ Discord      ││ Telegram     ││ Instagram    │
│ Shorts       ││ Channel      ││ Channel      ││ Reel         │
└───────┬──────┘└──────┬───────┘└──────┬───────┘└──────┬───────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐
│ Format YT    ││ Format DC    ││ Format TG    ││ Format IG    │
│ Result       ││ Result       ││ Result       ││ Result       │
└───────┬──────┘└──────┬───────┘└──────┬───────┘└──────┬───────┘
        │              │              │              │
        └──────────────┴───────┬──────┴──────────────┘
                               │ (Fan-in)
                               ▼
┌──────────────────────────────────────────────┐
│ Collect All Publishing Results (Code Node)   │  (Computes overall status: Completed /
└──────────────────────┬───────────────────────┘   Partially Completed / Failed)
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Update Google Sheet (HTTP POST)              │  (Updates 12 publishing columns in row)
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Return Final Publishing Report               │  (HTTP 200 + multi-platform status report)
└──────────────────────────────────────────────┘
```

---

## 1. How to Import Version 2 into Cloud n8n

1. Open your cloud n8n instance:
   `https://lukizerk4.app.n8n.cloud`
2. Go to **Workflows** in the left sidebar.
3. Click the three dots icon (`...`) in the top right or click **Add workflow**.
4. Select **Import from File...**.
5. Choose [`n8n/motivational-shorts-workflow-v2.json`](file:///home/vishal/Downloads/shorts%20creation/n8n/motivational-shorts-workflow-v2.json).
6. The workflow will appear with all 22 nodes, layout, and connections intact.
7. Click **Save** in the top right.
8. **CRITICAL**: Toggle the switch in the top-right from **Inactive** to **Active**.

---

## 2. Platform Requirements & Capabilities

### 1. YouTube Shorts
- **Node**: YouTube Node or HTTP Resumable Upload
- **Uploaded Media**: Actual MP4 binary data
- **Privacy**: `private` (default for testing), configurable to `public` or `unlisted`
- **Metadata**:
  - Title: Motivational Title `#Shorts`
  - Description: Motivational Quote + discipline message + `#Shorts #Motivation #Success #Inspiration #Mindset`
  - Tags: `Shorts, Motivation, Success, Inspiration, Mindset`
  - Category: `22` (People & Blogs)
- **Output**: Returns YouTube Video ID and watch URL (`https://youtube.com/shorts/<video_id>`).

### 2. Discord Channel / Webhook
- **Uploaded Media**: Actual MP4 video file attached via multipart/form-data
- **File Size Validation**: Enforces **25 MB** maximum limit. If the video exceeds 25 MB, returns an explicit diagnostic error rather than silently degrading to text.
- **Message Content**: Motivational title, blockquoted quote, and relevant hashtags.
- **Output**: Returns Discord Message ID and direct message link.

### 3. Telegram Channel
- **Uploaded Media**: Actual MP4 video streamed via Telegram Bot API `sendVideo`
- **File Size Validation**: Enforces **50 MB** Bot API maximum limit.
- **Caption**: Title, quote, and hashtags formatted in clean Markdown.
- **Output**: Returns Telegram Message ID and channel post link (`https://t.me/<channel>/<message_id>`).

### 4. Instagram Reels (Meta Graph API)
- **Official Process**:
  1. **Create Media Container**: `POST https://graph.facebook.com/v19.0/{account_id}/media` with `media_type=REELS`, `video_url`, `caption`.
  2. **Poll Container**: Polls `GET https://graph.facebook.com/v19.0/{container_id}?fields=status_code,status` until `FINISHED`.
  3. **Publish Reel**: `POST https://graph.facebook.com/v19.0/{account_id}/media_publish` with `creation_id`.
  4. **Retrieve Permalink**: `GET https://graph.facebook.com/v19.0/{media_id}?fields=permalink`.
- **Public URL Requirement**: Instagram fetches the video directly from the public HTTPS URL (via Cloudflare Tunnel). Localhost URLs are automatically validated and rejected with instructions.
- **Output**: Returns published Instagram Media ID and permanent Reel URL (`https://www.instagram.com/reel/...`).

---

## 3. Parallel Execution and Fault Tolerance

All 4 publishing branches operate with `"onError": "continueRegularOutput"`.
- If **Instagram fails** due to token expiry, YouTube, Discord, and Telegram still publish successfully.
- If **Discord fails** due to file size, YouTube, Telegram, and Instagram proceed uninterrupted.
- The results from all 4 branches are merged:
  - **Completed**: All attempted platforms published successfully.
  - **Partially Completed**: At least one platform published, but another encountered an issue.
  - **Failed**: All attempted platforms failed.

---

## 4. Google Sheets 12-Column Integration

When publishing is completed, the workflow automatically updates the original selected row in your Google Sheet with the following 12 columns:

| Column Header | Type | Description |
| :--- | :--- | :--- |
| `youtube_status` | String | `Published`, `Failed`, or `Skipped` |
| `youtube_video_id` | String | YouTube video ID |
| `youtube_url` | String | Direct YouTube Shorts link |
| `discord_status` | String | `Published`, `Failed`, or `Skipped` |
| `discord_message_id` | String | Discord message ID |
| `telegram_status` | String | `Published`, `Failed`, or `Skipped` |
| `telegram_message_id` | String | Telegram message ID |
| `instagram_status` | String | `Published`, `Failed`, or `Skipped` |
| `instagram_media_id` | String | Meta Instagram media ID |
| `instagram_url` | String | Direct Instagram Reel permalink |
| `overall_publish_status` | String | `Completed`, `Partially Completed`, or `Failed` |
| `last_publish_attempt` | ISO Date | Timestamp of the publishing attempt |

If any of these columns are missing in row 1 of your Google Sheet, the system automatically detects and appends them to row 1 without destroying your existing columns.

---

## 5. One-Time Setup Guide for Platform Credentials

Add the following to your `backend/.env` file:

### YouTube Shorts
```bash
YOUTUBE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your-oauth-client-secret
YOUTUBE_REFRESH_TOKEN=your-oauth-refresh-token
YOUTUBE_DEFAULT_PRIVACY=private
```

### Discord
```bash
# To create a webhook: Discord Server Settings -> Integrations -> Webhooks -> New Webhook
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-id/your-token
```

### Telegram
```bash
# Create bot via @BotFather and add as Administrator to your channel
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=@your_channel_username  # or numeric channel ID
```

### Instagram Reels
```bash
# Instagram Professional (Creator/Business) account linked to a Facebook Page
INSTAGRAM_ACCOUNT_ID=your_instagram_account_id
META_ACCESS_TOKEN=your_long_lived_token
META_API_VERSION=v19.0
```

---

## 6. Testing the Workflow via cURL

```bash
curl -X POST "https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short-v2" \
  -H "Content-Type: application/json" \
  -d '{
    "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "musicUrl": "https://actions.google.com/sounds/v1/ambient/ambient_hum.ogg",
    "text": "Discipline is choosing between what you want now and what you want most.",
    "title": "Unbreakable Discipline",
    "durationSeconds": 15,
    "width": 1080,
    "height": 1920,
    "style": "dark-motivational",
    "publishPlatforms": {
      "youtube": true,
      "discord": true,
      "telegram": true,
      "instagram": true
    },
    "youtubePrivacy": "private",
    "fastApiBaseUrl": "https://your-tunnel.trycloudflare.com"
  }'
```

### Response Example:
```json
{
  "success": true,
  "status": "completed",
  "jobId": "job_a1b2c3d4e5f6",
  "videoUrl": "https://your-tunnel.trycloudflare.com/media/rendered_job_a1b2c3d4e5f6.mp4",
  "downloadUrl": "https://your-tunnel.trycloudflare.com/api/video/job_a1b2c3d4e5f6/download",
  "title": "Unbreakable Discipline",
  "durationSeconds": 15,
  "publishing": {
    "overall_publish_status": "Completed",
    "last_publish_attempt": "2026-10-31T22:45:00Z",
    "youtube": {
      "platform": "youtube",
      "status": "Published",
      "videoId": "abc123xyz",
      "url": "https://youtube.com/shorts/abc123xyz"
    },
    "discord": {
      "platform": "discord",
      "status": "Published",
      "messageId": "1234567890",
      "url": "https://discord.com/channels/@me/123/456"
    },
    "telegram": {
      "platform": "telegram",
      "status": "Published",
      "messageId": "789"
    },
    "instagram": {
      "platform": "instagram",
      "status": "Published",
      "mediaId": "17900000000",
      "url": "https://www.instagram.com/reel/Cx123abc/"
    }
  }
}
```
