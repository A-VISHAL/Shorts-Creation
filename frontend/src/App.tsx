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
} from 'lucide-react';
import {
  generateShort,
  fetchHealth,
  loadStoredConfig,
  saveStoredConfig,
  resetStoredConfig,
  isValidHttpUrl,
  normalizeUrl,
  ShortGeneratePayload,
  ShortGenerateResult,
  BackendHealth,
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
  const [modalFastApiUrl, setModalFastApiUrl] = useState(config.fastApiBaseUrl);
  const [modalUseProxy, setModalUseProxy] = useState(config.useProxy);
  const [showSettings, setShowSettings] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Form State
  const [videoUrl, setVideoUrl] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [quoteText, setQuoteText] = useState('Stop waiting and start building your future today.');
  const [title, setTitle] = useState('Build Your Future');
  const [duration, setDuration] = useState<number>(30);
  const [style, setStyle] = useState<'dark-motivational' | 'minimal-white' | 'bold-motivational'>(
    'dark-motivational'
  );

  // Workflow & Execution State
  const [loading, setLoading] = useState(false);
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ShortGenerateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Backend Health
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Check health on mount or when fastApiBaseUrl changes
  useEffect(() => {
    checkHealth(config.fastApiBaseUrl);
  }, [config.fastApiBaseUrl]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const checkHealth = async (baseUrl: string) => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const h = await fetchHealth(baseUrl);
      setHealth(h);
    } catch (err: any) {
      setHealth(null);
      setHealthError(err.message || 'Cannot connect to backend');
    } finally {
      setHealthLoading(false);
    }
  };

  const handleOpenSettings = () => {
    setModalWebhookUrl(config.webhookUrl);
    setModalFastApiUrl(config.fastApiBaseUrl);
    setModalUseProxy(config.useProxy);
    setConfigError(null);
    setShowSettings(true);
    checkHealth(config.fastApiBaseUrl);
  };

  const handleSaveSettings = () => {
    const cleanWebhook = normalizeUrl(modalWebhookUrl);
    const cleanFastApi = normalizeUrl(modalFastApiUrl);

    if (!isValidHttpUrl(cleanWebhook)) {
      setConfigError('n8n Webhook URL must be a valid HTTP or HTTPS address.');
      return;
    }
    if (!isValidHttpUrl(cleanFastApi)) {
      setConfigError('FastAPI Public Base URL must be a valid HTTP or HTTPS address.');
      return;
    }

    const newConfig: StudioConfig = {
      webhookUrl: cleanWebhook,
      fastApiBaseUrl: cleanFastApi,
      useProxy: modalUseProxy,
    };

    try {
      saveStoredConfig(newConfig);
      setConfig(newConfig);
      setShowSettings(false);
      showToast('Configuration saved persistently!');
      checkHealth(cleanFastApi);
    } catch (err: any) {
      setConfigError(err.message || 'Failed to save configuration');
    }
  };

  const handleResetSettings = () => {
    const reset = resetStoredConfig();
    setConfig(reset);
    setModalWebhookUrl(reset.webhookUrl);
    setModalFastApiUrl(reset.fastApiBaseUrl);
    setModalUseProxy(reset.useProxy);
    setConfigError(null);
    showToast('Configuration reset to defaults.');
    checkHealth(reset.fastApiBaseUrl);
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

    setLoading(true);
    setCurrentStageIdx(0);

    // Progress simulation while waiting for n8n + FFmpeg completion
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
      const data = await generateShort(
        payload,
        config.webhookUrl,
        config.fastApiBaseUrl,
        config.useProxy
      );
      clearInterval(stageInterval);
      setCurrentStageIdx(5); // Ready to preview & download
      setResult(data);
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
            {config.useProxy && (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  color: '#93c5fd',
                  background: 'rgba(59, 130, 246, 0.1)',
                  padding: '0.25rem 0.6rem',
                  borderRadius: '9999px',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                }}
                title="Requests are forwarded via FastAPI proxy to eliminate browser CORS preflight blocks."
              >
                <ShieldCheck size={14} color="#60a5fa" />
                <span>Proxy Active</span>
              </span>
            )}

            <button
              className="btn-icon"
              onClick={handleOpenSettings}
              title="Connection & Backend Settings"
            >
              <SettingsIcon size={16} />
              <span>Studio Config</span>
              {health?.status === 'healthy' ? (
                <span style={{ color: '#34d399', fontSize: '0.75rem' }}>● Backend Online</span>
              ) : (
                <span style={{ color: '#f87171', fontSize: '0.75rem' }}>● Backend Offline</span>
              )}
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
            Transform background footage and soundtracks into 1080 × 1920 vertical Shorts.
          </p>

          {/* Quick Presets Bar */}
          <div className="presets-bar">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Quick Presets:</span>
            {PRESETS.map((p, idx) => (
              <button
                key={idx}
                type="button"
                className="preset-chip"
                onClick={() => applyPreset(p)}
              >
                <Sparkles size={12} color="#ef4444" />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="studio-grid">
          {/* Left Column: Form Controls */}
          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">
                <Sliders size={20} color="#ef4444" />
                <span>Video Parameters</span>
              </h2>
              <span className="form-hint">Outputs 1080 × 1920 MP4</span>
            </div>

            {errorMessage && (
              <div className="alert-error">
                <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Generation Error:</strong>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem' }}>{errorMessage}</div>
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ffffff',
                      textDecoration: 'underline',
                      marginTop: '0.5rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'block',
                    }}
                    onClick={() => handleOpenSettings()}
                  >
                    Open Studio Configuration to verify webhook or tunnel URL →
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleGenerate}>
              {/* Background Video URL */}
              <div className="form-group">
                <label className="form-label" htmlFor="videoUrl">
                  <span>Background Video URL</span>
                  <span className="form-hint">YouTube or Direct MP4 link</span>
                </label>
                <div className="input-wrapper">
                  <Video className="input-icon" size={18} />
                  <input
                    id="videoUrl"
                    type="url"
                    className="form-input"
                    placeholder="https://www.youtube.com/watch?v=... or .mp4 link"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Soundtrack URL */}
              <div className="form-group">
                <label className="form-label" htmlFor="musicUrl">
                  <span>Background Music / Audio URL</span>
                  <span className="form-hint">MP3, audio stream, or YouTube</span>
                </label>
                <div className="input-wrapper">
                  <Music className="input-icon" size={18} />
                  <input
                    id="musicUrl"
                    type="url"
                    className="form-input"
                    placeholder="https://example.com/soundtrack.mp3"
                    value={musicUrl}
                    onChange={(e) => setMusicUrl(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Title Input */}
              <div className="form-group">
                <label className="form-label" htmlFor="title">
                  <span>Short Title</span>
                  <span className="form-hint">Used in metadata and safe filenames</span>
                </label>
                <input
                  id="title"
                  type="text"
                  className="form-input no-icon"
                  placeholder="e.g. Build Your Future"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              {/* Motivational Quote Textarea */}
              <div className="form-group">
                <label className="form-label" htmlFor="quoteText">
                  <span>Motivational Text / Overlay Quote</span>
                  <span className="form-hint">{quoteText.length} / 500 characters</span>
                </label>
                <textarea
                  id="quoteText"
                  className="form-textarea"
                  rows={3}
                  placeholder="Enter your inspiring quote here. Sentences will wrap automatically across lines."
                  value={quoteText}
                  onChange={(e) => setQuoteText(e.target.value)}
                  maxLength={500}
                  required
                />
              </div>

              {/* Duration Selector */}
              <div className="form-group">
                <label className="form-label">
                  <span>Target Duration</span>
                  <span className="form-hint">Precisely looped or trimmed</span>
                </label>
                <div className="pill-group">
                  {[15, 30, 45, 60].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      className={`pill-btn ${duration === sec ? 'active' : ''}`}
                      onClick={() => setDuration(sec)}
                    >
                      {sec} Seconds
                    </button>
                  ))}
                </div>
              </div>

              {/* Visual Style Selector */}
              <div className="form-group">
                <label className="form-label">
                  <span>Visual Style Preset</span>
                  <span className="form-hint">Overlay tint, typography, & shadow</span>
                </label>
                <div className="style-grid">
                  <div
                    className={`style-card ${style === 'dark-motivational' ? 'active' : ''}`}
                    onClick={() => setStyle('dark-motivational')}
                  >
                    <div
                      className="style-preview-box"
                      style={{ background: '#0f172a', color: '#ffffff', border: '1px solid #334155' }}
                    >
                      DARK CINEMATIC
                    </div>
                    <span className="style-title">Dark Cinematic</span>
                    <span className="style-desc">Vignette, bold white text, heavy drop shadow</span>
                  </div>

                  <div
                    className={`style-card ${style === 'minimal-white' ? 'active' : ''}`}
                    onClick={() => setStyle('minimal-white')}
                  >
                    <div
                      className="style-preview-box"
                      style={{ background: '#1e293b', color: '#f8fafc', border: '1px solid #475569' }}
                    >
                      MINIMAL WHITE
                    </div>
                    <span className="style-title">Minimal White</span>
                    <span className="style-desc">Clean typography, subtle outline, light tint</span>
                  </div>

                  <div
                    className={`style-card ${style === 'bold-motivational' ? 'active' : ''}`}
                    onClick={() => setStyle('bold-motivational')}
                  >
                    <div
                      className="style-preview-box"
                      style={{ background: '#18181b', color: '#f59e0b', border: '1px solid #713f12' }}
                    >
                      BOLD GOLD
                    </div>
                    <span className="style-title">Bold Motivational</span>
                    <span className="style-desc">High contrast, power gold accent & outline</span>
                  </div>
                </div>
              </div>

              {/* Specifications Badges */}
              <div className="spec-badges">
                <div className="spec-badge-item">
                  <Layers size={14} color="#ef4444" />
                  <span>Ratio: 9:16 Vertical</span>
                </div>
                <span>•</span>
                <div className="spec-badge-item">
                  <Clock size={14} color="#3b82f6" />
                  <span>Res: 1080 × 1920</span>
                </div>
                <span>•</span>
                <div className="spec-badge-item">
                  <CheckCircle2 size={14} color="#10b981" />
                  <span>Codec: H.264 + AAC</span>
                </div>
              </div>

              {/* Progress Stage Tracker */}
              {loading && (
                <div className="progress-card">
                  <div className="progress-header">
                    <span className="progress-title">
                      <div className="spinner" />
                      <span>{STAGES[currentStageIdx]}...</span>
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Step {currentStageIdx + 1} of 6
                    </span>
                  </div>
                  <div className="stage-list">
                    {STAGES.map((s, idx) => {
                      const isActive = idx === currentStageIdx;
                      const isDone = idx < currentStageIdx;
                      return (
                        <div
                          key={s}
                          className={`stage-item ${isActive ? 'active' : ''} ${
                            isDone ? 'completed' : ''
                          }`}
                        >
                          <div className="stage-dot" />
                          <span>{s}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <RefreshCw className="spinner" size={20} />
                    <span>Rendering Motivational Short...</span>
                  </>
                ) : (
                  <>
                    <Play size={20} />
                    <span>Generate Video</span>
                  </>
                )}
              </button>
            </form>
          </section>

          {/* Right Column: 9:16 Shorts Video Preview */}
          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">
                <Video size={20} color="#ef4444" />
                <span>Shorts Preview</span>
              </h2>
              {result && (
                <span style={{ color: '#34d399', fontSize: '0.8rem', fontWeight: 600 }}>
                  ✓ Ready for YouTube
                </span>
              )}
            </div>

            <div className="preview-container">
              {/* 9:16 Phone Frame Mockup */}
              <div className="phone-mockup">
                <div className="phone-notch" />

                {result ? (
                  <video
                    key={result.videoUrl}
                    className="shorts-video-player"
                    controls
                    autoPlay
                    loop
                    playsInline
                    src={result.videoUrl}
                  />
                ) : (
                  <div className="empty-preview-state">
                    <div className="empty-preview-icon">
                      <Play size={28} />
                    </div>
                    <h3 className="empty-preview-title">Ready to Render</h3>
                    <p className="empty-preview-text">
                      Configure your video source, soundtrack, and inspirational quote, then click Generate Video.
                    </p>
                  </div>
                )}
              </div>

              {/* Preview Actions */}
              {result && (
                <div className="preview-actions">
                  <a
                    href={result.downloadUrl || result.videoUrl}
                    className="btn-download"
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download size={18} />
                    <span>Download MP4</span>
                  </a>

                  <div className="action-row">
                    <button type="button" className="btn-secondary" onClick={handleCopyUrl}>
                      {copied ? <Check size={16} color="#34d399" /> : <Copy size={16} />}
                      <span>{copied ? 'Copied URL!' : 'Copy Video URL'}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setResult(null);
                        setErrorMessage(null);
                      }}
                    >
                      <RefreshCw size={16} />
                      <span>New Short</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="panel-title">
                <SettingsIcon size={18} color="#ef4444" />
                <span>Studio Configuration</span>
              </h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowSettings(false)}
              >
                ✕
              </button>
            </div>

            {configError && (
              <div className="alert-error" style={{ marginBottom: '1rem' }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{configError}</span>
              </div>
            )}

            {/* Field 1: n8n Webhook URL */}
            <div className="form-group">
              <label className="form-label" htmlFor="modalWebhook">
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Workflow size={15} color="#ef4444" />
                  <strong>n8n Webhook URL</strong>
                </span>
                <span className="form-hint">Cloud or local orchestrator</span>
              </label>
              <input
                id="modalWebhook"
                type="url"
                className="form-input no-icon"
                value={modalWebhookUrl}
                onChange={(e) => setModalWebhookUrl(e.target.value)}
                placeholder="https://your-instance.app.n8n.cloud/webhook/..."
              />
              <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
                  onClick={() => setModalWebhookUrl(DEFAULT_CONFIG.webhookUrl)}
                >
                  Cloud Production Webhook
                </button>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#93c5fd',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                  onClick={() =>
                    setModalWebhookUrl(
                      'https://lukizerk3.app.n8n.cloud/webhook-test/generate-motivational-short'
                    )
                  }
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
                  onClick={() =>
                    setModalWebhookUrl('http://localhost:5678/webhook/generate-motivational-short')
                  }
                >
                  Local n8n Webhook
                </button>
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                <strong>Purpose:</strong> Receives your generation payload, validates inputs, and coordinates the video download & render pipeline.
              </p>
            </div>

            {/* Field 2: FastAPI Public Base URL */}
            <div className="form-group">
              <label className="form-label" htmlFor="modalFastApi">
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Server size={15} color="#3b82f6" />
                  <strong>FastAPI Public Base URL</strong>
                </span>
                <span className="form-hint">Cloudflare Tunnel URL</span>
              </label>
              <input
                id="modalFastApi"
                type="url"
                className="form-input no-icon"
                value={modalFastApiUrl}
                onChange={(e) => setModalFastApiUrl(e.target.value)}
                placeholder="https://your-tunnel.trycloudflare.com or http://localhost:8000"
              />
              <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#38bdf8',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                  onClick={() =>
                    setModalFastApiUrl('https://disclose-oil-half-spending.trycloudflare.com')
                  }
                >
                  Set to Quick Tunnel
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
                  onClick={() => setModalFastApiUrl('http://localhost:8000')}
                >
                  Set to Localhost (8000)
                </button>
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                <strong>Purpose:</strong> Where cloud n8n reaches your local rendering server. When using Quick Tunnel, paste your active <code>trycloudflare.com</code> URL here.
              </p>
            </div>

            {/* Field 3: Execution Mode (Backend Proxy vs Direct) */}
            <div
              style={{
                background: 'var(--bg-surface-elevated)',
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                marginBottom: '1.25rem',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                <input
                  type="checkbox"
                  checked={modalUseProxy}
                  onChange={(e) => setModalUseProxy(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ef4444' }}
                />
                <span>Enable Backend Proxy Mode (Solves Browser CORS)</span>
              </label>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem', marginLeft: '1.75rem' }}>
                Routes webhook calls through your local FastAPI backend first, bypassing browser CORS preflight blocks. Highly recommended for cloud n8n.
              </p>
            </div>

            {/* Backend Health Check Box */}
            <div
              style={{
                background: 'var(--bg-surface-elevated)',
                padding: '1rem',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.5rem',
                }}
              >
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Backend Connection Status</span>
                <button
                  type="button"
                  onClick={() => checkHealth(modalFastApiUrl)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#93c5fd',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                  disabled={healthLoading}
                >
                  <RefreshCw size={12} className={healthLoading ? 'spinner' : ''} />
                  <span>Refresh</span>
                </button>
              </div>

              {health ? (
                <div>
                  <span className="health-status-badge ok">✓ Backend Online & Ready ({health.version})</span>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    FFmpeg: {health.dependencies.ffmpeg ? '✓ Installed' : '✗ Missing'} • FFprobe:{' '}
                    {health.dependencies.ffprobe ? '✓ Installed' : '✗ Missing'} • Free Disk:{' '}
                    {health.storage?.freeSpaceMb ? `${Math.round(health.storage.freeSpaceMb / 1024)} GB` : 'OK'}
                  </div>
                  {health.config?.detectedPublicBaseUrl && (
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                      Detected Base: <code>{health.config.detectedPublicBaseUrl}</code>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <span className="health-status-badge error">
                    ✗ Backend Offline: {healthError || 'Connecting...'}
                  </span>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    Ensure FastAPI is running on port 8000 and your Cloudflare Tunnel is running.
                  </p>
                </div>
              )}
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
