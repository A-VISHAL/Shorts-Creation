export interface ShortGeneratePayload {
  videoUrl: string;
  musicUrl: string;
  text: string;
  title: string;
  durationSeconds: number;
  width: number;
  height: number;
  style: 'dark-motivational' | 'minimal-white' | 'bold-motivational';
  fastApiBaseUrl?: string;
}

export interface ShortGenerateResult {
  success: boolean;
  jobId: string;
  status: string;
  videoUrl: string;
  downloadUrl: string;
  title: string;
  durationSeconds: number;
  width: number;
  height: number;
  style?: string;
  error?: {
    code: string;
    message: string;
    hint?: string;
  };
}

export interface BackendHealth {
  status: string;
  service: string;
  version: string;
  dependencies: {
    ffmpeg: boolean;
    ffprobe: boolean;
    yt_dlp?: boolean;
    fontAvailable?: boolean;
  };
  storage?: {
    freeSpaceMb: number;
    totalSpaceMb: number;
  };
  config?: {
    apiKeyConfigured: boolean;
    publicBaseUrl: string;
    detectedPublicBaseUrl?: string;
    renderTimeoutSeconds: number;
  };
}

export interface ConnectionStatus {
  backend: {
    status: 'online' | 'starting' | 'offline';
    localUrl: string;
    isManaged?: boolean;
  };
  tunnel: {
    status: 'connected' | 'connecting' | 'disconnected' | 'error';
    url: string | null;
    lastHealthCheck: string | null;
    reconnectAttempts: number;
    cloudflaredInstalled: boolean;
    installInfo?: {
      os: string;
      command: string;
      downloadUrl: string;
      hint: string;
    } | null;
    error: string | null;
  };
  proxy: {
    enabled: boolean;
    mode: string;
  };
}

export interface StudioConfig {
  webhookUrl: string;
  productionWebhookUrl: string;
  testWebhookUrl: string;
}

export const LOCAL_BACKEND_URL = 'http://localhost:8000';

export const STORAGE_KEYS = {
  WEBHOOK_URL: 'shorts_studio_n8n_webhook_url',
  PROD_WEBHOOK_URL: 'shorts_studio_prod_webhook_url',
  TEST_WEBHOOK_URL: 'shorts_studio_test_webhook_url',
};

export const DEFAULT_CONFIG: StudioConfig = {
  webhookUrl: 'https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short',
  productionWebhookUrl: 'https://lukizerk4.app.n8n.cloud/webhook/generate-motivational-short',
  testWebhookUrl: 'https://lukizerk4.app.n8n.cloud/webhook-test/generate-motivational-short',
};

/**
 * Clean and normalize a URL string (trim and remove trailing slashes).
 */
export function normalizeUrl(url: string): string {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}

/**
 * Validate URL format.
 */
export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Load configuration from localStorage with graceful fallback to defaults or .env.
 */
export function loadStoredConfig(): StudioConfig {
  const envWebhook = import.meta.env.VITE_N8N_WEBHOOK_URL;
  const defaultWebhook = envWebhook && !envWebhook.includes('localhost:5678')
    ? envWebhook
    : DEFAULT_CONFIG.webhookUrl;

  const storedWebhook = localStorage.getItem(STORAGE_KEYS.WEBHOOK_URL);
  const storedProd = localStorage.getItem(STORAGE_KEYS.PROD_WEBHOOK_URL);
  const storedTest = localStorage.getItem(STORAGE_KEYS.TEST_WEBHOOK_URL);

  return {
    webhookUrl: storedWebhook && isValidHttpUrl(storedWebhook) ? storedWebhook : defaultWebhook,
    productionWebhookUrl: storedProd && isValidHttpUrl(storedProd) ? storedProd : DEFAULT_CONFIG.productionWebhookUrl,
    testWebhookUrl: storedTest && isValidHttpUrl(storedTest) ? storedTest : DEFAULT_CONFIG.testWebhookUrl,
  };
}

/**
 * Save configuration to localStorage.
 */
export function saveStoredConfig(config: StudioConfig): void {
  const cleanWebhook = normalizeUrl(config.webhookUrl);

  if (!isValidHttpUrl(cleanWebhook)) {
    throw new Error('n8n Webhook URL must be a valid HTTP or HTTPS address.');
  }

  localStorage.setItem(STORAGE_KEYS.WEBHOOK_URL, cleanWebhook);
  localStorage.setItem(STORAGE_KEYS.PROD_WEBHOOK_URL, normalizeUrl(config.productionWebhookUrl));
  localStorage.setItem(STORAGE_KEYS.TEST_WEBHOOK_URL, normalizeUrl(config.testWebhookUrl));
}

/**
 * Reset configuration to default endpoints.
 */
export function resetStoredConfig(): StudioConfig {
  localStorage.removeItem(STORAGE_KEYS.WEBHOOK_URL);
  localStorage.removeItem(STORAGE_KEYS.PROD_WEBHOOK_URL);
  localStorage.removeItem(STORAGE_KEYS.TEST_WEBHOOK_URL);
  return { ...DEFAULT_CONFIG };
}

/**
 * Fetch real-time connection status (FastAPI backend + Cloudflare Tunnel).
 */
export async function fetchConnectionStatus(backendUrl: string = LOCAL_BACKEND_URL): Promise<ConnectionStatus> {
  const cleanUrl = normalizeUrl(backendUrl);
  const target = `${cleanUrl}/api/connection/status`;

  try {
    const response = await fetch(target, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err: any) {
    return {
      backend: {
        status: 'offline',
        localUrl: LOCAL_BACKEND_URL,
        isManaged: false,
      },
      tunnel: {
        status: 'disconnected',
        url: null,
        lastHealthCheck: null,
        reconnectAttempts: 0,
        cloudflaredInstalled: false,
        error: err.message || 'Cannot reach local backend on port 8000',
      },
      proxy: {
        enabled: true,
        mode: 'automatic',
      },
    };
  }
}

/**
 * Trigger immediate Cloudflare Tunnel reconnection.
 */
export async function retryTunnelConnection(backendUrl: string = LOCAL_BACKEND_URL): Promise<ConnectionStatus> {
  const cleanUrl = normalizeUrl(backendUrl);
  const target = `${cleanUrl}/api/connection/retry`;

  const response = await fetch(target, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Failed to reconnect tunnel: HTTP ${response.status}`);
  }
  return await response.json();
}

/**
 * Verify n8n webhook reachability via backend server.
 */
export async function verifyWebhook(
  webhookUrl: string,
  backendUrl: string = LOCAL_BACKEND_URL
): Promise<{ success: boolean; statusCode: number; message: string }> {
  const cleanBackend = normalizeUrl(backendUrl);
  const target = `${cleanBackend}/api/connection/verify-webhook`;

  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl: normalizeUrl(webhookUrl) }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.message || `Verification failed with HTTP ${response.status}`);
  }
  return data;
}

/**
 * Generate Short: Always routes through the local FastAPI backend proxy.
 * The backend automatically injects the active Cloudflare Quick Tunnel URL
 * so that cloud n8n can reach back to download assets and trigger rendering.
 */
export async function generateShort(
  payload: ShortGeneratePayload,
  webhookUrl: string,
  backendUrl: string = LOCAL_BACKEND_URL
): Promise<ShortGenerateResult> {
  const cleanWebhook = normalizeUrl(webhookUrl);
  const cleanBackend = normalizeUrl(backendUrl);

  const targetUrl = `${cleanBackend}/api/webhook/proxy`;
  const requestBody = JSON.stringify({
    webhookUrl: cleanWebhook,
    payload: payload,
  });

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });
  } catch (err: any) {
    throw new Error(
      `Failed to reach local FastAPI backend proxy (${targetUrl}): ${err.message || 'Connection refused'}. ` +
      `Ensure the local backend is running on port 8000.`
    );
  }

  const rawText = await response.text();
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      `Invalid response format from server (HTTP ${response.status}): ${rawText.slice(0, 180)}`
    );
  }

  // Handle case where n8n returns an array or wrapped json items
  if (Array.isArray(data) && data.length > 0) {
    data = data[0];
  }
  if (data && typeof data === 'object' && data.json && typeof data.json === 'object') {
    data = { ...data, ...data.json };
  }

  const hasNoVideo = data.success === true && !data.videoUrl && !data.downloadUrl;
  const isFailed = !response.ok || data.success === false || data.status === 'failed' || hasNoVideo || (data.error && typeof data.error === 'object');
  if (isFailed) {
    if (hasNoVideo) {
      throw new Error(
        'The n8n webhook responded, but no video output URL was returned.\n\n' +
        'Hint: Ensure the n8n workflow has the FFmpeg Render node connected and that your Cloudflare tunnel is reachable so n8n can trigger rendering.'
      );
    }

    const errorObj = typeof data.error === 'object' && data.error !== null ? data.error : {};
    const errorMsg =
      (typeof data.error === 'string' ? data.error : errorObj.message) ||
      data.message ||
      data.detail ||
      `Request failed with HTTP status ${response.status}`;
    const hint = errorObj.hint || data.hint;

    const formattedError = hint
      ? `${errorMsg}\n\nHint: ${hint}`
      : errorMsg;

    throw new Error(formattedError);
  }

  // Ensure all required fields exist on result object to avoid UI crashes
  const safeResult: ShortGenerateResult = {
    success: data.success !== false,
    jobId: data.jobId || `job_${Date.now()}`,
    status: data.status || 'completed',
    videoUrl: data.videoUrl || data.url || data.outputUrl || '',
    downloadUrl: data.downloadUrl || data.videoUrl || data.url || data.outputUrl || '',
    title: data.title || payload.title || 'Motivational Short',
    durationSeconds: Number(data.durationSeconds || payload.durationSeconds || 30),
    width: Number(data.width || payload.width || 1080),
    height: Number(data.height || payload.height || 1920),
    style: data.style || payload.style,
  };

  return safeResult;
}

/**
 * Check health of backend service directly.
 */
export async function fetchHealth(baseUrl: string = LOCAL_BACKEND_URL): Promise<BackendHealth> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/health`;

  try {
    const response = await fetch(target, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err: any) {
    throw new Error(`Failed to reach ${target}: ${err.message || 'Connection refused'}`);
  }
}

// ==============================================================================
// GOOGLE SHEETS API CLIENT
// ==============================================================================

export interface SheetsAuthStatus {
  configured: boolean;
  serviceAccountEmail: string | null;
  projectId: string | null;
  credentialsSource: string | null;
  instructions: string;
}

export interface SheetMeta {
  title: string;
  id: number;
  rowCount: number;
}

export interface SheetSampleRow {
  rowNumber: number;
  data: Record<string, string>;
  isValid: boolean;
  quote: string;
  videoUrl: string;
  musicUrl: string;
  title: string;
  status: string;
}

export interface SheetInspectResult {
  success: boolean;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheets: SheetMeta[];
  activeSheet: string;
  headers: string[];
  detectedMapping: {
    quote: string;
    video_url: string;
    music_url: string;
    title: string;
    status: string;
    output_url: string;
  };
  totalRows: number;
  validRowsCount: number;
  sampleRows: SheetSampleRow[];
  authMode: string;
  serviceAccountEmail: string | null;
  error?: string;
  code?: string;
}

export interface SheetRowItem {
  rowNumber: number;
  quote: string;
  videoUrl: string;
  musicUrl: string;
  title: string;
  status: string;
  outputUrl: string;
  isValid: boolean;
  invalidReason: string | null;
  raw: Record<string, string>;
}

export const DEFAULT_SPREADSHEET_URL =
  'https://docs.google.com/spreadsheets/d/1NyBnzZRfEkq1uPz7JXFm38ZtH8cBvW8dk006xJizQSo/edit?gid=604247059#gid=604247059';

/**
 * Fetch Google Sheets Service Account status.
 */
export async function fetchSheetsAuthStatus(baseUrl: string = LOCAL_BACKEND_URL): Promise<SheetsAuthStatus> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/sheets/auth-status`;
  const response = await fetch(target, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching sheets auth status`);
  }
  return await response.json();
}

/**
 * Inspect Google Spreadsheet tabs, columns, and sample rows.
 */
export async function inspectSpreadsheet(
  spreadsheetUrl: string,
  sheetName?: string,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<SheetInspectResult> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/sheets/inspect`;

  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spreadsheetUrl: spreadsheetUrl.trim(),
      sheetName: sheetName || null,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `Failed to inspect spreadsheet (HTTP ${response.status})`);
  }
  return data;
}

/**
 * Fetch all mapped rows from Google Spreadsheet.
 */
export async function fetchSpreadsheetRows(
  spreadsheetUrl: string,
  sheetName?: string,
  mapping?: Record<string, string>,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<{ success: boolean; rows: SheetRowItem[]; total: number; validCount: number }> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/sheets/rows`;

  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spreadsheetUrl: spreadsheetUrl.trim(),
      sheetName: sheetName || null,
      mapping: mapping || null,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Failed to fetch rows from spreadsheet (HTTP ${response.status})`);
  }
  return data;
}

/**
 * Update row status & output URL in Google Spreadsheet.
 */
export async function updateSpreadsheetRowStatus(
  spreadsheetUrl: string,
  rowNumber: number,
  newStatus: string,
  outputUrl?: string,
  sheetName?: string,
  statusColumnName?: string,
  outputColumnName?: string,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<boolean> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/sheets/update-status`;

  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spreadsheetUrl: spreadsheetUrl.trim(),
        rowNumber,
        status: newStatus,
        outputUrl: outputUrl || null,
        sheetName: sheetName || null,
        statusColumnName: statusColumnName || null,
        outputColumnName: outputColumnName || null,
      }),
    });
    const data = await response.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn(`Could not update sheet row status:`, err);
    return false;
  }
}

// ==============================================================================
// MULTI-PLATFORM PUBLISHING CLIENT
// ==============================================================================

export interface PlatformPublishResult {
  platform: 'youtube' | 'discord' | 'telegram' | 'instagram';
  status: 'Pending' | 'Processing' | 'Published' | 'Failed' | 'Skipped';
  videoId?: string;
  messageId?: string;
  mediaId?: string;
  url?: string;
  privacy?: string;
  error?: string | null;
}

export interface MultiPlatformPublishReport {
  success: boolean;
  overallStatus: 'Completed' | 'Partially Completed' | 'Failed' | 'Skipped';
  lastPublishAttempt: string;
  platforms: {
    youtube: PlatformPublishResult;
    discord: PlatformPublishResult;
    telegram: PlatformPublishResult;
    instagram: PlatformPublishResult;
  };
  sheetUpdated?: boolean;
  sheetData?: Record<string, any>;
}

export interface PlatformConnectionDetail {
  platform: 'youtube' | 'discord' | 'telegram' | 'instagram' | string;
  connected: boolean;
  status: 'Not Connected' | 'Connected' | 'Testing' | 'Error' | string;
  missingKeys: string[];
  requiredKeys: string[];
  accountName?: string | null;
  error?: string | null;
  testedAt?: string | null;
  isDefault?: boolean;
}

export interface PublishingConnectionsStatus {
  youtube: PlatformConnectionDetail;
  discord: PlatformConnectionDetail;
  telegram: PlatformConnectionDetail;
  instagram: PlatformConnectionDetail;
}

export interface PlatformTestResult {
  platform: string;
  connected: boolean;
  status: 'Not Connected' | 'Connected' | 'Error';
  missingKeys?: string[];
  accountName?: string | null;
  error?: string | null;
  testedAt?: string;
}

export interface PlatformConfigureResult {
  saved: boolean;
  platform: string;
  testResult: PlatformTestResult;
}

export interface MediaVerifyResult {
  valid: boolean;
  error: string | null;
}

export interface PublishDispatchRequestPayload {
  videoUrl: string;
  title: string;
  quote: string;
  platforms?: {
    youtube: boolean;
    discord: boolean;
    telegram: boolean;
    instagram: boolean;
  };
  youtubePrivacy?: 'private' | 'public' | 'unlisted';
  spreadsheetUrl?: string;
  rowNumber?: number;
  sheetName?: string;
}

/**
 * Fetch verified status of credentials / connections for YouTube, Discord, Telegram, and Instagram.
 * Pass force=true to trigger immediate live re-authentication tests against platform APIs.
 */
export async function fetchPublishingStatus(
  force: boolean = false,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<PublishingConnectionsStatus> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/publish/status?force=${force ? 'true' : 'false'}`;
  const response = await fetch(target, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching publishing connection statuses`);
  }
  return await response.json();
}

/**
 * Execute live connection test against a specific platform.
 */
export async function testPlatformConnection(
  platform: string,
  credentials?: Record<string, string>,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<PlatformTestResult> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/publish/test-connection`;
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: platform.toLowerCase(),
      credentials: credentials || {},
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.error || `Connection test failed (HTTP ${response.status})`);
  }
  return data;
}

/**
 * Save credentials securely to backend/.env and verify connection immediately.
 */
export async function configurePlatform(
  platform: string,
  credentials: Record<string, string>,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<PlatformConfigureResult> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/publish/configure`;
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: platform.toLowerCase(),
      credentials,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.error || `Configuration failed (HTTP ${response.status})`);
  }
  return data;
}

/**
 * Verify video file or URL accessibility before initiating publishing.
 */
export async function verifyMediaFile(
  videoUrl: string,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<MediaVerifyResult> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/media/verify`;
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl: videoUrl.trim() }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || `Video verification failed (HTTP ${response.status})`);
  }
  return data;
}

/**
 * Dispatch multi-platform publishing in parallel to selected platforms.
 */
export async function dispatchPublish(
  payload: PublishDispatchRequestPayload,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<MultiPlatformPublishReport> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/publish/dispatch`;

  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.detail || data.error || `Publishing dispatch failed (HTTP ${response.status})`);
  }
  return data;
}

/**
 * Update multi-platform publishing status columns in Google Sheet.
 */
export async function updateGoogleSheetPublishing(
  spreadsheetUrl: string,
  rowNumber: number,
  publishingData: Record<string, any>,
  sheetName?: string,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<boolean> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/sheets/update-publishing`;

  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spreadsheetUrl: spreadsheetUrl.trim(),
        rowNumber,
        publishingData,
        sheetName: sheetName || null,
      }),
    });
    const data = await response.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn('Could not update sheet publishing columns:', err);
    return false;
  }
}

/**
 * Ensure all 12 publishing columns exist in Google Sheet.
 */
export async function ensureGoogleSheetPublishingColumns(
  spreadsheetUrl: string,
  sheetName?: string,
  baseUrl: string = LOCAL_BACKEND_URL
): Promise<{ success: boolean; headers: string[] }> {
  const cleanUrl = normalizeUrl(baseUrl);
  const target = `${cleanUrl}/api/sheets/ensure-columns`;

  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spreadsheetUrl: spreadsheetUrl.trim(),
      sheetName: sheetName || null,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || 'Failed to verify spreadsheet columns');
  }
  return data;
}

