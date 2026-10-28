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

export interface StudioConfig {
  webhookUrl: string;
  fastApiBaseUrl: string;
  useProxy: boolean;
}

export const STORAGE_KEYS = {
  WEBHOOK_URL: 'shorts_studio_n8n_webhook_url',
  FASTAPI_URL: 'shorts_studio_fastapi_base_url',
  USE_PROXY: 'shorts_studio_use_proxy_mode',
};

// Defaults: cloud n8n orchestrator + current Cloudflare Quick Tunnel
export const DEFAULT_CONFIG: StudioConfig = {
  webhookUrl: 'https://lukizerk3.app.n8n.cloud/webhook/generate-motivational-short',
  fastApiBaseUrl: 'https://disclose-oil-half-spending.trycloudflare.com',
  useProxy: true,
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
  const envFastApi = import.meta.env.VITE_FASTAPI_DIRECT_URL;

  const defaultWebhook = envWebhook && !envWebhook.includes('localhost:5678')
    ? envWebhook
    : DEFAULT_CONFIG.webhookUrl;

  const defaultFastApi = envFastApi || DEFAULT_CONFIG.fastApiBaseUrl;

  const storedWebhook = localStorage.getItem(STORAGE_KEYS.WEBHOOK_URL);
  const storedFastApi = localStorage.getItem(STORAGE_KEYS.FASTAPI_URL);
  const storedProxy = localStorage.getItem(STORAGE_KEYS.USE_PROXY);

  return {
    webhookUrl: storedWebhook && isValidHttpUrl(storedWebhook) ? storedWebhook : defaultWebhook,
    fastApiBaseUrl: storedFastApi && isValidHttpUrl(storedFastApi) ? storedFastApi : defaultFastApi,
    useProxy: storedProxy !== null ? storedProxy === 'true' : true,
  };
}

/**
 * Save configuration to localStorage.
 */
export function saveStoredConfig(config: StudioConfig): void {
  const cleanWebhook = normalizeUrl(config.webhookUrl);
  const cleanFastApi = normalizeUrl(config.fastApiBaseUrl);

  if (!isValidHttpUrl(cleanWebhook)) {
    throw new Error('n8n Webhook URL must be a valid HTTP or HTTPS address.');
  }
  if (!isValidHttpUrl(cleanFastApi)) {
    throw new Error('FastAPI Public Base URL must be a valid HTTP or HTTPS address.');
  }

  localStorage.setItem(STORAGE_KEYS.WEBHOOK_URL, cleanWebhook);
  localStorage.setItem(STORAGE_KEYS.FASTAPI_URL, cleanFastApi);
  localStorage.setItem(STORAGE_KEYS.USE_PROXY, String(config.useProxy));
}

/**
 * Reset configuration to default cloud endpoints.
 */
export function resetStoredConfig(): StudioConfig {
  localStorage.removeItem(STORAGE_KEYS.WEBHOOK_URL);
  localStorage.removeItem(STORAGE_KEYS.FASTAPI_URL);
  localStorage.removeItem(STORAGE_KEYS.USE_PROXY);
  return { ...DEFAULT_CONFIG };
}

/**
 * Generate Short: Routes through FastAPI backend proxy by default to eliminate browser
 * CORS preflight rejections from cloud n8n, or connects directly if toggled.
 */
export async function generateShort(
  payload: ShortGeneratePayload,
  webhookUrl: string,
  fastApiBaseUrl: string,
  useProxy: boolean = true
): Promise<ShortGenerateResult> {
  const cleanWebhook = normalizeUrl(webhookUrl);
  const cleanFastApi = normalizeUrl(fastApiBaseUrl);

  const fullPayload = {
    ...payload,
    fastApiBaseUrl: cleanFastApi,
  };

  let targetUrl: string;
  let requestBody: string;

  if (useProxy) {
    // Route via local/tunnel FastAPI proxy to eliminate browser CORS
    targetUrl = `${cleanFastApi}/api/webhook/proxy`;
    requestBody = JSON.stringify({
      webhookUrl: cleanWebhook,
      payload: fullPayload,
    });
  } else {
    // Direct browser fetch
    targetUrl = cleanWebhook;
    requestBody = JSON.stringify(fullPayload);
  }

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
    // Differentiate between CORS failure on direct fetch and other network errors
    if (!useProxy && (err.name === 'TypeError' || String(err).includes('Failed to fetch'))) {
      throw new Error(
        'Browser CORS Rejection: Direct browser request to cloud n8n was blocked by browser security ' +
        '(cloud n8n does not return CORS headers for preflight OPTIONS requests). ' +
        'Please enable "Backend Proxy Mode" in Studio Configuration to route requests seamlessly through FastAPI.'
      );
    }
    throw new Error(
      `Network connection error reaching ${useProxy ? 'FastAPI proxy' : 'n8n webhook'} (${targetUrl}): ${err.message || 'Server unreachable'}. Check if the service or tunnel is online.`
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
 * Check health of backend service.
 */
export async function fetchHealth(baseUrl: string): Promise<BackendHealth> {
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
