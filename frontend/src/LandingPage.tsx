import React, { useState, useRef } from 'react';
import {
  Zap,
  Play,
  ArrowRight,
  Sparkles,
  Sliders,
  Share2,
  Layers,
  Workflow,
  FileSpreadsheet,
  Film,
  Music,
  Type,
  Eye,
  Heart,
  ExternalLink
} from 'lucide-react';
import './landing.css';

interface LandingPageProps {
  onNavigateStudio: () => void;
}

export function LandingPage({ onNavigateStudio }: LandingPageProps) {
  // Parallax 3D effect state for Hero
  const stageRef = useRef<HTMLDivElement>(null);
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [activePreviewTab, setActivePreviewTab] = useState<'manual' | 'sheets' | 'publishing'>('manual');

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setRotate({
      x: Number((-y * 18).toFixed(2)),
      y: Number((x * 22).toFixed(2)),
    });
  };

  const handleMouseLeave = () => {
    setRotate({ x: 0, y: 0 });
  };

  return (
    <div className="lp-root">
      {/* Ambient background glows & grid */}
      <div className="lp-bg-ambient" aria-hidden="true">
        <div className="lp-bg-grid" />
        <div className="lp-glow-orb lp-glow-orb-1" />
        <div className="lp-glow-orb lp-glow-orb-2" />
        <div className="lp-glow-orb lp-glow-orb-3" />
      </div>

      {/* ====================================================================
          SECTION 1: FLOATING NAVIGATION BAR
          ==================================================================== */}
      <div className="lp-header-wrap">
        <nav className="lp-nav">
          <a href="#" className="lp-brand">
            <div className="lp-brand-icon">
              <Zap size={18} />
            </div>
            <span className="lp-brand-text">Motivational Shorts Studio</span>
            <span className="lp-brand-tag">v2.4 AI</span>
          </a>

          <ul className="lp-nav-links">
            <li><a href="#features">Features</a></li>
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#preview">Studio Preview</a></li>
            <li><a href="#showcase">Showcase</a></li>
          </ul>

          <div className="lp-nav-cta">
            <button
              type="button"
              className="lp-btn lp-btn-primary"
              onClick={onNavigateStudio}
            >
              <span>Get Started</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </nav>
      </div>

      {/* ====================================================================
          SECTION 2: HERO SECTION & 3D SMARTPHONE
          ==================================================================== */}
      <section className="lp-hero">
        <div className="lp-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          
          <div className="lp-hero-badge">
            <span className="lp-hero-badge-dot" />
            <span>AI-Powered Automated Shorts Studio</span>
          </div>

          <h1 className="lp-hero-heading">
            Turn Your Ideas Into <span className="lp-hero-gradient-text">Viral Shorts</span>.
          </h1>

          <p className="lp-hero-subtitle">
            Create cinematic, motivational YouTube Shorts and Instagram Reels with AI-powered automation.
            From background footage to final render, everything in one unified studio.
          </p>

          <div className="lp-hero-actions">
            <button
              type="button"
              className="lp-btn lp-btn-primary lp-btn-lg"
              onClick={onNavigateStudio}
            >
              <span>Get Started</span>
              <ArrowRight size={17} />
            </button>
            <a href="#features" className="lp-btn lp-btn-secondary lp-btn-lg">
              <span>Explore Features</span>
            </a>
          </div>

          <div className="lp-trust-indicator">
            <span>Create</span>
            <span className="lp-trust-separator">•</span>
            <span>Automate</span>
            <span className="lp-trust-separator">•</span>
            <span>Publish</span>
          </div>

          {/* 3D Smartphone Visual Centerpiece */}
          <div
            className="lp-3d-stage"
            ref={stageRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <div
              className="lp-3d-canvas"
              style={{
                transform: `rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
              }}
            >
              {/* Floating Badge 1: Timeline */}
              <div className="lp-badge-3d lp-badge-timeline">
                <div className="lp-badge-icon-box lp-icon-blue">
                  <Film size={20} />
                </div>
                <div className="lp-badge-content">
                  <span className="lp-badge-label">9:16 Video Timeline</span>
                  <span className="lp-badge-sub">00:00 / 00:30 • 60 FPS</span>
                </div>
              </div>

              {/* Floating Badge 2: AI Generation Indicator */}
              <div className="lp-badge-3d lp-badge-ai">
                <div className="lp-badge-icon-box lp-icon-violet">
                  <Sparkles size={20} />
                </div>
                <div className="lp-badge-content">
                  <span className="lp-badge-label">AI Typography Engine</span>
                  <span className="lp-badge-sub">Auto-Centered Subtitles</span>
                </div>
              </div>

              {/* Floating Badge 3: Audio Waveform */}
              <div className="lp-badge-3d lp-badge-audio">
                <div className="lp-badge-icon-box lp-icon-emerald">
                  <Music size={20} />
                </div>
                <div className="lp-badge-content">
                  <span className="lp-badge-label">Audio Normalizer</span>
                  <span className="lp-badge-sub">48kHz High Dynamic EQ</span>
                </div>
              </div>

              {/* Floating Badge 4: Multi-Platform Publishing */}
              <div className="lp-badge-3d lp-badge-platforms">
                <div className="lp-badge-icon-box lp-icon-pink">
                  <Share2 size={20} />
                </div>
                <div className="lp-badge-content">
                  <span className="lp-badge-label">Omni-Channel Sync</span>
                  <div className="lp-social-mini-row">
                    <span className="lp-social-mini-chip" title="YouTube Shorts">YT</span>
                    <span className="lp-social-mini-chip" title="Instagram Reels">IG</span>
                    <span className="lp-social-mini-chip" title="Discord">DC</span>
                    <span className="lp-social-mini-chip" title="Telegram">TG</span>
                  </div>
                </div>
              </div>

              {/* 3D Floating Smartphone */}
              <div className="lp-phone">
                <div className="lp-phone-island">
                  <div className="lp-phone-camera" />
                  <div className="lp-phone-sensor" />
                </div>

                <div className="lp-phone-screen">
                  <div className="lp-screen-bg-graphic" />

                  <div className="lp-screen-top-meta">
                    <div className="lp-screen-channel">
                      <div className="lp-screen-avatar">M</div>
                      <span className="lp-screen-handle">@motivational.shorts</span>
                    </div>
                    <div className="lp-screen-badge-live">
                      <span className="lp-hero-badge-dot" style={{ width: 5, height: 5 }} />
                      <span>9:16 HD</span>
                    </div>
                  </div>

                  <div className="lp-screen-video-content">
                    <span className="lp-screen-quote-badge">QUOTE // DISCIPLINE</span>
                    <p className="lp-screen-quote-text">
                      "Stop waiting and start building your future today."
                    </p>
                    <span className="lp-screen-author">— Daily Inspiration</span>
                  </div>

                  {/* Dynamic Audio Visualizer */}
                  <div className="lp-screen-waveform">
                    <div className="lp-wave-bar" />
                    <div className="lp-wave-bar" />
                    <div className="lp-wave-bar" />
                    <div className="lp-wave-bar" />
                    <div className="lp-wave-bar" />
                    <div className="lp-wave-bar" />
                    <div className="lp-wave-bar" />
                    <div className="lp-wave-bar" />
                    <div className="lp-wave-bar" />
                    <div className="lp-wave-bar" />
                  </div>

                  <div className="lp-screen-bottom-bar">
                    <div className="lp-screen-soundtrack">
                      <Music size={13} />
                      <span>Rise of the Stoic (Score)</span>
                    </div>
                    <div className="lp-screen-actions-col">
                      <Heart size={14} fill="#f43f5e" color="#f43f5e" />
                      <span style={{ fontSize: '0.7rem' }}>48.2K</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* ====================================================================
          SECTION 3: LIVE PRODUCT PREVIEW
          ==================================================================== */}
      <section id="preview" className="lp-preview-section">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-section-tag">Interactive Architecture</span>
            <h2 className="lp-section-title">Your Entire Content Studio. One Place.</h2>
            <p className="lp-section-desc">
              A unified command center for media ingestion, subtitle typography rendering, FFmpeg pipelines, and multi-platform publishing.
            </p>
          </div>

          <div className="lp-studio-window">
            <div className="lp-window-topbar">
              <div className="lp-window-dots">
                <span className="lp-dot lp-dot-red" />
                <span className="lp-dot lp-dot-yellow" />
                <span className="lp-dot lp-dot-green" />
              </div>
              <div className="lp-window-title">
                <Zap size={14} color="#60a5fa" />
                <span>Motivational Shorts Studio — Live Workstation</span>
              </div>
              <div className="lp-window-tabs">
                <button
                  type="button"
                  className={`lp-tab-btn ${activePreviewTab === 'manual' ? 'active' : ''}`}
                  onClick={() => setActivePreviewTab('manual')}
                >
                  Manual Studio
                </button>
                <button
                  type="button"
                  className={`lp-tab-btn ${activePreviewTab === 'sheets' ? 'active' : ''}`}
                  onClick={() => setActivePreviewTab('sheets')}
                >
                  Sheets Batch Mode
                </button>
                <button
                  type="button"
                  className={`lp-tab-btn ${activePreviewTab === 'publishing' ? 'active' : ''}`}
                  onClick={() => setActivePreviewTab('publishing')}
                >
                  Publishing (4 Channels)
                </button>
              </div>
            </div>

            <div className="lp-window-body">
              {activePreviewTab === 'manual' && (
                <>
                  <div className="lp-mock-column">
                    <div className="lp-mock-panel">
                      <div className="lp-mock-panel-header">
                        <span className="lp-mock-panel-title">
                          <Film size={15} color="#60a5fa" />
                          <span>01 MEDIA — Video & Soundtrack Sources</span>
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>yt-dlp Pipeline</span>
                      </div>
                      <div className="lp-mock-input-box">
                        <span>https://youtube.com/shorts/... or local MP4</span>
                        <span style={{ color: '#10b981', fontSize: '0.7rem' }}>VALIDATED</span>
                      </div>
                      <div className="lp-mock-input-box">
                        <span>http://localhost:8000/media/test_source_aud.mp3</span>
                        <span style={{ color: '#10b981', fontSize: '0.7rem' }}>READY</span>
                      </div>
                    </div>

                    <div className="lp-mock-panel">
                      <div className="lp-mock-panel-header">
                        <span className="lp-mock-panel-title">
                          <Type size={15} color="#a855f7" />
                          <span>02 SCRIPT — Speech & Burned Typography</span>
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#a855f7' }}>9:16 Canvas</span>
                      </div>
                      <div className="lp-mock-textarea">
                        "Stop waiting and start building your future today. The secret of getting ahead is getting started."
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="lp-btn lp-btn-primary"
                        style={{ flex: 1, padding: '0.75rem' }}
                        onClick={onNavigateStudio}
                      >
                        <Play size={16} fill="white" />
                        <span>Render 9:16 Short Now</span>
                      </button>
                    </div>
                  </div>

                  <div className="lp-mock-column">
                    <div className="lp-mock-phone-box">
                      <div className="lp-mock-grid-bg" />
                      <span className="lp-mock-canvas-pill">1080 × 1920 MP4</span>
                      <div style={{ zIndex: 1, textAlign: 'center' }}>
                        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem', color: '#60a5fa' }}>
                          <Sparkles size={22} />
                        </div>
                        <h4 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem' }}>9:16 Vertical Canvas</h4>
                        <p style={{ fontSize: '0.8rem', color: '#94a3b8', maxWidth: '280px', margin: '0 auto 1.5rem' }}>
                          Rendered video with centered typography, background score, and cinematic overlay appears here.
                        </p>
                        <button
                          type="button"
                          className="lp-btn lp-btn-secondary"
                          onClick={onNavigateStudio}
                        >
                          <span>Open Live Canvas</span>
                          <ExternalLink size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activePreviewTab === 'sheets' && (
                <div style={{ gridColumn: 'span 2', padding: '1rem' }}>
                  <div className="lp-mock-panel">
                    <div className="lp-mock-panel-header">
                      <span className="lp-mock-panel-title">
                        <FileSpreadsheet size={16} color="#34d399" />
                        <span>Google Sheets Automated Batch Pipeline</span>
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#34d399', background: 'rgba(52, 211, 153, 0.15)', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                        Live Synchronization
                      </span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
                      Connect your production spreadsheet to render dozens of motivational shorts in automated sequential queues.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                      <div className="lp-mock-input-box" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Row 2 • READY</span>
                        <span style={{ color: '#fff', fontSize: '0.8rem', fontWeight: 600 }}>The Price of Discipline</span>
                      </div>
                      <div className="lp-mock-input-box" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Row 3 • READY</span>
                        <span style={{ color: '#fff', fontSize: '0.8rem', fontWeight: 600 }}>Mental Fortress</span>
                      </div>
                      <div className="lp-mock-input-box" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Row 4 • PROCESSED</span>
                        <span style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>Never Surrender</span>
                      </div>
                      <div className="lp-mock-input-box" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Row 5 • IN QUEUE</span>
                        <span style={{ color: '#f59e0b', fontSize: '0.8rem', fontWeight: 600 }}>Embrace The Storm</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activePreviewTab === 'publishing' && (
                <div style={{ gridColumn: 'span 2', padding: '1rem' }}>
                  <div className="lp-mock-panel">
                    <div className="lp-mock-panel-header">
                      <span className="lp-mock-panel-title">
                        <Share2 size={16} color="#a855f7" />
                        <span>Omni-Channel Publishing Control Center</span>
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#818cf8', background: 'rgba(99, 102, 241, 0.15)', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                        4 Integrated Endpoints
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1rem' }}>
                      <div className="lp-mock-panel" style={{ textAlign: 'center' }}>
                        <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>YouTube Shorts</h5>
                        <span style={{ fontSize: '0.7rem', color: '#22c55e', background: 'rgba(34, 197, 94, 0.15)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>OAuth2 Connected</span>
                      </div>
                      <div className="lp-mock-panel" style={{ textAlign: 'center' }}>
                        <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>Instagram Reels</h5>
                        <span style={{ fontSize: '0.7rem', color: '#22c55e', background: 'rgba(34, 197, 94, 0.15)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>Graph API Active</span>
                      </div>
                      <div className="lp-mock-panel" style={{ textAlign: 'center' }}>
                        <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>Discord Webhook</h5>
                        <span style={{ fontSize: '0.7rem', color: '#22c55e', background: 'rgba(34, 197, 94, 0.15)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>Direct 25MB Cap</span>
                      </div>
                      <div className="lp-mock-panel" style={{ textAlign: 'center' }}>
                        <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>Telegram Bot</h5>
                        <span style={{ fontSize: '0.7rem', color: '#22c55e', background: 'rgba(34, 197, 94, 0.15)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>Bot API 50MB</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          SECTION 4: FEATURES
          ==================================================================== */}
      <section id="features" className="lp-features-section">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-section-tag">High Performance Capabilities</span>
            <h2 className="lp-section-title">Engineered For Viral Creators</h2>
            <p className="lp-section-desc">
              Everything you need to produce, polish, and distribute high-impact vertical video content at scale.
            </p>
          </div>

          <div className="lp-features-grid">
            {/* Feature 1 */}
            <div className="lp-feature-card">
              <div className="lp-feature-icon-wrap">
                <Sparkles size={24} />
              </div>
              <h3 className="lp-feature-title">AI Video Generation</h3>
              <p className="lp-feature-desc">
                Transform motivational ideas into engaging vertical videos with intelligent canvas auto-framing and subtitle timing.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="lp-feature-card">
              <div className="lp-feature-icon-wrap">
                <Film size={24} />
              </div>
              <h3 className="lp-feature-title">Cinematic Editing</h3>
              <p className="lp-feature-desc">
                Add typography, background footage, music and cinematic effects with hardware-accelerated FFmpeg rendering.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="lp-feature-card">
              <div className="lp-feature-icon-wrap">
                <Workflow size={24} />
              </div>
              <h3 className="lp-feature-title">Automated Workflow</h3>
              <p className="lp-feature-desc">
                Connect n8n and automate your video generation pipeline with real-time webhook callbacks and status relays.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="lp-feature-card">
              <div className="lp-feature-icon-wrap">
                <Share2 size={24} />
              </div>
              <h3 className="lp-feature-title">Multi-Platform Publishing</h3>
              <p className="lp-feature-desc">
                Publish content seamlessly to YouTube Shorts, Instagram Reels, Discord channels, and Telegram groups.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="lp-feature-card">
              <div className="lp-feature-icon-wrap">
                <Layers size={24} />
              </div>
              <h3 className="lp-feature-title">Custom Templates</h3>
              <p className="lp-feature-desc">
                Create consistent, brand-aligned content with reusable visual styles, typography presets, and color palettes.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="lp-feature-card">
              <div className="lp-feature-icon-wrap">
                <Sliders size={24} />
              </div>
              <h3 className="lp-feature-title">Publishing Dashboard</h3>
              <p className="lp-feature-desc">
                Manage your connected platforms, credential health, and automated publishing logs from one unified cockpit.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          SECTION 5: HOW IT WORKS (HORIZONTAL TIMELINE)
          ==================================================================== */}
      <section id="how-it-works" className="lp-workflow-section">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-section-tag">Step-by-Step Architecture</span>
            <h2 className="lp-section-title">From Concept to Feed in 4 Steps</h2>
            <p className="lp-section-desc">
              A streamlined, automated workflow designed to cut production time from hours to seconds.
            </p>
          </div>

          <div className="lp-workflow-grid">
            {/* Step 1 */}
            <div className="lp-workflow-step">
              <span className="lp-step-num">01 — FOOTAGE</span>
              <h3 className="lp-step-title">Choose Your Footage</h3>
              <p className="lp-step-desc">
                Select your background video and soundtrack via direct URLs or local media libraries.
              </p>
            </div>

            {/* Step 2 */}
            <div className="lp-workflow-step">
              <span className="lp-step-num">02 — MESSAGE</span>
              <h3 className="lp-step-title">Add Your Message</h3>
              <p className="lp-step-desc">
                Enter a motivational quote, powerful speech, or select from curated studio presets.
              </p>
            </div>

            {/* Step 3 */}
            <div className="lp-workflow-step">
              <span className="lp-step-num">03 — RENDER</span>
              <h3 className="lp-step-title">Generate Your Short</h3>
              <p className="lp-step-desc">
                Let the rendering pipeline build your vertical 9:16 video with synced audio and text burns.
              </p>
            </div>

            {/* Step 4 */}
            <div className="lp-workflow-step">
              <span className="lp-step-num">04 — PUBLISH</span>
              <h3 className="lp-step-title">Publish Everywhere</h3>
              <p className="lp-step-desc">
                Send your finished high-definition video directly to connected social platforms.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          SECTION 6: CINEMATIC SHOWCASE (9:16 VERTICAL VIDEO CARDS)
          ==================================================================== */}
      <section id="showcase" className="lp-showcase-section">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-section-tag">Cinematic Showcase</span>
            <h2 className="lp-section-title">Built For Maximum Retention</h2>
            <p className="lp-section-desc">
              Explore authentic vertical Shorts themes crafted to command attention on dynamic feeds.
            </p>
          </div>

          <div className="lp-showcase-grid">
            {/* Card 1: Discipline */}
            <div className="lp-video-card" onClick={onNavigateStudio}>
              <div className="lp-video-card-bg lp-card-1-bg" />
              <div className="lp-card-top">
                <span className="lp-card-pill">THEME: DISCIPLINE</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>0:30</span>
              </div>
              <div className="lp-card-center">
                <span className="lp-card-theme-title">Iron Will</span>
                <p className="lp-card-quote">
                  "The pain of discipline is far less than the pain of regret."
                </p>
              </div>
              <div className="lp-card-bottom">
                <span className="lp-card-views"><Eye size={13} /> 124.5K views</span>
                <span style={{ color: '#60a5fa', fontSize: '0.75rem', fontWeight: 600 }}>Create Theme →</span>
              </div>
            </div>

            {/* Card 2: Mental Strength */}
            <div className="lp-video-card" onClick={onNavigateStudio}>
              <div className="lp-video-card-bg lp-card-2-bg" />
              <div className="lp-card-top">
                <span className="lp-card-pill">THEME: MENTAL STRENGTH</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>0:25</span>
              </div>
              <div className="lp-card-center">
                <span className="lp-card-theme-title">Focus & Power</span>
                <p className="lp-card-quote">
                  "Your mind is a weapon. Keep it loaded with knowledge and sharp with discipline."
                </p>
              </div>
              <div className="lp-card-bottom">
                <span className="lp-card-views"><Eye size={13} /> 318.2K views</span>
                <span style={{ color: '#a855f7', fontSize: '0.75rem', fontWeight: 600 }}>Create Theme →</span>
              </div>
            </div>

            {/* Card 3: Never Give Up */}
            <div className="lp-video-card" onClick={onNavigateStudio}>
              <div className="lp-video-card-bg lp-card-3-bg" />
              <div className="lp-card-top">
                <span className="lp-card-pill">THEME: RESILIENCE</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>0:35</span>
              </div>
              <div className="lp-card-center">
                <span className="lp-card-theme-title">Never Surrender</span>
                <p className="lp-card-quote">
                  "Champions aren't born in comfort. They're forged in the moments they refuse to quit."
                </p>
              </div>
              <div className="lp-card-bottom">
                <span className="lp-card-views"><Eye size={13} /> 489.1K views</span>
                <span style={{ color: '#34d399', fontSize: '0.75rem', fontWeight: 600 }}>Create Theme →</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          SECTION 7: CALL TO ACTION (CTA)
          ==================================================================== */}
      <section className="lp-cta-section">
        <div className="lp-container">
          <div className="lp-cta-box">
            <h2 className="lp-cta-heading">Your Next Great Video Starts Here.</h2>
            <p className="lp-cta-desc">
              Stop spending hours editing frame by frame. Start creating and automating high-converting motivational shorts today.
            </p>
            <button
              type="button"
              className="lp-btn lp-btn-primary lp-btn-lg"
              onClick={onNavigateStudio}
            >
              <span>Get Started — It's Free</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* ====================================================================
          SECTION 8: FOOTER
          ==================================================================== */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div>
              <div className="lp-brand">
                <div className="lp-brand-icon">
                  <Zap size={18} />
                </div>
                <span className="lp-brand-text">Motivational Shorts Studio</span>
              </div>
              <p className="lp-footer-brand-desc">
                The high-performance AI studio for crafting cinematic vertical videos, motivational shorts, and automated omni-channel publishing.
              </p>
            </div>

            <div>
              <h4 className="lp-footer-col-title">Product</h4>
              <ul className="lp-footer-list">
                <li><a href="#features">Features</a></li>
                <li><a href="#preview">Studio Workspace</a></li>
                <li><a href="#how-it-works">Pipeline Architecture</a></li>
                <li><a href="#showcase">Templates & Presets</a></li>
              </ul>
            </div>

            <div>
              <h4 className="lp-footer-col-title">Integrations</h4>
              <ul className="lp-footer-list">
                <li><a href="#preview">YouTube Shorts Data API</a></li>
                <li><a href="#preview">Instagram Graph API</a></li>
                <li><a href="#preview">Discord Webhooks</a></li>
                <li><a href="#preview">Telegram Bot API</a></li>
              </ul>
            </div>

            <div>
              <h4 className="lp-footer-col-title">Studio Status</h4>
              <ul className="lp-footer-list">
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#22c55e' }}>
                  <span className="lp-hero-badge-dot" style={{ width: 6, height: 6 }} />
                  <span>FastAPI Engine Online</span>
                </li>
                <li><span style={{ color: '#94a3b8' }}>FFmpeg 9:16 Canvas Ready</span></li>
                <li><span style={{ color: '#94a3b8' }}>n8n Webhook Relay Ready</span></li>
                <li><span style={{ color: '#94a3b8' }}>Cloudflare Tunnel Active</span></li>
              </ul>
            </div>
          </div>

          <div className="lp-footer-bottom">
            <span>&copy; {new Date().getFullYear()} Motivational Shorts Studio. All rights reserved.</span>
            <span>Privacy Policy • Terms of Service • Clean Architecture</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
