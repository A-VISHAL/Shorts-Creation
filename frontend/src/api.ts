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
  webhookUrl: 'https://lukizerk3.app.n8n.cloud/webhook/generate-motivational-short',
  productionWebhookUrl: 'https://lukizerk3.app.n8n.cloud/webhook/generate-motivational-short',
  testWebhookUrl: 'https://lukizerk3.app.n8n.cloud/webhook-test/generate-motivational-short',
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

  if (!response.ok || data.success === false) {
    const errorObj = data.error || {};
    const errorMsg =
      errorObj.message ||
      data.message ||
      data.detail ||
      `Request failed with HTTP status ${response.status}`;
    const hint = errorObj.hint || data.hint;

    const formattedError = hint
      ? `${errorMsg}\n\nHint: ${hint}`
      : errorMsg;

    throw new Error(formattedError);
  }

  return data as ShortGenerateResult;
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
