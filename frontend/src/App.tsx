import React, { useState, useEffect } from 'react';
import {
  Play,
  Download,
  Copy,
  RefreshCw,
  Video,
  Music,
  Sparkles,
  Settings as SettingsIcon,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  Sliders,
  Check,
  ShieldCheck,
  Server,
  Workflow,
  ExternalLink,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  generateShort,
  fetchHealth,
  fetchConnectionStatus,
  retryTunnelConnection,
  verifyWebhook,
  loadStoredConfig,
  saveStoredConfig,
  resetStoredConfig,
  isValidHttpUrl,
  normalizeUrl,
  ShortGeneratePayload,
  ShortGenerateResult,
  BackendHealth,
  ConnectionStatus,
  StudioConfig,
  DEFAULT_CONFIG,
} from './api';

const STAGES = [
  'Validating inputs & parameters',
  'Downloading source video (yt-dlp)',
  'Downloading soundtrack (audio extraction)',
  'Rendering Short (FFmpeg 9:16 Canvas)',
  'Verifying MP4 stream integrity',
  'Ready to preview & download',
];

interface Preset {
  name: string;
  videoUrl: string;
  musicUrl: string;
  quote: string;
  title: string;
  style: 'dark-motivational' | 'minimal-white' | 'bold-motivational';
}

const PRESETS: Preset[] = [
  {
    name: 'Mountain Peak',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    musicUrl: 'https://actions.google.com/sounds/v1/ambient/ambient_hum.ogg',
    quote: 'The secret of getting ahead is getting started. Break your complex tasks into small manageable steps.',
    title: 'Rise Above Limits',
    style: 'dark-motivational',
  },
  {
    name: 'City Lights',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    musicUrl: 'https://actions.google.com/sounds/v1/science_fiction/scifi_hum.ogg',
    quote: 'Do not wait for extraordinary circumstances to do good action; use ordinary situations.',
    title: 'Build Daily Habits',
    style: 'bold-motivational',
  },
  {
    name: 'Cosmic Ocean',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    musicUrl: 'https://actions.google.com/sounds/v1/weather/wind_breeze.ogg',
    quote: 'Your mind is a weapon. Keep it loaded with knowledge and sharp with discipline.',
    title: 'Stay Focused',
    style: 'minimal-white',
  },
];

export function App() {
  // Configuration State (persistent via localStorage)
  const [config, setConfig] = useState<StudioConfig>(loadStoredConfig);
  const [modalWebhookUrl, setModalWebhookUrl] = useState(config.webhookUrl);
  const [showSettings, setShowSettings] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Connection Manager & Tunnel State
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [retryingTunnel, setRetryingTunnel] = useState(false);
  const [copiedTunnel, setCopiedTunnel] = useState(false);
  const [verifyingWebhook, setVerifyingWebhook] = useState(false);
  const [webhookVerifyResult, setWebhookVerifyResult] = useState<{ success: boolean; message: string } | null>(null);

  // Form State
  const [videoUrl, setVideoUrl] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [quoteText, setQuoteText] = useState('Stop waiting and start building your future today.');
  const [title, setTitle] = useState('Build Your Future');
  const [duration, setDuration] = useState<number>(30);
  const [style, setStyle] = useState<'dark-motivational' | 'minimal-white' | 'bold-motivational'>('dark-motivational');

  // Workflow & Execution State
  const [loading, setLoading] = useState(false);
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ShortGenerateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Backend Health
  const [health, setHealth] = useState<BackendHealth | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const updateStatus = async () => {
    try {
      const status = await fetchConnectionStatus();
      setConnectionStatus(status);
      if (status.backend.status === 'online') {
        const h = await fetchHealth();
        setHealth(h);
      } else {
        setHealth(null);
      }
    } catch {
      // Ignored
    }
  };

  // Poll connection status on mount and periodically
  useEffect(() => {
    updateStatus();
    const interval = setInterval(updateStatus, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenSettings = () => {
    setModalWebhookUrl(config.webhookUrl);
    setConfigError(null);
    setWebhookVerifyResult(null);
    setShowSettings(true);
    updateStatus();
  };

  const handleSaveSettings = () => {
    const cleanWebhook = normalizeUrl(modalWebhookUrl);
    if (!isValidHttpUrl(cleanWebhook)) {
      setConfigError('n8n Webhook URL must be a valid HTTP or HTTPS address.');
      return;
    }
    const newConfig: StudioConfig = {
      ...config,
      webhookUrl: cleanWebhook,
    };
    try {
      saveStoredConfig(newConfig);
      setConfig(newConfig);
      setShowSettings(false);
      showToast('Configuration saved successfully!');
    } catch (err: any) {
      setConfigError(err.message || 'Failed to save configuration');
    }
  };

  const handleResetSettings = () => {
    const reset = resetStoredConfig();
    setConfig(reset);
    setModalWebhookUrl(reset.webhookUrl);
    setConfigError(null);
    setWebhookVerifyResult(null);
    showToast('Configuration reset to defaults.');
  };

  const handleRetryConnection = async () => {
    setRetryingTunnel(true);
    try {
      const updated = await retryTunnelConnection();
      setConnectionStatus(updated);
      showToast('Cloudflare tunnel reconnection triggered!');
    } catch (err: any) {
      showToast(`Tunnel retry: ${err.message || 'Reconnecting...'}`);
    } finally {
      setRetryingTunnel(false);
      updateStatus();
    }
  };

  const handleVerifyWebhook = async () => {
    if (!modalWebhookUrl.trim()) return;
    setVerifyingWebhook(true);
    setWebhookVerifyResult(null);
    try {
      const res = await verifyWebhook(modalWebhookUrl);
      setWebhookVerifyResult({ success: res.success, message: res.message });
    } catch (err: any) {
      setWebhookVerifyResult({ success: false, message: err.message || 'Verification failed.' });
    } finally {
      setVerifyingWebhook(false);
    }
  };

  const handleCopyTunnelUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedTunnel(true);
    setTimeout(() => setCopiedTunnel(false), 2000);
    showToast('Tunnel URL copied to clipboard!');
  };

  const formatLastCheck = (isoDate: string | null | undefined) => {
    if (!isoDate) return 'Pending initial verification';
    try {
      const d = new Date(isoDate);
      return d.toLocaleTimeString();
    } catch {
      return 'Recently';
    }
  };

  const applyPreset = (preset: Preset) => {
    setVideoUrl(preset.videoUrl);
    setMusicUrl(preset.musicUrl);
    setQuoteText(preset.quote);
    setTitle(preset.title);
    setStyle(preset.style);
    setErrorMessage(null);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setResult(null);

    // Validation
    if (!videoUrl.trim() || !isValidHttpUrl(videoUrl.trim())) {
      setErrorMessage('Please provide a valid YouTube or direct video URL (http:// or https://).');
      return;
    }
    if (!musicUrl.trim() || !isValidHttpUrl(musicUrl.trim())) {
      setErrorMessage('Please provide a valid music or audio URL (http:// or https://).');
      return;
    }
    if (!quoteText.trim() || quoteText.trim().length < 3) {
      setErrorMessage('Motivational text must be at least 3 characters long.');
      return;
    }

    setErrorMessage(null);
    setResult(null);
    setLoading(true);
    setCurrentStageIdx(0);

    const stageInterval = setInterval(() => {
      setCurrentStageIdx((prev) => (prev < 4 ? prev + 1 : prev));
    }, 4500);

    const payload: ShortGeneratePayload = {
      videoUrl: videoUrl.trim(),
      musicUrl: musicUrl.trim(),
      text: quoteText.trim(),
      title: title.trim() || 'Motivational Short',
      durationSeconds: duration,
      width: 1080,
      height: 1920,
      style: style,
    };

    try {
      const data = await generateShort(payload, config.webhookUrl);
      clearInterval(stageInterval);
      if (data && data.success) {
        setCurrentStageIdx(5); // Ready to preview & download
        setResult(data);
      } else {
        setErrorMessage(data?.error?.message || 'Video generation failed. Please check webhook settings.');
      }
    } catch (err: any) {
      clearInterval(stageInterval);
      setErrorMessage(err.message || 'Video generation failed. Please review the error details.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyUrl = () => {
    if (result?.videoUrl) {
      navigator.clipboard.writeText(result.videoUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      showToast('Video URL copied to clipboard!');
    }
  };

  const isBackendOk = connectionStatus?.backend.status === 'online';
  const isTunnelOk = connectionStatus?.tunnel.status === 'connected';

  return (
    <div>
      {/* Header */}
      <header className="header">
        <div className="header-container">
          <div className="brand">
            <div className="brand-icon">
              <Sparkles size={20} color="#ffffff" />
            </div>
            <div>
              <span className="brand-title">Motivational Shorts Studio</span>
            </div>
            <span className="brand-badge">9:16 Shorts</span>
          </div>

          <div className="header-actions">
            {/* Live Connection Pill */}
            <div
              className={`connection-pill ${isBackendOk && isTunnelOk ? 'ok' : isBackendOk ? 'warn' : 'err'}`}
              onClick={handleOpenSettings}
              title="Click to view connection details"
            >
              {isBackendOk && isTunnelOk ? (
                <>
                  <Wifi size={13} />
                  <span>Tunnel Online</span>
                </>
              ) : isBackendOk ? (
                <>
                  <RefreshCw size={13} className="spinner" />
                  <span>Connecting Tunnel...</span>
                </>
              ) : (
                <>
                  <WifiOff size={13} />
                  <span>Backend Offline</span>
                </>
              )}
            </div>

            {/* Studio Config Button */}
            <button
              className="btn-icon"
              onClick={handleOpenSettings}
              title="Studio Connection & Configuration"
            >
              <SettingsIcon size={16} />
              <span>Studio Config</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="main-container">
        <div className="hero-section">
          <h1 className="hero-title">Create Inspiring YouTube Shorts in Seconds</h1>
          <p className="hero-subtitle">
            Orchestrated with <strong>FastAPI</strong>, <strong>FFmpeg</strong>, and <strong>Cloud n8n</strong>.
            Transform background footage and soundtracks into 1080 × 1920 vertical Shorts with dynamic overlays.
          </p>
        </div>

        {/* Preset Selector */}
        <div className="card preset-section">
          <div className="preset-header">
            <Sparkles size={16} color="#ef4444" />
            <span className="preset-title">Quick Start Presets</span>
          </div>
          <div className="preset-grid">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="preset-btn"
                onClick={() => applyPreset(p)}
                disabled={loading}
              >
                <strong>{p.name}</strong>
                <span>{p.quote.slice(0, 50)}...</span>
              </button>
            ))}
          </div>
        </div>

        {/* Studio Workspace */}
        <div className="workspace-grid">
          {/* Form Side */}
          <div className="card">
            <h2 className="card-title">
              <Sliders size={18} color="#ef4444" />
              <span>Short Parameters</span>
            </h2>

            <form onSubmit={handleGenerate}>
              {/* Video URL */}
              <div className="form-group">
                <label className="form-label" htmlFor="videoUrl">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Video size={14} color="#f87171" />
                    <strong>Background Video URL</strong>
                  </span>
                  <span className="form-hint">YouTube or Direct MP4</span>
                </label>
                <input
                  id="videoUrl"
                  type="url"
                  className="form-input no-icon"
                  placeholder="https://www.youtube.com/watch?v=... or http://localhost:8000/media/..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              {/* Music URL */}
              <div className="form-group">
                <label className="form-label" htmlFor="musicUrl">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Music size={14} color="#f59e0b" />
                    <strong>Soundtrack URL</strong>
                  </span>
                  <span className="form-hint">Direct MP3 / Audio Stream</span>
                </label>
                <input
                  id="musicUrl"
                  type="url"
                  className="form-input no-icon"
                  placeholder="https://actions.google.com/sounds/v1/ambient/ambient_hum.ogg or http://localhost:8000/media/..."
                  value={musicUrl}
                  onChange={(e) => setMusicUrl(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              {/* Motivational Quote */}
              <div className="form-group">
                <label className="form-label" htmlFor="quoteText">
                  <strong>Motivational Quote / Speech</strong>
                  <span className="form-hint">Centered typography overlay</span>
                </label>
                <textarea
                  id="quoteText"
                  className="form-textarea"
                  rows={3}
                  placeholder="Enter the motivational message displayed dynamically on the canvas..."
                  value={quoteText}
                  onChange={(e) => setQuoteText(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              {/* Title & Duration Grid */}
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="title">
                    <strong>Short Title</strong>
                  </label>
                  <input
                    id="title"
                    type="text"
                    className="form-input no-icon"
                    placeholder="Short Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="duration">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Clock size={14} color="#3b82f6" />
                      <strong>Duration: {duration}s</strong>
                    </span>
                  </label>
                  <input
                    id="duration"
                    type="range"
                    min="10"
                    max="60"
                    step="5"
                    className="form-range"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    disabled={loading}
                  />
                  <div className="range-marks">
                    <span>10s</span>
                    <span>30s</span>
                    <span>60s</span>
                  </div>
                </div>
              </div>

              {/* Style Presets */}
              <div className="form-group">
                <label className="form-label">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Layers size={14} color="#a855f7" />
                    <strong>Visual Typography Style</strong>
                  </span>
                </label>
                <div className="style-grid">
                  <div
                    className={`style-option ${style === 'dark-motivational' ? 'selected' : ''}`}
                    onClick={() => setStyle('dark-motivational')}
                  >
                    <div className="style-name">Cinematic Dark</div>
                    <div className="style-desc">Gold bold highlights, heavy backdrop vignette</div>
                  </div>
                  <div
                    className={`style-option ${style === 'minimal-white' ? 'selected' : ''}`}
                    onClick={() => setStyle('minimal-white')}
                  >
                    <div className="style-name">Clean Minimalist</div>
                    <div className="style-desc">Sharp white typography with clean black outline</div>
                  </div>
                  <div
                    className={`style-option ${style === 'bold-motivational' ? 'selected' : ''}`}
                    onClick={() => setStyle('bold-motivational')}
                  >
                    <div className="style-name">High Impact</div>
                    <div className="style-desc">Vibrant red accent title and bold text cards</div>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <RefreshCw size={18} className="spinner" />
                    <span>Rendering Short ({duration}s)...</span>
                  </>
                ) : (
                  <>
                    <Play size={18} fill="currentColor" />
                    <span>Generate Motivational Short</span>
                  </>
                )}
              </button>

              {/* Error Banner */}
              {errorMessage && (
                <div className="error-banner">
                  <AlertCircle size={20} color="#f87171" style={{ flexShrink: 0 }} />
                  <div>
                    <strong>Pipeline Execution Failed</strong>
                    <p style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem', fontSize: '0.8rem' }}>
                      {errorMessage}
                    </p>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Preview / Results Side */}
          <div className="card">
            <h2 className="card-title">
              <Play size={18} color="#ef4444" />
              <span>9:16 Shorts Canvas Preview</span>
            </h2>

            {/* Workflow Progress Tracker */}
            {loading && (
              <div className="progress-container">
                <div className="progress-header">
                  <span className="progress-title">Pipeline Stage: {currentStageIdx + 1} of 6</span>
                  <span className="progress-pct">{Math.round(((currentStageIdx + 1) / 6) * 100)}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${((currentStageIdx + 1) / 6) * 100}%` }}
                  />
                </div>
                <ul className="stage-list">
                  {STAGES.map((s, idx) => (
                    <li
                      key={s}
                      className={`stage-item ${idx < currentStageIdx ? 'completed' : idx === currentStageIdx ? 'active' : ''}`}
                    >
                      {idx < currentStageIdx ? (
                        <CheckCircle2 size={15} color="#34d399" />
                      ) : idx === currentStageIdx ? (
                        <RefreshCw size={15} className="spinner" color="#60a5fa" />
                      ) : (
                        <div className="stage-dot" />
                      )}
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Vertical Video Mockup */}
            <div className="mockup-wrapper">
              <div className="phone-bezel">
                {result?.videoUrl ? (
                  <video
                    src={result.videoUrl}
                    controls
                    autoPlay
                    playsInline
                    className="phone-video"
                  />
                ) : (
                  <div className="phone-placeholder">
                    <div className="phone-inner-text">
                      <Sparkles size={32} color="#64748b" style={{ margin: '0 auto 1rem auto' }} />
                      <p style={{ fontWeight: 600, color: '#94a3b8' }}>1080 × 1920 Vertical Canvas</p>
                      <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: '#64748b' }}>
                        Rendered Short with subtitles & music will appear here.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Success Actions */}
            {result?.success && Boolean(result.videoUrl || result.downloadUrl) && (
              <div className="result-actions">
                <div className="result-meta">
                  <CheckCircle2 size={18} color="#34d399" />
                  <span>
                    Render Complete: <strong>{result.title || title || 'Motivational Short'}</strong> ({result.durationSeconds || duration || 30}s, 1080×1920 MP4)
                  </span>
                </div>

                <div className="result-btn-row">
                  <a
                    href={result.downloadUrl || result.videoUrl || '#'}
                    download={`${(result.title || title || 'Motivational_Short').replace(/\s+/g, '_')}.mp4`}
                    className="btn-download"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download size={16} />
                    <span>Download MP4</span>
                  </a>

                  <button type="button" className="btn-copy" onClick={handleCopyUrl}>
                    {copied ? <Check size={16} color="#34d399" /> : <Copy size={16} />}
                    <span>{copied ? 'Copied' : 'Copy Public URL'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Studio Configuration Modal */}
      {showSettings && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <SettingsIcon size={20} color="#ef4444" />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Studio Connection & Configuration</h3>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowSettings(false)}
              >
                ✕
              </button>
            </div>

            {configError && (
              <div className="error-banner" style={{ marginBottom: '1rem' }}>
                <AlertCircle size={16} color="#f87171" />
                <span>{configError}</span>
              </div>
            )}

            {/* Section 1: Backend Connection Status (Redesigned) */}
            <div className="connection-card">
              <div className="connection-header">
                <div className="connection-title-row">
                  <Server size={18} color="#38bdf8" />
                  <div>
                    <strong style={{ fontSize: '0.9rem' }}>Backend Connection & Cloudflare Tunnel</strong>
                    <div className="connection-subtitle">
                      Self-managed local FastAPI backend & public quick tunnel for cloud n8n
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-retry"
                  onClick={handleRetryConnection}
                  disabled={retryingTunnel}
                >
                  <RefreshCw size={12} className={retryingTunnel ? 'spinner' : ''} />
                  <span>{retryingTunnel ? 'Reconnecting...' : 'Retry Connection'}</span>
                </button>
              </div>

              {/* Status Grid */}
              <div className="status-grid">
                {/* FastAPI Backend */}
                <div className="status-box">
                  <div className="status-label">FastAPI Backend</div>
                  <div>
                    {connectionStatus?.backend.status === 'online' ? (
                      <span className="badge badge-ok">
                        <Check size={12} /> Online (Port 8000)
                      </span>
                    ) : connectionStatus?.backend.status === 'starting' ? (
                      <span className="badge badge-warn">
                        <RefreshCw size={12} className="spinner" /> Starting...
                      </span>
                    ) : (
                      <span className="badge badge-err">
                        <AlertCircle size={12} /> Offline
                      </span>
                    )}
                    {health && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                        v{health.version} • FFmpeg {health.dependencies.ffmpeg ? '✓' : '✗'} • yt-dlp {health.dependencies.yt_dlp ? '✓' : '✗'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Cloudflare Tunnel */}
                <div className="status-box">
                  <div className="status-label">Cloudflare Quick Tunnel</div>
                  <div>
                    {connectionStatus?.tunnel.status === 'connected' ? (
                      <span className="badge badge-ok">
                        <Check size={12} /> Connected
                      </span>
                    ) : connectionStatus?.tunnel.status === 'connecting' ? (
                      <span className="badge badge-warn">
                        <RefreshCw size={12} className="spinner" /> Connecting...
                      </span>
                    ) : (
                      <span className="badge badge-err">
                        <AlertCircle size={12} /> Disconnected
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Active Tunnel URL (Read-only + Copy Action) */}
              {connectionStatus?.tunnel.url && (
                <div className="tunnel-url-box">
                  <div className="tunnel-url-label">
                    <span>Active Public Tunnel URL (Auto-forwarded to n8n)</span>
                    {copiedTunnel && (
                      <span style={{ color: '#34d399', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                        <Check size={12} /> Copied!
                      </span>
                    )}
                  </div>
                  <div className="tunnel-url-row">
                    <input
                      type="text"
                      readOnly
                      className="tunnel-url-input"
                      value={connectionStatus.tunnel.url}
                    />
                    <button
                      type="button"
                      className="btn-copy-sm"
                      onClick={() => handleCopyTunnelUrl(connectionStatus.tunnel.url!)}
                      title="Copy Public Tunnel URL"
                    >
                      <Copy size={13} />
                      <span>Copy</span>
                    </button>
                    <a
                      href={connectionStatus.tunnel.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-open-sm"
                      title="Open tunnel URL in new tab"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
              )}

              {/* Tunnel Metadata & Status */}
              <div className="tunnel-meta">
                <span>
                  <strong>Last Health Check:</strong> {formatLastCheck(connectionStatus?.tunnel.lastHealthCheck)}
                </span>
                <span>•</span>
                <span>
                  <strong>Auto-Reconnect:</strong> Active
                </span>
                {connectionStatus?.tunnel.reconnectAttempts ? (
                  <>
                    <span>•</span>
                    <span>Retries: {connectionStatus.tunnel.reconnectAttempts}</span>
                  </>
                ) : null}
              </div>

              {/* Warning if cloudflared binary is not detected */}
              {connectionStatus && !connectionStatus.tunnel.cloudflaredInstalled && (
                <div className="alert-box-warning">
                  <AlertCircle size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong>'cloudflared' command not found on your system.</strong>
                    <p style={{ marginTop: '0.25rem' }}>
                      To allow cloud n8n to call back into your local render backend, install cloudflared:
                    </p>
                    <code>{connectionStatus.tunnel.installInfo?.command || 'sudo curl -L ...'}</code>
                  </div>
                </div>
              )}

              {/* Automatic Proxy Notice */}
              <div className="proxy-notice">
                <ShieldCheck size={14} color="#34d399" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Backend Proxy Mode:</strong> Automatically active. Webhook calls route through local FastAPI to bypass browser CORS and forward the public tunnel URL automatically.
                </span>
              </div>
            </div>

            {/* Section 2: n8n Workflow Webhooks */}
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label className="form-label" htmlFor="modalWebhook" style={{ marginBottom: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Workflow size={15} color="#ef4444" />
                    <strong>n8n Webhook Endpoint</strong>
                  </span>
                </label>
                <button
                  type="button"
                  className="btn-verify-webhook"
                  onClick={handleVerifyWebhook}
                  disabled={verifyingWebhook || !modalWebhookUrl.trim()}
                >
                  <RefreshCw size={12} className={verifyingWebhook ? 'spinner' : ''} />
                  <span>{verifyingWebhook ? 'Testing...' : 'Verify Webhook'}</span>
                </button>
              </div>

              <input
                id="modalWebhook"
                type="url"
                className="form-input no-icon"
                value={modalWebhookUrl}
                onChange={(e) => {
                  setModalWebhookUrl(e.target.value);
                  setWebhookVerifyResult(null);
                }}
                placeholder="https://your-n8n-instance.app.n8n.cloud/webhook/generate-motivational-short"
                required
              />

              {/* Quick Preset Buttons */}
              <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#f87171',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                  onClick={() => {
                    setModalWebhookUrl(config.productionWebhookUrl || DEFAULT_CONFIG.productionWebhookUrl);
                    setWebhookVerifyResult(null);
                  }}
                >
                  Cloud Production Webhook
                </button>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#60a5fa',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                  onClick={() => {
                    setModalWebhookUrl(config.testWebhookUrl || DEFAULT_CONFIG.testWebhookUrl);
                    setWebhookVerifyResult(null);
                  }}
                >
                  Cloud Test Webhook
                </button>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#cbd5e1',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                  onClick={() => {
                    setModalWebhookUrl('http://localhost:5678/webhook/generate-motivational-short');
                    setWebhookVerifyResult(null);
                  }}
                >
                  Local n8n Webhook
                </button>
              </div>

              {/* Verification Result Feedback */}
              {webhookVerifyResult && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    background: webhookVerifyResult.success ? 'rgba(52, 211, 153, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    border: webhookVerifyResult.success ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                    color: webhookVerifyResult.success ? '#34d399' : '#f87171',
                  }}
                >
                  {webhookVerifyResult.success ? <Check size={14} /> : <AlertCircle size={14} />}
                  <span>{webhookVerifyResult.message}</span>
                </div>
              )}

              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                <strong>Workflow Node:</strong> Receives your generation payload and triggers the n8n orchestrator pipeline.
              </p>
            </div>

            {/* Modal Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveSettings}
              >
                Save & Close
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ width: 'auto', whiteSpace: 'nowrap' }}
                onClick={handleResetSettings}
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Toast */}
      {toastMessage && (
        <div className="toast-msg">
          <CheckCircle2 size={16} color="#34d399" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
export default App;
