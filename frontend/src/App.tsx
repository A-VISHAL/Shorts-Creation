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
  X,
  Zap,
  Film,
  Type,
  FileText,
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
  badge: string;
  videoUrl: string;
  musicUrl: string;
  quote: string;
  title: string;
  style: 'dark-motivational' | 'minimal-white' | 'bold-motivational';
}

const PRESETS: Preset[] = [
  {
    name: 'Instant Studio Demo',
    badge: 'Offline / Instant',
    videoUrl: 'http://localhost:8000/media/dl_video_7a92c74aa4.mp4',
    musicUrl: 'http://localhost:8000/media/test_source_aud.mp3',
    quote: 'Stop waiting and start building your future today.',
    title: 'Build Your Future',
    style: 'dark-motivational',
  },
  {
    name: 'YouTube Shorts Demo',
    badge: 'yt-dlp Pipeline',
    videoUrl: 'https://youtube.com/shorts/Ke6kzNR3NnU',
    musicUrl: 'http://localhost:8000/media/test_source_aud.mp3',
    quote: 'The secret of getting ahead is getting started. Break your goals into daily steps.',
    title: 'Rise Above Limits',
    style: 'bold-motivational',
  },
  {
    name: 'Clean Minimalist',
    badge: 'Ambient Canvas',
    videoUrl: 'http://localhost:8000/media/test_source_vid.mp4',
    musicUrl: 'http://localhost:8000/media/test_source_aud.mp3',
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
    if (!isoDate) return 'Pending verification';
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
    showToast(`Loaded "${preset.name}" preset`);
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
        showToast('Short rendered successfully!');
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
    <div className="app-root">
      {/* ====================================================================
          TOP APPLICATION HEADER
          ==================================================================== */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="brand-icon-wrap">
              <Zap size={18} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span className="brand-name">Motivational Shorts Studio</span>
              <span className="shorts-badge">9:16 Shorts</span>
            </div>
          </div>

          <div className="header-controls">
            {/* Live Connection Status Pill */}
            <button
              type="button"
              className="status-pill"
              onClick={handleOpenSettings}
              title="Click to view connection details"
            >
              <span
                className={`status-dot ${
                  isBackendOk && isTunnelOk ? 'online' : isBackendOk ? 'warning' : 'offline'
                }`}
              />
              <span>
                {isBackendOk && isTunnelOk
                  ? 'Tunnel Online'
                  : isBackendOk
                  ? 'Connecting Tunnel...'
                  : 'Backend Offline'}
              </span>
            </button>

            {/* Studio Settings Button */}
            <button
              type="button"
              className="btn-header-config"
              onClick={handleOpenSettings}
              title="Studio Connection & Configuration"
            >
              <SettingsIcon size={14} />
              <span>Studio Config</span>
            </button>
          </div>
        </div>
      </header>

      {/* ====================================================================
          MAIN STUDIO WORKSPACE
          ==================================================================== */}
      <main className="studio-layout">
        {/* Workspace Intro Banner */}
        <div className="workspace-intro">
          <div className="intro-text">
            <h1>Create Inspiring YouTube Shorts in Seconds</h1>
            <p>
              Transform background footage and soundtracks into 1080 × 1920 vertical Shorts with centered typography overlays and cinematic formatting.
            </p>
          </div>
          <div className="intro-badges">
            <span className="engine-tag">
              <Server size={11} /> FastAPI
            </span>
            <span className="engine-tag">
              <Film size={11} /> FFmpeg 9:16
            </span>
            <span className="engine-tag">
              <Workflow size={11} /> n8n Cloud
            </span>
          </div>
        </div>

        {/* 2-Column Desktop Grid */}
        <div className="studio-grid">
          {/* ================================================================
              LEFT COLUMN: VIDEO CONFIGURATION FORM
              ================================================================ */}
          <div className="form-column">
            <form onSubmit={handleGenerate}>
              {/* SECTION A: Quick Start Presets */}
              <div className="studio-card" style={{ marginBottom: '1.25rem' }}>
                <div className="card-title-bar">
                  <div className="card-title-group">
                    <Sparkles size={16} className="card-title-icon" />
                    <span className="card-title">Quick Start Presets</span>
                  </div>
                  <span className="card-badge-info">Select to prefill</span>
                </div>

                <div className="presets-grid">
                  {PRESETS.map((p) => {
                    const isSelected = videoUrl === p.videoUrl && title === p.title;
                    return (
                      <button
                        key={p.name}
                        type="button"
                        className={`preset-card ${isSelected ? 'active' : ''}`}
                        onClick={() => applyPreset(p)}
                        disabled={loading}
                      >
                        <div className="preset-top">
                          <span className="preset-name">{p.name}</span>
                          <span className="preset-indicator" />
                        </div>
                        <p className="preset-snippet">{p.quote}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SECTION B: Video Sources */}
              <div className="studio-card" style={{ marginBottom: '1.25rem' }}>
                <div className="card-title-bar">
                  <div className="card-title-group">
                    <Video size={16} className="card-title-icon" />
                    <span className="card-title">Media Sources</span>
                  </div>
                  <span className="card-badge-info">YouTube or Direct Links</span>
                </div>

                {/* Video URL */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="videoUrl">
                      <Film size={13} className="field-label-icon" />
                      <span>Background Video URL</span>
                    </label>
                    <span className="field-hint">YouTube Shorts / Direct MP4</span>
                  </div>
                  <div className="input-wrapper">
                    <input
                      id="videoUrl"
                      type="url"
                      className="studio-input"
                      placeholder="https://youtube.com/shorts/... or http://localhost:8000/media/..."
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                </div>

                {/* Soundtrack URL */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="musicUrl">
                      <Music size={13} className="field-label-icon" />
                      <span>Soundtrack URL</span>
                    </label>
                    <span className="field-hint">MP3, AAC, OGG or YouTube</span>
                  </div>
                  <div className="input-wrapper">
                    <input
                      id="musicUrl"
                      type="url"
                      className="studio-input"
                      placeholder="http://localhost:8000/media/test_source_aud.mp3 or audio stream..."
                      value={musicUrl}
                      onChange={(e) => setMusicUrl(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* SECTION C: Content */}
              <div className="studio-card" style={{ marginBottom: '1.25rem' }}>
                <div className="card-title-bar">
                  <div className="card-title-group">
                    <Type size={16} className="card-title-icon" />
                    <span className="card-title">Short Content & Typography</span>
                  </div>
                  <span className="card-badge-info">Subtitles & Title</span>
                </div>

                {/* Motivational Quote */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="quoteText">
                      <FileText size={13} className="field-label-icon" />
                      <span>Motivational Speech / Quote</span>
                    </label>
                    <span className="field-hint">Dynamic typography overlay</span>
                  </div>
                  <textarea
                    id="quoteText"
                    className="studio-textarea"
                    rows={3}
                    placeholder="Enter the speech, quote, or key message to burn into the video..."
                    value={quoteText}
                    onChange={(e) => setQuoteText(e.target.value)}
                    disabled={loading}
                    required
                  />
                  <div className="char-counter">{quoteText.length} characters</div>
                </div>

                {/* Short Title */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="title">
                      <span>Short Title</span>
                    </label>
                    <span className="field-hint">Used for export filename</span>
                  </div>
                  <input
                    id="title"
                    type="text"
                    className="studio-input"
                    placeholder="e.g. Build Your Future"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              {/* SECTION D: Video Settings */}
              <div className="studio-card" style={{ marginBottom: '1.25rem' }}>
                <div className="card-title-bar">
                  <div className="card-title-group">
                    <Sliders size={16} className="card-title-icon" />
                    <span className="card-title">Video Settings</span>
                  </div>
                  <span className="card-badge-info">Canvas Parameters</span>
                </div>

                {/* Duration Segmented Control */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label">
                      <Clock size={13} className="field-label-icon" />
                      <span>Target Duration</span>
                    </label>
                    <span className="field-hint">Standard Shorts lengths</span>
                  </div>
                  <div className="segmented-control">
                    {[10, 30, 60].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`segmented-btn ${duration === d ? 'active' : ''}`}
                        onClick={() => setDuration(d)}
                        disabled={loading}
                      >
                        <span>{d}s</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Visual Typography Style Selector */}
                <div className="form-field" style={{ marginTop: '1rem' }}>
                  <div className="field-label-row">
                    <label className="field-label">
                      <Layers size={13} className="field-label-icon" />
                      <span>Visual Typography Style</span>
                    </label>
                    <span className="field-hint">Subtitles appearance</span>
                  </div>
                  <div className="style-grid">
                    <div
                      className={`style-card ${style === 'dark-motivational' ? 'selected' : ''}`}
                      onClick={() => setStyle('dark-motivational')}
                    >
                      <div className="style-card-header">
                        <span className="style-title">Cinematic Dark</span>
                        <div className="style-radio">
                          {style === 'dark-motivational' && <div className="style-radio-inner" />}
                        </div>
                      </div>
                      <span className="style-desc">Gold bold highlights, heavy backdrop vignette</span>
                    </div>

                    <div
                      className={`style-card ${style === 'minimal-white' ? 'selected' : ''}`}
                      onClick={() => setStyle('minimal-white')}
                    >
                      <div className="style-card-header">
                        <span className="style-title">Clean Minimal</span>
                        <div className="style-radio">
                          {style === 'minimal-white' && <div className="style-radio-inner" />}
                        </div>
                      </div>
                      <span className="style-desc">Sharp white typography with clean black outline</span>
                    </div>

                    <div
                      className={`style-card ${style === 'bold-motivational' ? 'selected' : ''}`}
                      onClick={() => setStyle('bold-motivational')}
                    >
                      <div className="style-card-header">
                        <span className="style-title">High Impact</span>
                        <div className="style-radio">
                          {style === 'bold-motivational' && <div className="style-radio-inner" />}
                        </div>
                      </div>
                      <span className="style-desc">Vibrant red accent title and bold text cards</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION E: Generation Trigger */}
              <button
                type="submit"
                className="btn-generate"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <RefreshCw size={18} className="spinner" />
                    <span>Rendering Short ({currentStageIdx + 1}/6)...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    <span>Generate Motivational Short</span>
                  </>
                )}
              </button>

              {/* Error Banner */}
              {errorMessage && (
                <div className="alert-error">
                  <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <div className="alert-error-title">Generation Pipeline Notice</div>
                    <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{errorMessage}</p>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* ================================================================
              RIGHT COLUMN: LIVE 9:16 CANVAS PREVIEW
              ================================================================ */}
          <div className="preview-column">
            <div className="preview-container-card">
              <div className="preview-top-bar">
                <div className="preview-heading">
                  <Play size={16} color="#ef4444" />
                  <span>Shorts Canvas Preview</span>
                </div>
                <span className="resolution-pill">1080 × 1920 MP4</span>
              </div>

              {/* Centered Phone Bezel Frame */}
              <div className="canvas-frame">
                <div className="phone-notch" />

                {/* Loading Progress Tracker Overlay */}
                {loading && (
                  <div className="progress-overlay">
                    <div className="progress-pct-huge">
                      {Math.round(((currentStageIdx + 1) / 6) * 100)}%
                    </div>
                    <div className="progress-track-bg">
                      <div
                        className="progress-track-fill"
                        style={{ width: `${((currentStageIdx + 1) / 6) * 100}%` }}
                      />
                    </div>
                    <ul className="stage-tracker-list">
                      {STAGES.map((s, idx) => (
                        <li
                          key={s}
                          className={`stage-step-row ${
                            idx < currentStageIdx ? 'completed' : idx === currentStageIdx ? 'active' : ''
                          }`}
                        >
                          <span className="step-indicator">
                            {idx < currentStageIdx ? (
                              <CheckCircle2 size={13} color="#10b981" />
                            ) : idx === currentStageIdx ? (
                              <RefreshCw size={13} className="spinner" color="#60a5fa" />
                            ) : (
                              <div
                                style={{
                                  width: '5px',
                                  height: '5px',
                                  borderRadius: '50%',
                                  background: 'rgba(255, 255, 255, 0.2)',
                                }}
                              />
                            )}
                          </span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Rendered Video Player or Empty Canvas */}
                {result?.videoUrl ? (
                  <video
                    src={result.videoUrl}
                    controls
                    autoPlay
                    loop
                    playsInline
                    className="active-short-video"
                  />
                ) : (
                  <div className="canvas-empty-state">
                    <div className="canvas-empty-icon">
                      <Sparkles size={24} />
                    </div>
                    <span className="canvas-empty-title">9:16 Vertical Canvas</span>
                    <p className="canvas-empty-desc">
                      Rendered video with centered typography, background score, and cinematic overlay will appear here.
                    </p>
                  </div>
                )}
              </div>

              {/* Render Success Actions Bar */}
              {result?.success && Boolean(result.videoUrl || result.downloadUrl) && (
                <div className="render-success-bar">
                  <div className="success-meta-row">
                    <CheckCircle2 size={15} color="#10b981" style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Render Complete: <strong>{result.title || title || 'Motivational Short'}</strong> ({result.durationSeconds || duration}s)
                    </span>
                  </div>

                  <div className="action-btn-group">
                    <a
                      href={result.downloadUrl || result.videoUrl || '#'}
                      download={`${(result.title || title || 'Motivational_Short').replace(/\s+/g, '_')}.mp4`}
                      className="btn-action-primary"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download size={15} />
                      <span>Download MP4</span>
                    </a>

                    <button
                      type="button"
                      className="btn-action-secondary"
                      onClick={handleCopyUrl}
                    >
                      {copied ? <Check size={15} color="#10b981" /> : <Copy size={15} />}
                      <span>{copied ? 'Copied' : 'Copy URL'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ====================================================================
          STUDIO CONFIGURATION MODAL (CENTERED DIALOG)
          ==================================================================== */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            {/* Modal Top Header */}
            <div className="modal-top">
              <div className="modal-title-group">
                <SettingsIcon size={18} color="#ef4444" />
                <h3 className="modal-heading">Studio Configuration</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowSettings(false)}
                title="Close settings"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="modal-content-area">
              {configError && (
                <div className="alert-error" style={{ margin: 0 }}>
                  <AlertCircle size={16} />
                  <span>{configError}</span>
                </div>
              )}

              {/* Section 1: Backend Connection & Cloudflare Tunnel */}
              <div className="config-section-card">
                <div className="config-section-header">
                  <span className="section-label">
                    <Server size={15} color="#38bdf8" />
                    <span>Backend Connection & Cloudflare Tunnel</span>
                  </span>
                  <button
                    type="button"
                    className="btn-sm-action"
                    onClick={handleRetryConnection}
                    disabled={retryingTunnel}
                  >
                    <RefreshCw size={11} className={retryingTunnel ? 'spinner' : ''} />
                    <span>{retryingTunnel ? 'Reconnecting...' : 'Retry Connection'}</span>
                  </button>
                </div>

                <div className="status-two-col">
                  {/* FastAPI Backend Status */}
                  <div className="status-mini-card">
                    <div className="mini-card-label">FastAPI Backend (Port 8000)</div>
                    <div>
                      {connectionStatus?.backend.status === 'online' ? (
                        <span className="badge-state ok">
                          <Check size={11} /> Online
                        </span>
                      ) : connectionStatus?.backend.status === 'starting' ? (
                        <span className="badge-state warn">
                          <RefreshCw size={11} className="spinner" /> Starting...
                        </span>
                      ) : (
                        <span className="badge-state err">
                          <AlertCircle size={11} /> Offline
                        </span>
                      )}
                      {health && (
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)', marginTop: '0.3rem' }}>
                          v{health.version} • FFmpeg {health.dependencies.ffmpeg ? '✓' : '✗'} • yt-dlp {health.dependencies.yt_dlp ? '✓' : '✗'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Cloudflare Tunnel Status */}
                  <div className="status-mini-card">
                    <div className="mini-card-label">Cloudflare Quick Tunnel</div>
                    <div>
                      {connectionStatus?.tunnel.status === 'connected' ? (
                        <span className="badge-state ok">
                          <Check size={11} /> Connected
                        </span>
                      ) : connectionStatus?.tunnel.status === 'connecting' ? (
                        <span className="badge-state warn">
                          <RefreshCw size={11} className="spinner" /> Connecting...
                        </span>
                      ) : (
                        <span className="badge-state err">
                          <AlertCircle size={11} /> Disconnected
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Active Public Tunnel URL */}
                {connectionStatus?.tunnel.url && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>
                      Active Public Tunnel URL (Auto-forwarded to cloud n8n):
                    </div>
                    <div className="tunnel-url-field">
                      <input
                        type="text"
                        readOnly
                        className="tunnel-input-readonly"
                        value={connectionStatus.tunnel.url}
                      />
                      <button
                        type="button"
                        className="btn-sm-action"
                        onClick={() => handleCopyTunnelUrl(connectionStatus.tunnel.url!)}
                        title="Copy Tunnel URL"
                      >
                        <Copy size={12} />
                        <span>{copiedTunnel ? 'Copied' : 'Copy'}</span>
                      </button>
                      <a
                        href={connectionStatus.tunnel.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-sm-action"
                        title="Open in new tab"
                      >
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                )}

                {/* Metadata & Proxy Badge */}
                <div style={{ marginTop: '0.75rem', fontSize: '0.68rem', color: 'var(--text-tertiary)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span>Health Check: {formatLastCheck(connectionStatus?.tunnel.lastHealthCheck)}</span>
                  <span>•</span>
                  <span>Auto-Reconnect: Active</span>
                </div>

                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '6px',
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    fontSize: '0.72rem',
                    color: '#34d399',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                  }}
                >
                  <ShieldCheck size={14} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Backend Proxy Mode:</strong> Webhook requests route server-side through local FastAPI to bypass browser CORS preflight restrictions.
                  </span>
                </div>
              </div>

              {/* Section 2: n8n Workflow Configuration */}
              <div className="config-section-card">
                <div className="config-section-header">
                  <span className="section-label">
                    <Workflow size={15} color="#ef4444" />
                    <span>n8n Webhook Endpoint</span>
                  </span>
                  <button
                    type="button"
                    className="btn-sm-action"
                    onClick={handleVerifyWebhook}
                    disabled={verifyingWebhook || !modalWebhookUrl.trim()}
                  >
                    <RefreshCw size={11} className={verifyingWebhook ? 'spinner' : ''} />
                    <span>{verifyingWebhook ? 'Verifying...' : 'Verify Endpoint'}</span>
                  </button>
                </div>

                <input
                  type="url"
                  className="studio-input"
                  value={modalWebhookUrl}
                  onChange={(e) => {
                    setModalWebhookUrl(e.target.value);
                    setWebhookVerifyResult(null);
                  }}
                  placeholder="https://your-n8n-instance.app.n8n.cloud/webhook/generate-motivational-short"
                  required
                />

                {/* Quick Switch Chips */}
                <div className="chips-row">
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setModalWebhookUrl(config.productionWebhookUrl || DEFAULT_CONFIG.productionWebhookUrl);
                      setWebhookVerifyResult(null);
                    }}
                  >
                    Cloud Production
                  </button>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setModalWebhookUrl(config.testWebhookUrl || DEFAULT_CONFIG.testWebhookUrl);
                      setWebhookVerifyResult(null);
                    }}
                  >
                    Cloud Test
                  </button>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setModalWebhookUrl('http://localhost:5678/webhook/generate-motivational-short');
                      setWebhookVerifyResult(null);
                    }}
                  >
                    Local n8n
                  </button>
                </div>

                {/* Verification Feedback */}
                {webhookVerifyResult && (
                  <div
                    style={{
                      marginTop: '0.65rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.74rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      background: webhookVerifyResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)',
                      border: webhookVerifyResult.success ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(244, 63, 94, 0.3)',
                      color: webhookVerifyResult.success ? '#34d399' : '#f87171',
                    }}
                  >
                    {webhookVerifyResult.success ? <Check size={13} /> : <AlertCircle size={13} />}
                    <span>{webhookVerifyResult.message}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Bottom Buttons */}
            <div className="modal-bottom">
              <button
                type="button"
                className="btn-action-secondary"
                onClick={handleResetSettings}
              >
                Reset to Defaults
              </button>
              <button
                type="button"
                className="btn-action-primary"
                style={{ background: 'var(--accent-red)', color: '#ffffff' }}
                onClick={handleSaveSettings}
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Toast Notification */}
      {toastMessage && (
        <div className="studio-toast">
          <CheckCircle2 size={16} color="#10b981" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

export default App;
