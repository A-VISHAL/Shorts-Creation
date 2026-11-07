import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Download,
  Copy,
  RefreshCw,
  Music,
  Sparkles,
  Settings as SettingsIcon,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
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
  Sun,
  Moon,
  FileSpreadsheet,
  Share2,
  ArrowLeft,
  Sliders,
} from 'lucide-react';
import './studio_redesign.css';
import './saas_light_theme.css';
import { GoogleSheetsMode } from './GoogleSheetsMode';
import { PublishingDashboard } from './PublishingDashboard';
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
  badgeClass: string;
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
    badgeClass: 'badge-neon-cyan',
    videoUrl: 'http://localhost:8000/media/test_source_vid.mp4',
    musicUrl: 'http://localhost:8000/media/test_source_aud.mp3',
    quote: 'Stop waiting and start building your future today.',
    title: 'Build Your Future',
    style: 'dark-motivational',
  },
  {
    name: 'YouTube Shorts Demo',
    badge: 'yt-dlp Pipeline',
    badgeClass: 'badge-neon-pink',
    videoUrl: 'https://youtube.com/shorts/Ke6kzNR3NnU',
    musicUrl: 'http://localhost:8000/media/test_source_aud.mp3',
    quote: 'The secret of getting ahead is getting started. Break your goals into daily steps.',
    title: 'Rise Above Limits',
    style: 'bold-motivational',
  },
  {
    name: 'Clean Minimalist',
    badge: 'Ambient Canvas',
    badgeClass: 'badge-neon-amber',
    videoUrl: 'http://localhost:8000/media/test_source_vid.mp4',
    musicUrl: 'http://localhost:8000/media/test_source_aud.mp3',
    quote: 'Your mind is a weapon. Keep it loaded with knowledge and sharp with discipline.',
    title: 'Stay Focused',
    style: 'minimal-white',
  },
];

export function StudioApp({ onNavigateHome }: { onNavigateHome?: () => void } = {}) {
  // Theme State (Default to Dark Cinematic)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('shorts_theme', theme);
  }, [theme]);

  // Active Mode State (Manual Mode vs. Google Sheets Mode vs. Publishing Dashboard)
  const [activeMode, setActiveMode] = useState<'manual' | 'sheets' | 'publishing'>(() => {
    const saved = localStorage.getItem('shorts_studio_mode');
    return saved === 'sheets' || saved === 'publishing' ? saved : 'manual';
  });

  const [publishTarget, setPublishTarget] = useState<{
    videoUrl?: string;
    title?: string;
    quote?: string;
    spreadsheetUrl?: string;
    rowNumber?: number;
    sheetName?: string;
  }>({});

  useEffect(() => {
    localStorage.setItem('shorts_studio_mode', activeMode);
  }, [activeMode]);

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

  // 3D Preview Parallax State
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewTilt, setPreviewTilt] = useState({ x: 0, y: 0 });

  const handlePreviewMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setPreviewTilt({
      x: Number((-y * 14).toFixed(2)),
      y: Number((x * 16).toFixed(2)),
    });
  };

  const handlePreviewMouseLeave = () => {
    setPreviewTilt({ x: 0, y: 0 });
  };

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
    <div className={`app-root mode-${activeMode}`}>
      {/* ====================================================================
          TOP APPLICATION HEADER
          ==================================================================== */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            {onNavigateHome && (
              <button
                type="button"
                className="nav-mode-btn"
                onClick={onNavigateHome}
                title="Back to Landing Page"
                style={{ marginRight: '0.5rem', padding: '0.4rem 0.75rem', gap: '0.4rem', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <ArrowLeft size={14} />
                <span>Home</span>
              </button>
            )}
            <div className="brand-icon-wrap">
              <Zap size={18} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span className="brand-name">Motivational Shorts Studio</span>
              <span className="shorts-badge">9:16 Shorts</span>
            </div>
          </div>

          {/* Navigation Modes: Manual Mode vs. Google Sheets Mode vs. Publishing Dashboard */}
          <nav className="header-nav-modes">
            <button
              type="button"
              className={`nav-mode-btn ${activeMode === 'manual' ? 'active' : ''}`}
              onClick={() => setActiveMode('manual')}
            >
              <Film size={15} className="nav-mode-icon" />
              <span>Manual Mode</span>
            </button>
            <button
              type="button"
              className={`nav-mode-btn ${activeMode === 'sheets' ? 'active' : ''}`}
              onClick={() => setActiveMode('sheets')}
            >
              <FileSpreadsheet size={15} className="nav-mode-icon" />
              <span>Google Sheets Mode</span>
            </button>
            <button
              type="button"
              className={`nav-mode-btn ${activeMode === 'publishing' ? 'active' : ''}`}
              onClick={() => setActiveMode('publishing')}
            >
              <Share2 size={15} className="nav-mode-icon" />
              <span>Publishing Dashboard</span>
              <span className="nav-mode-badge-new">4 PLATFORMS</span>
            </button>
          </nav>

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

            {/* Light / Dark Mode Toggle */}
            <button
              type="button"
              className="btn-theme-toggle"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={`Switch to ${theme === 'dark' ? 'Monochromatic Light' : 'Vibrant Dark'} mode`}
            >
              {theme === 'dark' ? (
                <Sun size={15} color="#fbbf24" />
              ) : (
                <Moon size={15} color="#0f172a" />
              )}
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
        {activeMode === 'publishing' ? (
          <PublishingDashboard
            initialVideoUrl={publishTarget.videoUrl || result?.videoUrl || result?.downloadUrl || ''}
            initialTitle={publishTarget.title || title || 'Motivational Short'}
            initialQuote={publishTarget.quote || quoteText || ''}
            spreadsheetUrl={publishTarget.spreadsheetUrl}
            rowNumber={publishTarget.rowNumber}
            sheetName={publishTarget.sheetName}
            showToast={showToast}
          />
        ) : activeMode === 'sheets' ? (
          <>
            <div className="workspace-intro">
              <div className="intro-text">
                <h1>Google Sheets Automated Shorts Production</h1>
                <p>
                  Connect your Google Spreadsheet to automatically retrieve inspirational quotes, footage, and audio to render batch 9:16 vertical Shorts in seconds.
                </p>
              </div>
              <div className="intro-badges">
                <span className="engine-tag">
                  <FileSpreadsheet size={12} color="var(--neon-cyan)" /> Google Sheets API
                </span>
                <span className="engine-tag">
                  <Server size={12} color="var(--accent-primary)" /> FastAPI Engine
                </span>
                <span className="engine-tag">
                  <Workflow size={12} color="var(--status-success)" /> n8n Orchestrator
                </span>
              </div>
            </div>

            <GoogleSheetsMode
              config={config}
              showToast={showToast}
              onPublishToDashboard={(vUrl, vTitle, vQuote, vRow, vSheet) => {
                setPublishTarget({
                  videoUrl: vUrl,
                  title: vTitle,
                  quote: vQuote,
                  rowNumber: vRow,
                  sheetName: vSheet,
                });
                setActiveMode('publishing');
                showToast(`Loaded row #${vRow} into Publishing Dashboard`);
              }}
            />
          </>
        ) : (
          <>
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
                  <Server size={12} color="var(--accent-primary)" /> FastAPI Engine
                </span>
                <span className="engine-tag">
                  <Film size={12} color="var(--accent-cyan)" /> FFmpeg 9:16 Canvas
                </span>
                <span className="engine-tag">
                  <Workflow size={12} color="var(--status-success)" /> n8n Orchestrator
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
              {/* SECTION: Quick Start Presets */}
              <div className="module-card section-presets">
                <div className="module-header">
                  <div className="module-title-group">
                    <span className="module-step-badge badge-presets">★ PRESETS</span>
                    <h2 className="module-title">Quick Start Presets</h2>
                  </div>
                  <span className="module-subtitle subtitle-presets">Select a 1-click template</span>
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
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <span className="preset-name">{p.name}</span>
                            {isSelected && (
                              <span style={{ fontSize: '0.65rem', color: '#60a5fa', fontWeight: 800, background: 'rgba(59,130,246,0.2)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>ACTIVE</span>
                            )}
                          </div>
                          <span className={`preset-badge ${p.badgeClass}`}>{p.badge}</span>
                        </div>
                        <p className="preset-snippet">"{p.quote}"</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* MODULE 01: Media Sources */}
              <div className="module-card section-media">
                <div className="module-header">
                  <div className="module-title-group">
                    <span className="module-step-badge badge-media">01 MEDIA</span>
                    <h2 className="module-title">Media Sources</h2>
                  </div>
                  <span className="module-subtitle subtitle-media">Video & Soundtrack URLs</span>
                </div>

                {/* Video URL */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="videoUrl">
                      <Film size={15} className="field-label-icon icon-cyan" />
                      <span>Background Video URL</span>
                    </label>
                    <span className="field-hint hint-cyan">YouTube Shorts / MP4</span>
                  </div>
                  <input
                    id="videoUrl"
                    type="url"
                    className="studio-input input-cyan"
                    placeholder="https://youtube.com/shorts/... or http://localhost:8000/media/..."
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    disabled={loading}
                    required
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.45rem', fontSize: '0.72rem', color: 'var(--studio-text-muted)' }}>
                    <span style={{ fontFamily: 'var(--studio-font-mono)' }}>Supported: YouTube Shorts, Reels, MP4, WebM</span>
                    <span style={{ color: '#38bdf8', fontFamily: 'var(--studio-font-mono)', fontWeight: 600 }}>9:16 Auto-Framing</span>
                  </div>
                </div>

                {/* Soundtrack URL */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="musicUrl">
                      <Music size={15} className="field-label-icon icon-cyan" />
                      <span>Soundtrack URL</span>
                    </label>
                    <span className="field-hint hint-cyan">MP3, AAC or YouTube</span>
                  </div>
                  <input
                    id="musicUrl"
                    type="url"
                    className="studio-input input-cyan"
                    placeholder="http://localhost:8000/media/test_source_aud.mp3 or audio stream..."
                    value={musicUrl}
                    onChange={(e) => setMusicUrl(e.target.value)}
                    disabled={loading}
                    required
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.45rem', fontSize: '0.72rem', color: 'var(--studio-text-muted)' }}>
                    <span style={{ fontFamily: 'var(--studio-font-mono)' }}>Direct Audio Stream / yt-dlp Audio Extractor</span>
                    <span style={{ color: '#a855f7', fontFamily: 'var(--studio-font-mono)', fontWeight: 600 }}>48kHz Dynamic EQ</span>
                  </div>
                </div>
              </div>

              {/* MODULE 02: Short Content & Typography */}
              <div className="module-card section-typography">
                <div className="module-header">
                  <div className="module-title-group">
                    <span className="module-step-badge badge-typography">02 SCRIPT</span>
                    <h2 className="module-title">Speech & Typography</h2>
                  </div>
                  <span className="module-subtitle subtitle-typography">Quote & Title Overlay</span>
                </div>

                {/* Motivational Quote */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="quoteText">
                      <FileText size={15} className="field-label-icon icon-amber" />
                      <span>Motivational Quote / Speech</span>
                    </label>
                    <span className="field-hint hint-amber">Burned 9:16 Overlay</span>
                  </div>
                  <textarea
                    id="quoteText"
                    className="studio-textarea input-amber"
                    rows={3}
                    placeholder="Enter the inspirational quote or speech to animate into the short..."
                    value={quoteText}
                    onChange={(e) => setQuoteText(e.target.value)}
                    disabled={loading}
                    required
                  />
                  <div className="char-counter">
                    <span className="char-count-pill">{quoteText.length} characters</span>
                  </div>
                </div>

                {/* Short Title */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="title">
                      <Type size={15} className="field-label-icon icon-amber" />
                      <span>Short Title</span>
                    </label>
                    <span className="field-hint hint-amber">Output Filename</span>
                  </div>
                  <input
                    id="title"
                    type="text"
                    className="studio-input input-amber"
                    placeholder="e.g. Build Your Future"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={loading}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.45rem', fontSize: '0.72rem', color: 'var(--studio-text-muted)' }}>
                    <span style={{ fontFamily: 'var(--studio-font-mono)' }}>
                      Output: {(title || 'Motivational_Short').replace(/\s+/g, '_')}.mp4
                    </span>
                    <span style={{ color: '#fbbf24', fontFamily: 'var(--studio-font-mono)', fontWeight: 600 }}>Metadata Sync Ready</span>
                  </div>
                </div>
              </div>

              {/* MODULE 03: Canvas Parameters */}
              <div className="module-card section-canvas">
                <div className="module-header">
                  <div className="module-title-group">
                    <span className="module-step-badge">03 CANVAS</span>
                    <h2 className="module-title">Canvas Parameters</h2>
                  </div>
                  <span className="module-subtitle">Duration & Subtitle Theme</span>
                </div>

                {/* Duration Segmented Control */}
                <div className="form-field">
                  <div className="field-label-row">
                    <label className="field-label">
                      <Clock size={15} className="field-label-icon" />
                      <span>Target Duration</span>
                    </label>
                    <span className="field-hint">Preset Duration</span>
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
                        <span style={{ fontSize: '0.65rem', opacity: 0.75, marginLeft: '0.35rem', fontWeight: 500 }}>
                          {d === 10 ? 'Micro' : d === 30 ? 'Viral' : 'Story'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Visual Typography Style Selector */}
                <div className="form-field" style={{ marginTop: '1.25rem' }}>
                  <div className="field-label-row">
                    <label className="field-label">
                      <Layers size={15} className="field-label-icon" />
                      <span>Visual Typography Style</span>
                    </label>
                    <span className="field-hint">Overlay Theme</span>
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
                      <div style={{ background: '#070a12', padding: '0.45rem', borderRadius: '6px', textAlign: 'center', margin: '0.3rem 0', border: '1px solid rgba(245,158,11,0.3)' }}>
                        <span style={{ color: '#fbbf24', fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.04em' }}>BE RELENTLESS</span>
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
                      <div style={{ background: '#0b101d', padding: '0.45rem', borderRadius: '6px', textAlign: 'center', margin: '0.3rem 0', border: '1px solid rgba(255,255,255,0.2)' }}>
                        <span style={{ color: '#ffffff', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.02em' }}>FOCUS ON GROWTH</span>
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
                      <div style={{ background: '#180a12', padding: '0.45rem', borderRadius: '6px', textAlign: 'center', margin: '0.3rem 0', border: '1px solid rgba(239,68,68,0.35)' }}>
                        <span style={{ color: '#f43f5e', fontWeight: 900, fontSize: '0.78rem', letterSpacing: '0.04em' }}>NEVER SURRENDER</span>
                      </div>
                      <span className="style-desc">Vibrant red accent title and bold text cards</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION: Generation Trigger */}
              <button
                type="submit"
                className="btn-generate"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <RefreshCw size={20} className="spinner" />
                    <span>Rendering Short ({currentStageIdx + 1}/6)...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
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
            <div className="preview-container-card section-preview">
              <div className="preview-top-bar">
                <div className="preview-heading">
                  <Play size={18} className="preview-heading-icon" />
                  <span>Cinematic 3D Video Preview</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="resolution-pill">1080 × 1920 MP4</span>
                  <span className="resolution-pill" style={{ color: '#34d399', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.1)' }}>
                    60 FPS
                  </span>
                </div>
              </div>

              {/* 3D Stage with Mouse Parallax */}
              <div
                className="studio-3d-stage"
                ref={previewRef}
                onMouseMove={handlePreviewMouseMove}
                onMouseLeave={handlePreviewMouseLeave}
              >
                <div
                  className="studio-3d-canvas"
                  style={{
                    transform: `rotateX(${previewTilt.x}deg) rotateY(${previewTilt.y}deg)`,
                  }}
                >
                  {/* Floating Chip 1: Resolution & Aspect Ratio (Left Top) */}
                  <div className="studio-floating-chip chip-left-top">
                    <div className="chip-icon chip-icon-cyan">
                      <Film size={15} />
                    </div>
                    <div>
                      <div style={{ color: '#fff', fontSize: '0.72rem', fontWeight: 700 }}>9:16 Canvas</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.65rem', fontFamily: 'var(--studio-font-mono)' }}>1080×1920 HD</div>
                    </div>
                  </div>

                  {/* Floating Chip 2: AI Typography Engine (Right Top) */}
                  <div className="studio-floating-chip chip-right-top">
                    <div className="chip-icon chip-icon-violet">
                      <Sparkles size={15} />
                    </div>
                    <div>
                      <div style={{ color: '#fff', fontSize: '0.72rem', fontWeight: 700 }}>AI Typography</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.65rem', fontFamily: 'var(--studio-font-mono)' }}>Centered Overlays</div>
                    </div>
                  </div>

                  {/* Floating Chip 3: Audio Normalizer (Left Bottom) */}
                  <div className="studio-floating-chip chip-left-bottom">
                    <div className="chip-icon chip-icon-pink">
                      <Music size={15} />
                    </div>
                    <div>
                      <div style={{ color: '#fff', fontSize: '0.72rem', fontWeight: 700 }}>Audio Normalizer</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.65rem', fontFamily: 'var(--studio-font-mono)' }}>48kHz Dynamic EQ</div>
                    </div>
                  </div>

                  {/* 3D Floating Smartphone Frame */}
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
                                  <CheckCircle2 size={13} color="var(--status-success)" />
                                ) : idx === currentStageIdx ? (
                                  <RefreshCw size={13} className="spinner" color="var(--accent-cyan)" />
                                ) : (
                                  <div
                                    style={{
                                      width: '5px',
                                      height: '5px',
                                      borderRadius: '50%',
                                      background: 'rgba(255, 255, 255, 0.25)',
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

                    {/* Rendered Video Player or Atmospheric Cinematic Placeholder */}
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
                      <div className="canvas-cinematic-placeholder">
                        <div className="cinematic-bg-aurora" />
                        <div className="cinematic-mountain-silhouette" />

                        <div className="cinematic-top-pill">
                          <Sparkles size={11} color="#60a5fa" />
                          <span>9:16 LIVE PREVIEW</span>
                        </div>

                        <div className="cinematic-quote-box">
                          <div className="cinematic-quote-title">
                            {title || 'BUILD YOUR FUTURE'}
                          </div>
                          <p className="cinematic-quote-text">
                            "{quoteText || 'Stop waiting and start building your future today.'}"
                          </p>
                        </div>

                        <div className="cinematic-bottom-meta">
                          <div className="cinematic-soundtrack-name">
                            <Music size={12} color="#a855f7" />
                            <span>{musicUrl ? 'Custom Audio Track' : 'Epic Cinematic Score'}</span>
                          </div>
                          <div className="cinematic-eq">
                            <div className="eq-bar" />
                            <div className="eq-bar" />
                            <div className="eq-bar" />
                            <div className="eq-bar" />
                            <div className="eq-bar" />
                            <div className="eq-bar" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Render Success Actions Bar */}
              {result?.success && Boolean(result.videoUrl || result.downloadUrl) && (
                <div className="render-success-bar">
                  <div className="success-meta-row">
                    <CheckCircle2 size={16} color="var(--status-success)" style={{ flexShrink: 0 }} />
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
                      {copied ? <Check size={15} color="var(--status-success)" /> : <Copy size={15} />}
                      <span>{copied ? 'Copied' : 'Copy URL'}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-action-primary"
                      style={{ background: 'linear-gradient(135deg, var(--accent-primary), #8b5cf6)' }}
                      onClick={() => {
                        setPublishTarget({
                          videoUrl: result.videoUrl || result.downloadUrl,
                          title: result.title || title || 'Motivational Short',
                          quote: quoteText,
                        });
                        setActiveMode('publishing');
                        showToast('Loaded video into Publishing Dashboard');
                      }}
                    >
                      <Share2 size={15} />
                      <span>Publish Short</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Cinematic Multi-Track Sequence Timeline */}
              <div className="studio-timeline-panel">
                <div className="timeline-header">
                  <div className="timeline-title-group">
                    <Sliders size={14} color="#60a5fa" />
                    <span>Cinematic Sequence Timeline</span>
                  </div>
                  <div className="timeline-timecode">
                    <span>00:00:00</span>
                    <span className="timecode-sep">/</span>
                    <span>00:00:{String(duration).padStart(2, '0')}</span>
                  </div>
                </div>

                <div className="timeline-tracks">
                  {/* Track 1: Video Track */}
                  <div className="timeline-track">
                    <div className="track-label">
                      <Film size={12} color="#60a5fa" />
                      <span>VIDEO</span>
                    </div>
                    <div className="track-lane">
                      <div className="lane-clip clip-video" style={{ width: '100%' }}>
                        <span>{videoUrl ? 'Source Footage (yt-dlp)' : 'Default Background Footage'}</span>
                        <span style={{ fontSize: '0.62rem', opacity: 0.85 }}>1080×1920</span>
                      </div>
                    </div>
                  </div>

                  {/* Track 2: Typography Subtitle Track */}
                  <div className="timeline-track">
                    <div className="track-label">
                      <Type size={12} color="#fbbf24" />
                      <span>SUBS</span>
                    </div>
                    <div className="track-lane">
                      <div className="lane-clip clip-text" style={{ width: '85%', marginLeft: '5%' }}>
                        <span>"{quoteText.slice(0, 24)}..."</span>
                        <span style={{ fontSize: '0.62rem', opacity: 0.85 }}>{style.replace('-', ' ')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Track 3: Audio Soundtrack Track */}
                  <div className="timeline-track">
                    <div className="track-label">
                      <Music size={12} color="#34d399" />
                      <span>AUDIO</span>
                    </div>
                    <div className="track-lane">
                      <div className="lane-clip clip-audio" style={{ width: '100%' }}>
                        <div className="track-waveform">
                          <span className="wf-bar" style={{ height: '35%' }} />
                          <span className="wf-bar" style={{ height: '70%' }} />
                          <span className="wf-bar" style={{ height: '50%' }} />
                          <span className="wf-bar" style={{ height: '85%' }} />
                          <span className="wf-bar" style={{ height: '60%' }} />
                          <span className="wf-bar" style={{ height: '90%' }} />
                          <span className="wf-bar" style={{ height: '40%' }} />
                          <span className="wf-bar" style={{ height: '75%' }} />
                          <span className="wf-bar" style={{ height: '95%' }} />
                          <span className="wf-bar" style={{ height: '65%' }} />
                          <span className="wf-bar" style={{ height: '80%' }} />
                          <span className="wf-bar" style={{ height: '55%' }} />
                        </div>
                        <span>{musicUrl ? 'Custom Audio' : 'Rise of the Stoic'}</span>
                        <span style={{ fontSize: '0.62rem', opacity: 0.85 }}>48kHz</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    )}
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
                <SettingsIcon size={18} color="var(--accent-primary)" />
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
                    <Server size={15} color="var(--accent-cyan)" />
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
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '0.3rem' }}>
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
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>
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
                <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--text-tertiary)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span>Health Check: {formatLastCheck(connectionStatus?.tunnel.lastHealthCheck)}</span>
                  <span>•</span>
                  <span>Auto-Reconnect: Active</span>
                </div>

                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '8px',
                    background: 'var(--status-success-subtle)',
                    border: '1px solid var(--status-success-border)',
                    fontSize: '0.74rem',
                    color: 'var(--status-success)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <ShieldCheck size={15} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Backend Proxy Mode:</strong> Webhook requests route server-side through local FastAPI to bypass browser CORS preflight restrictions.
                  </span>
                </div>
              </div>

              {/* Section 2: n8n Workflow Configuration */}
              <div className="config-section-card">
                <div className="config-section-header">
                  <span className="section-label">
                    <Workflow size={15} color="var(--accent-primary)" />
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
                      marginTop: '0.75rem',
                      padding: '0.55rem 0.85rem',
                      borderRadius: '8px',
                      fontSize: '0.76rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: webhookVerifyResult.success ? 'var(--status-success-subtle)' : 'var(--status-error-subtle)',
                      border: `1px solid ${webhookVerifyResult.success ? 'var(--status-success-border)' : 'var(--status-error-border)'}`,
                      color: webhookVerifyResult.success ? 'var(--status-success)' : 'var(--status-error)',
                    }}
                  >
                    {webhookVerifyResult.success ? <Check size={14} /> : <AlertCircle size={14} />}
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
                style={{ background: 'var(--accent-primary)', color: 'var(--text-inverse)' }}
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
          <CheckCircle2 size={16} color="var(--status-success)" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

export default StudioApp;
