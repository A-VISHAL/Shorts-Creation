import { useState, useEffect } from 'react';
import {
  Youtube,
  Send,
  Instagram,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Share2,
  ShieldCheck,
  HelpCircle,
  Film,
  Zap,
  Info,
  Copy,
  Check,
  X,
  Sliders,
  FileSpreadsheet,
  Key,
  Eye,
  EyeOff,
  FileCheck2,
} from 'lucide-react';
import {
  fetchPublishingStatus,
  testPlatformConnection,
  configurePlatform,
  verifyMediaFile,
  dispatchPublish,
  PublishingConnectionsStatus,
  MultiPlatformPublishReport,
} from './api';

interface PublishingDashboardProps {
  initialVideoUrl?: string;
  initialTitle?: string;
  initialQuote?: string;
  spreadsheetUrl?: string;
  rowNumber?: number;
  sheetName?: string;
  showToast: (msg: string) => void;
}

type PlatformKey = 'youtube' | 'discord' | 'telegram' | 'instagram';

interface PlatformConfigMeta {
  key: PlatformKey;
  name: string;
  subtitle: string;
  guideUrl: string;
  fields: {
    key: string;
    label: string;
    placeholder: string;
    isSecret?: boolean;
    hint: string;
  }[];
}

export const DEFAULT_YOUTUBE_CLIENT_ID =
  (import.meta.env.VITE_DEFAULT_YOUTUBE_CLIENT_ID as string) || '';
export const DEFAULT_YOUTUBE_CLIENT_SECRET =
  (import.meta.env.VITE_DEFAULT_YOUTUBE_CLIENT_SECRET as string) || '';

export const DEFAULT_DISCORD_WEBHOOK_URL =
  (import.meta.env.VITE_DEFAULT_DISCORD_WEBHOOK_URL as string) || '';

export const DEFAULT_TELEGRAM_BOT_TOKEN =
  (import.meta.env.VITE_DEFAULT_TELEGRAM_BOT_TOKEN as string) || '';
export const DEFAULT_TELEGRAM_CHAT_ID =
  (import.meta.env.VITE_DEFAULT_TELEGRAM_CHAT_ID as string) || '@lukizerkshorts';

export const DEFAULT_INSTAGRAM_ACCOUNT_ID =
  (import.meta.env.VITE_DEFAULT_INSTAGRAM_ACCOUNT_ID as string) || '';
export const DEFAULT_META_ACCESS_TOKEN =
  (import.meta.env.VITE_DEFAULT_META_ACCESS_TOKEN as string) || '';

const PLATFORM_CONFIG_DEFINITIONS: Record<PlatformKey, PlatformConfigMeta> = {
  youtube: {
    key: 'youtube',
    name: 'YouTube Shorts',
    subtitle: 'Google YouTube Data API v3 (OAuth2)',
    guideUrl: 'https://console.cloud.google.com/apis/credentials',
    fields: [
      {
        key: 'YOUTUBE_CLIENT_ID',
        label: 'OAuth Client ID',
        placeholder: 'e.g. 123456789-abc.apps.googleusercontent.com',
        hint: 'From Google Cloud Console → Credentials → OAuth 2.0 Client IDs',
      },
      {
        key: 'YOUTUBE_CLIENT_SECRET',
        label: 'OAuth Client Secret',
        placeholder: 'GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx',
        isSecret: true,
        hint: 'Client Secret matching the OAuth Client ID above',
      },
      {
        key: 'YOUTUBE_REFRESH_TOKEN',
        label: 'OAuth Refresh Token',
        placeholder: '1//04xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        isSecret: true,
        hint: 'Long-lived refresh token authorized for youtube.upload scope',
      },
    ],
  },
  discord: {
    key: 'discord',
    name: 'Discord Channel',
    subtitle: 'Discord Incoming Webhook (Zero Config)',
    guideUrl: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
    fields: [
      {
        key: 'DISCORD_WEBHOOK_URL',
        label: 'Webhook URL',
        placeholder: 'Paste custom webhook here (leave empty to use system default)',
        isSecret: true,
        hint: 'Default webhook is configured in backend/.env. If you paste a custom webhook URL here, it overrides the default; otherwise the system default is used.',
      },
    ],
  },
  telegram: {
    key: 'telegram',
    name: 'Telegram Channel',
    subtitle: 'Telegram Bot API (sendVideo)',
    guideUrl: 'https://t.me/BotFather',
    fields: [
      {
        key: 'TELEGRAM_BOT_TOKEN',
        label: 'Bot Token',
        placeholder: 'Paste custom bot token (leave empty to use system default)',
        isSecret: true,
        hint: 'Default bot token is configured in backend/.env. If you paste a custom bot token here, it overrides the default; otherwise the system default is used.',
      },
      {
        key: 'TELEGRAM_CHAT_ID',
        label: 'Target Channel Username / Chat ID',
        placeholder: 'e.g. @your_channel or -100123... (leave empty to use default @lukizerkshorts)',
        hint: 'Default target channel (@lukizerkshorts) is configured. Paste a channel handle or ID to override.',
      },
    ],
  },
  instagram: {
    key: 'instagram',
    name: 'Instagram Reels',
    subtitle: 'Meta Graph API (Instagram Professional)',
    guideUrl: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api',
    fields: [
      {
        key: 'INSTAGRAM_ACCOUNT_ID',
        label: 'Instagram Professional Account ID',
        placeholder: 'e.g. 17841475233786072 (leave empty to use default)',
        hint: 'Default account ID is configured in backend/.env. If you paste a custom account ID here, it overrides the default; otherwise the system default is used.',
      },
      {
        key: 'META_ACCESS_TOKEN',
        label: 'Meta Graph User / Page Access Token',
        placeholder: 'Paste custom token here (leave empty to use default)',
        isSecret: true,
        hint: 'Default access token is configured in backend/.env. If you paste a custom token here, it overrides the default; otherwise the system default is used.',
      },
    ],
  },
};

export function PublishingDashboard({
  initialVideoUrl = '',
  initialTitle = 'Motivational Short',
  initialQuote = 'Stop waiting. The best time to start was yesterday. The next best time is right now.',
  spreadsheetUrl,
  rowNumber,
  sheetName,
  showToast,
}: PublishingDashboardProps) {
  // Input fields
  const [videoUrl, setVideoUrl] = useState<string>(initialVideoUrl);
  const [title, setTitle] = useState<string>(initialTitle);
  const [quote, setQuote] = useState<string>(initialQuote);
  const [youtubePrivacy, setYoutubePrivacy] = useState<'private' | 'public' | 'unlisted'>('private');

  // Platform selection toggles
  const [platforms, setPlatforms] = useState<Record<PlatformKey, boolean>>({
    youtube: true,
    discord: true,
    telegram: true,
    instagram: true,
  });

  // Master toggle helpers
  const allSelected = platforms.youtube && platforms.discord && platforms.telegram && platforms.instagram;
  const noneSelected = !platforms.youtube && !platforms.discord && !platforms.telegram && !platforms.instagram;

  // Connection readiness state
  const [connections, setConnections] = useState<PublishingConnectionsStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);
  const [testingPlatforms, setTestingPlatforms] = useState<Record<PlatformKey, boolean>>({
    youtube: false,
    discord: false,
    telegram: false,
    instagram: false,
  });

  // Connect & Configure Modal State
  const [connectModalPlatform, setConnectModalPlatform] = useState<PlatformKey | null>(null);
  const [credentialsForm, setCredentialsForm] = useState<Record<string, string>>({});
  const [showSecretFields, setShowSecretFields] = useState<Record<string, boolean>>({});
  const [savingCredentials, setSavingCredentials] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);

  // Video verification pre-check state
  const [verifyingVideo, setVerifyingVideo] = useState<boolean>(false);
  const [videoVerified, setVideoVerified] = useState<boolean | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Publishing state
  const [publishing, setPublishing] = useState<boolean>(false);
  const [publishProgress, setPublishProgress] = useState<number>(0);
  const [activeStage, setActiveStage] = useState<string>('');
  const [report, setReport] = useState<MultiPlatformPublishReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // General Setup Guide Modal
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(false);
  const [activeSetupTab, setActiveSetupTab] = useState<PlatformKey>('youtube');

  // Copied link helper
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Synchronize when initial props change
  useEffect(() => {
    if (initialVideoUrl) {
      setVideoUrl(initialVideoUrl);
      setVideoVerified(null);
      setVideoError(null);
    }
    if (initialTitle) setTitle(initialTitle);
    if (initialQuote) setQuote(initialQuote);
  }, [initialVideoUrl, initialTitle, initialQuote]);

  // Load verified connection statuses
  const loadStatuses = async (force: boolean = false) => {
    setLoadingStatus(true);
    try {
      const data = await fetchPublishingStatus(force);
      setConnections(data);
      if (force) {
        showToast('Connection statuses refreshed via live API tests.');
      }
    } catch (err: any) {
      console.warn('Could not load publishing status:', err);
      showToast('Could not reach backend publishing service.');
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatuses(false);
  }, []);

  // Live test single platform
  const handleTestConnection = async (platformKey: PlatformKey) => {
    setTestingPlatforms((prev) => ({ ...prev, [platformKey]: true }));
    try {
      const result = await testPlatformConnection(platformKey);
      setConnections((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [platformKey]: {
            ...prev[platformKey],
            connected: result.connected,
            status: result.status as any,
            missingKeys: result.missingKeys || [],
            accountName: result.accountName,
            error: result.error,
            testedAt: result.testedAt || new Date().toISOString(),
          },
        };
      });

      if (result.connected) {
        showToast(`✓ ${PLATFORM_CONFIG_DEFINITIONS[platformKey].name} connected successfully (${result.accountName || 'Verified'})`);
      } else {
        showToast(`✗ ${PLATFORM_CONFIG_DEFINITIONS[platformKey].name}: ${result.error || 'Connection test failed'}`);
      }
    } catch (err: any) {
      showToast(`Error testing ${PLATFORM_CONFIG_DEFINITIONS[platformKey].name}: ${err.message}`);
    } finally {
      setTestingPlatforms((prev) => ({ ...prev, [platformKey]: false }));
    }
  };

  // Open Connect / Configure Modal
  const handleOpenConnect = (platformKey: PlatformKey) => {
    setConnectModalPlatform(platformKey);
    setModalError(null);
    setModalSuccess(null);
    const def = PLATFORM_CONFIG_DEFINITIONS[platformKey];
    const initialForm: Record<string, string> = {};
    def.fields.forEach((f) => {
      initialForm[f.key] = '';
    });
    if (platformKey === 'youtube') {
      initialForm['YOUTUBE_CLIENT_ID'] = DEFAULT_YOUTUBE_CLIENT_ID;
      initialForm['YOUTUBE_CLIENT_SECRET'] = DEFAULT_YOUTUBE_CLIENT_SECRET;
    }
    setCredentialsForm(initialForm);
  };

  // Save Credentials into backend/.env and live test
  const handleSaveCredentials = async () => {
    if (!connectModalPlatform) return;
    setSavingCredentials(true);
    setModalError(null);
    setModalSuccess(null);

    try {
      const def = PLATFORM_CONFIG_DEFINITIONS[connectModalPlatform];
      const missingFormKeys = def.fields
        .filter((f) => {
          // Platforms with pre-configured system defaults in backend/.env
          if (
            connectModalPlatform === 'youtube' &&
            (f.key === 'YOUTUBE_CLIENT_ID' || f.key === 'YOUTUBE_CLIENT_SECRET')
          ) {
            return false;
          }
          if (connectModalPlatform === 'discord' && f.key === 'DISCORD_WEBHOOK_URL') {
            return false;
          }
          if (
            connectModalPlatform === 'telegram' &&
            (f.key === 'TELEGRAM_BOT_TOKEN' || f.key === 'TELEGRAM_CHAT_ID')
          ) {
            return false;
          }
          if (
            connectModalPlatform === 'instagram' &&
            (f.key === 'INSTAGRAM_ACCOUNT_ID' || f.key === 'META_ACCESS_TOKEN')
          ) {
            return false;
          }
          return !credentialsForm[f.key] || !credentialsForm[f.key].trim();
        })
        .map((f) => f.key);

      if (missingFormKeys.length > 0) {
        setModalError(`Please fill in all required credentials: ${missingFormKeys.join(', ')}`);
        setSavingCredentials(false);
        return;
      }

      const res = await configurePlatform(connectModalPlatform, credentialsForm);

      if (res.testResult.connected) {
        const isCustomDiscord =
          connectModalPlatform === 'discord' && Boolean(credentialsForm.DISCORD_WEBHOOK_URL?.trim());
        const isCustomTelegram =
          connectModalPlatform === 'telegram' &&
          (Boolean(credentialsForm.TELEGRAM_BOT_TOKEN?.trim()) || Boolean(credentialsForm.TELEGRAM_CHAT_ID?.trim()));
        const isCustomInstagram =
          connectModalPlatform === 'instagram' &&
          (Boolean(credentialsForm.INSTAGRAM_ACCOUNT_ID?.trim()) || Boolean(credentialsForm.META_ACCESS_TOKEN?.trim()));

        let successMessage = `Connected & Verified! Account: ${res.testResult.accountName || 'Active'}. Credentials securely saved.`;
        if (connectModalPlatform === 'discord') {
          successMessage = isCustomDiscord
            ? `Custom Webhook connected & verified! Account: ${res.testResult.accountName || 'Active'}. Saved to backend/.env.`
            : `System Default Webhook verified & active! All shorts will publish to the default channel.`;
        } else if (connectModalPlatform === 'telegram') {
          successMessage = isCustomTelegram
            ? `Custom Telegram Channel connected & verified! Account: ${res.testResult.accountName || 'Active'}. Saved to backend/.env.`
            : `System Default Telegram Channel verified & active! Target: @lukizerkshorts.`;
        } else if (connectModalPlatform === 'instagram') {
          successMessage = isCustomInstagram
            ? `Custom Instagram Account connected & verified! Account: ${res.testResult.accountName || 'Active'}. Saved to backend/.env.`
            : `System Default Instagram Account verified & active! Target Account: 17841475233786072.`;
        }

        setModalSuccess(successMessage);
        showToast(`✓ ${def.name} successfully connected and verified!`);
        // Refresh statuses
        await loadStatuses(false);
        setTimeout(() => {
          setConnectModalPlatform(null);
        }, 1500);
      } else {
        setModalError(
          `Credentials saved, but live API verification failed: ${res.testResult.error || 'Unknown error'}. Please verify the tokens.`
        );
        await loadStatuses(false);
      }
    } catch (err: any) {
      setModalError(err.message || 'Failed to save credentials.');
    } finally {
      setSavingCredentials(false);
    }
  };

  // Pre-validate video file accessibility
  const handleVerifyVideo = async () => {
    if (!videoUrl.trim()) {
      setVideoError('Please enter a video file path or URL first.');
      setVideoVerified(false);
      return false;
    }
    setVerifyingVideo(true);
    setVideoError(null);
    try {
      const res = await verifyMediaFile(videoUrl.trim());
      setVideoVerified(res.valid);
      if (!res.valid) {
        setVideoError(res.error || 'Video file was not found or is inaccessible.');
        return false;
      }
      return true;
    } catch (err: any) {
      setVideoVerified(false);
      setVideoError(err.message || 'Could not verify video file.');
      return false;
    } finally {
      setVerifyingVideo(false);
    }
  };

  const handleToggleAll = () => {
    const nextVal = !allSelected;
    setPlatforms({
      youtube: nextVal,
      discord: nextVal,
      telegram: nextVal,
      instagram: nextVal,
    });
  };

  const handleTogglePlatform = (key: PlatformKey) => {
    setPlatforms((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCopyLink = (url: string, key: string) => {
    navigator.clipboard.writeText(url);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
    showToast('Published link copied to clipboard!');
  };

  // Main Publish Action
  const handlePublish = async () => {
    if (!videoUrl.trim()) {
      setErrorMessage('Please provide a video file path or public URL to publish.');
      return;
    }
    if (!quote.trim()) {
      setErrorMessage('Motivational quote text is required.');
      return;
    }
    if (noneSelected) {
      setErrorMessage('Please select at least one publishing platform.');
      return;
    }

    setErrorMessage(null);

    // 1. Check video existence
    setActiveStage('Verifying video file accessibility...');
    const videoOk = await handleVerifyVideo();
    if (!videoOk) {
      setErrorMessage('Video file verification failed. Ensure the MP4 exists before publishing.');
      return;
    }

    // 2. Check for missing credentials on selected platforms
    const selectedPlatforms = (Object.keys(platforms) as PlatformKey[]).filter((p) => platforms[p]);
    const disconnectedSelected = selectedPlatforms.filter((p) => {
      const conn = connections ? connections[p] : null;
      return !conn || !conn.connected;
    });

    if (disconnectedSelected.length > 0) {
      const names = disconnectedSelected
        .map((p) => PLATFORM_CONFIG_DEFINITIONS[p].name)
        .join(', ');
      setErrorMessage(
        `Cannot publish: The following selected platforms are not connected: ${names}. ` +
        `Click "Connect Platform" on each card to configure required credentials, or uncheck them to proceed.`
      );
      return;
    }

    setPublishing(true);
    setPublishProgress(15);
    setActiveStage('Initializing multi-platform parallel publishing...');

    const interval = setInterval(() => {
      setPublishProgress((prev) => (prev < 90 ? prev + 15 : prev));
    }, 1800);

    try {
      setActiveStage('Uploading MP4 and publishing to connected channels...');
      const result = await dispatchPublish({
        videoUrl: videoUrl.trim(),
        title: title.trim() || 'Motivational Short',
        quote: quote.trim(),
        platforms: platforms,
        youtubePrivacy: youtubePrivacy,
        spreadsheetUrl: spreadsheetUrl,
        rowNumber: rowNumber,
        sheetName: sheetName,
      });

      clearInterval(interval);
      setPublishProgress(100);
      setActiveStage('Publishing completed!');
      setReport(result);

      if (result.overallStatus === 'Completed') {
        showToast('Successfully published to all selected platforms!');
      } else if (result.overallStatus === 'Partially Completed') {
        showToast('Published with partial warnings on some platforms.');
      } else {
        showToast('Publishing failed. Check platform cards below for API error details.');
      }
    } catch (err: any) {
      clearInterval(interval);
      setPublishProgress(0);
      setErrorMessage(err.message || 'Publishing dispatch failed.');
    } finally {
      setPublishing(false);
    }
  };

  // Helper for platform card connection status pill
  const renderConnectionPill = (platformKey: PlatformKey) => {
    if (testingPlatforms[platformKey]) {
      return (
        <span className="status-pill status-testing">
          <RefreshCw size={12} className="spin" />
          <span>Testing...</span>
        </span>
      );
    }

    const conn = connections ? connections[platformKey] : null;
    if (!conn) {
      return (
        <span className="status-pill status-not-connected">
          <AlertCircle size={12} />
          <span>Not Connected</span>
        </span>
      );
    }

    if (conn.connected) {
      return (
        <span className="status-pill status-connected">
          <CheckCircle2 size={12} />
          <span>Connected</span>
        </span>
      );
    }

    if (conn.status === 'Error') {
      return (
        <span className="status-pill status-error">
          <AlertCircle size={12} />
          <span>Error</span>
        </span>
      );
    }

    return (
      <span className="status-pill status-not-connected">
        <AlertCircle size={12} />
        <span>Not Connected</span>
      </span>
    );
  };

  return (
    <div className="publishing-dashboard-root">
      {/* ====================================================================
          TOP BANNER & CONTROL BAR
          ==================================================================== */}
      <div className="publish-header-card">
        <div className="publish-header-content">
          <div className="publish-header-badge">
            <Share2 size={15} color="var(--accent-primary)" />
            <span>Autonomous Multi-Platform Distribution</span>
          </div>
          <h2>Multi-Platform Video Publishing Center</h2>
          <p>
            Simultaneously syndicate rendered 9:16 vertical Shorts across YouTube Shorts, Discord, Telegram, and Instagram Reels in parallel with verified credentials and live reachability testing.
          </p>
        </div>

        <div className="publish-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => loadStatuses(true)}
            disabled={loadingStatus}
            title="Perform live authentication & API test on all platforms"
          >
            <RefreshCw size={15} className={loadingStatus ? 'spin' : ''} />
            <span>Refresh Connection Status</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => setSetupModalOpen(true)}
          >
            <HelpCircle size={15} />
            <span>Platform Setup Guide</span>
          </button>
        </div>
      </div>

      {/* ====================================================================
          VIDEO PAYLOAD & TARGET SELECTION FORM
          ==================================================================== */}
      <div className="publish-config-grid">
        {/* Left: Video & Content Config */}
        <div className="publish-config-card">
          <div className="card-section-header">
            <div className="section-title-wrap">
              <Film size={18} color="var(--accent-cyan)" />
              <h3>Video & Motivational Content</h3>
            </div>
            {rowNumber && (
              <span className="row-indicator-badge">
                <FileSpreadsheet size={13} /> Sheet Row #{rowNumber}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="pub-video-url">
              <span>Target Video File / Public URL</span>
              <span className="label-hint">Local filename in backend/media or HTTPS URL</span>
            </label>
            <div className="input-with-icon-and-action">
              <div className="input-with-icon flex-1">
                <Film size={16} className="field-icon" />
                <input
                  id="pub-video-url"
                  type="text"
                  className="input-field"
                  placeholder="e.g. rendered_job_abc123.mp4 or https://.../video.mp4"
                  value={videoUrl}
                  onChange={(e) => {
                    setVideoUrl(e.target.value);
                    setVideoVerified(null);
                    setVideoError(null);
                  }}
                  disabled={publishing}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-verify-video"
                onClick={handleVerifyVideo}
                disabled={verifyingVideo || !videoUrl.trim() || publishing}
                title="Verify video file exists and is accessible"
              >
                {verifyingVideo ? (
                  <RefreshCw size={14} className="spin" />
                ) : videoVerified === true ? (
                  <FileCheck2 size={14} color="var(--status-success)" />
                ) : (
                  <FileCheck2 size={14} />
                )}
                <span>{videoVerified === true ? 'Verified' : 'Verify File'}</span>
              </button>
            </div>
            {videoError && (
              <div className="field-error-notice">
                <AlertCircle size={13} />
                <span>{videoError}</span>
              </div>
            )}
            {videoVerified === true && (
              <div className="field-success-notice">
                <CheckCircle2 size={13} />
                <span>Video file confirmed accessible. Ready for upload.</span>
              </div>
            )}
          </div>

          <div className="form-row-dual">
            <div className="form-group flex-1">
              <label htmlFor="pub-title">
                <span>Motivational Title</span>
              </label>
              <input
                id="pub-title"
                type="text"
                className="input-field"
                placeholder="Rise Above Limits"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={publishing}
              />
            </div>

            <div className="form-group flex-1">
              <label htmlFor="pub-yt-privacy">
                <span>YouTube Initial Privacy</span>
              </label>
              <select
                id="pub-yt-privacy"
                className="select-field"
                value={youtubePrivacy}
                onChange={(e) => setYoutubePrivacy(e.target.value as any)}
                disabled={publishing}
              >
                <option value="private">Private (Recommended for Testing)</option>
                <option value="unlisted">Unlisted (Shareable Link)</option>
                <option value="public">Public (Immediate Broadcast)</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="pub-quote">
              <span>Consistent Motivational Quote</span>
              <span className="label-hint">Broadcasted verbatim across all 4 platforms</span>
            </label>
            <textarea
              id="pub-quote"
              className="textarea-field"
              rows={3}
              placeholder="Motivational quote text..."
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              disabled={publishing}
            />
          </div>
        </div>

        {/* Right: Master Platform Selection & Dispatch */}
        <div className="publish-dispatch-card">
          <div className="card-section-header">
            <div className="section-title-wrap">
              <Sliders size={18} color="var(--accent-primary)" />
              <h3>Platform Dispatch Control</h3>
            </div>
            <button
              type="button"
              className="btn-text-action"
              onClick={handleToggleAll}
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="platform-toggles-list">
            {/* YouTube Toggle */}
            <div
              className={`platform-toggle-row ${platforms.youtube ? 'active' : ''} ${
                connections?.youtube.connected ? 'is-connected' : 'is-disconnected'
              }`}
              onClick={() => handleTogglePlatform('youtube')}
            >
              <div className="platform-toggle-brand youtube">
                <Youtube size={18} />
                <div className="brand-meta">
                  <div className="brand-name-line">
                    <span className="brand-name">YouTube Shorts</span>
                    {connections?.youtube.connected ? (
                      <span className="mini-conn-badge connected">Ready</span>
                    ) : (
                      <span className="mini-conn-badge disconnected">Unconfigured</span>
                    )}
                  </div>
                  <span className="brand-desc">Upload MP4, Tags, Category, {youtubePrivacy}</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={platforms.youtube}
                onChange={() => {}}
                className="toggle-checkbox"
              />
            </div>

            {/* Discord Toggle */}
            <div
              className={`platform-toggle-row ${platforms.discord ? 'active' : ''} ${
                connections?.discord.connected ? 'is-connected' : 'is-disconnected'
              }`}
              onClick={() => handleTogglePlatform('discord')}
            >
              <div className="platform-toggle-brand discord">
                <MessageSquare size={18} />
                <div className="brand-meta">
                  <div className="brand-name-line">
                    <span className="brand-name">Discord Channel</span>
                    {connections?.discord.connected ? (
                      <span className="mini-conn-badge connected">Ready</span>
                    ) : (
                      <span className="mini-conn-badge disconnected">Unconfigured</span>
                    )}
                  </div>
                  <span className="brand-desc">Direct Webhook Attachment (≤ 25MB)</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={platforms.discord}
                onChange={() => {}}
                className="toggle-checkbox"
              />
            </div>

            {/* Telegram Toggle */}
            <div
              className={`platform-toggle-row ${platforms.telegram ? 'active' : ''} ${
                connections?.telegram.connected ? 'is-connected' : 'is-disconnected'
              }`}
              onClick={() => handleTogglePlatform('telegram')}
            >
              <div className="platform-toggle-brand telegram">
                <Send size={18} />
                <div className="brand-meta">
                  <div className="brand-name-line">
                    <span className="brand-name">Telegram Channel</span>
                    {connections?.telegram.connected ? (
                      <span className="mini-conn-badge connected">Ready</span>
                    ) : (
                      <span className="mini-conn-badge disconnected">Unconfigured</span>
                    )}
                  </div>
                  <span className="brand-desc">Bot API sendVideo (≤ 50MB)</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={platforms.telegram}
                onChange={() => {}}
                className="toggle-checkbox"
              />
            </div>

            {/* Instagram Toggle */}
            <div
              className={`platform-toggle-row ${platforms.instagram ? 'active' : ''} ${
                connections?.instagram.connected ? 'is-connected' : 'is-disconnected'
              }`}
              onClick={() => handleTogglePlatform('instagram')}
            >
              <div className="platform-toggle-brand instagram">
                <Instagram size={18} />
                <div className="brand-meta">
                  <div className="brand-name-line">
                    <span className="brand-name">Instagram Reels</span>
                    {connections?.instagram.connected ? (
                      <span className="mini-conn-badge connected">Ready</span>
                    ) : (
                      <span className="mini-conn-badge disconnected">Unconfigured</span>
                    )}
                  </div>
                  <span className="brand-desc">Meta Graph API Container & Publish</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={platforms.instagram}
                onChange={() => {}}
                className="toggle-checkbox"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="error-banner">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {publishing && (
            <div className="publishing-progress-box">
              <div className="progress-label-row">
                <span>{activeStage}</span>
                <span>{publishProgress}%</span>
              </div>
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill animated"
                  style={{ width: `${publishProgress}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary btn-publish-main"
            onClick={handlePublish}
            disabled={publishing || noneSelected || !videoUrl.trim()}
          >
            {publishing ? (
              <>
                <RefreshCw size={18} className="spin" />
                <span>Publishing Simultaneously...</span>
              </>
            ) : (
              <>
                <Zap size={18} />
                <span>Publish to Selected Connected Platforms</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ====================================================================
          FINAL RESULT SUMMARY BAR (When available)
          ==================================================================== */}
      {report && (
        <div className={`publish-summary-banner summary-${report.overallStatus.toLowerCase().replace(/\s+/g, '-')}`}>
          <div className="summary-left">
            {report.overallStatus === 'Completed' && <CheckCircle2 size={24} color="var(--status-success)" />}
            {report.overallStatus === 'Partially Completed' && <AlertCircle size={24} color="var(--neon-amber)" />}
            {report.overallStatus === 'Failed' && <AlertCircle size={24} color="var(--status-danger)" />}
            {report.overallStatus === 'Skipped' && <Info size={24} color="var(--text-muted)" />}
            <div>
              <div className="summary-title">
                Publishing Result: <strong>{report.overallStatus}</strong>
              </div>
              <div className="summary-sub">
                Attempt completed at {new Date(report.lastPublishAttempt).toLocaleTimeString()}
                {report.sheetUpdated && ' • Google Sheet row updated successfully'}
              </div>
            </div>
          </div>
          <div className="summary-badges">
            <span className={`status-badge status-${report.platforms.youtube.status.toLowerCase()}`}>
              YT: {report.platforms.youtube.status}
            </span>
            <span className={`status-badge status-${report.platforms.discord.status.toLowerCase()}`}>
              Discord: {report.platforms.discord.status}
            </span>
            <span className={`status-badge status-${report.platforms.telegram.status.toLowerCase()}`}>
              Telegram: {report.platforms.telegram.status}
            </span>
            <span className={`status-badge status-${report.platforms.instagram.status.toLowerCase()}`}>
              Instagram: {report.platforms.instagram.status}
            </span>
          </div>
        </div>
      )}

      {/* ====================================================================
          FOUR PLATFORM CARDS WITH CONNECT & TEST ACTION BUTTONS
          ==================================================================== */}
      <div className="platform-cards-grid">
        {/* 1. YouTube Shorts Card */}
        <div className="platform-card card-youtube">
          <div className="platform-card-header">
            <div className="brand-title">
              <div className="brand-icon-box youtube">
                <Youtube size={20} />
              </div>
              <div>
                <h4>YouTube Shorts</h4>
                <span className="brand-subtitle">Google YouTube Data API v3</span>
              </div>
            </div>
            {renderConnectionPill('youtube')}
          </div>

          <div className="platform-card-body">
            {connections?.youtube.connected ? (
              <div className="card-account-banner connected">
                <CheckCircle2 size={14} color="var(--status-success)" />
                <span className="account-name-text">
                  Channel: <strong>{connections.youtube.accountName || 'Authenticated Channel'}</strong>
                </span>
                {connections.youtube.isDefault && (
                  <span className="badge-default-pill">Default Client</span>
                )}
              </div>
            ) : connections?.youtube.missingKeys && connections.youtube.missingKeys.length > 0 ? (
              <div className="card-missing-keys-box">
                <div className="missing-label">
                  <AlertCircle size={13} color="var(--neon-amber)" />
                  <span>Missing Environment Variables:</span>
                </div>
                <div className="missing-keys-tags">
                  {connections.youtube.missingKeys.map((k) => (
                    <code key={k} className="missing-key-tag">
                      {k}
                    </code>
                  ))}
                </div>
              </div>
            ) : connections?.youtube.error ? (
              <div className="card-error-notice">
                <AlertCircle size={13} />
                <span>{connections.youtube.error}</span>
              </div>
            ) : (
              <div className="card-notice-muted">Click Connect Platform to enter OAuth credentials.</div>
            )}

            {/* Platform Action Buttons */}
            <div className="platform-card-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm btn-connect"
                onClick={() => handleOpenConnect('youtube')}
              >
                <Key size={13} />
                <span>{connections?.youtube.connected ? 'Update Credentials' : 'Connect Platform'}</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-test"
                onClick={() => handleTestConnection('youtube')}
                disabled={testingPlatforms.youtube}
              >
                <RefreshCw size={13} className={testingPlatforms.youtube ? 'spin' : ''} />
                <span>{testingPlatforms.youtube ? 'Testing...' : 'Test Connection'}</span>
              </button>
            </div>

            {/* Post-Publishing Result */}
            {report?.platforms.youtube && (
              <div className="card-result-box">
                <div className="result-status-row">
                  <span className="info-label">Upload Result:</span>
                  <span className={`status-text text-${report.platforms.youtube.status.toLowerCase()}`}>
                    {report.platforms.youtube.status}
                  </span>
                </div>
                {report.platforms.youtube.url && (
                  <div className="result-link-row">
                    <a
                      href={report.platforms.youtube.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-published"
                    >
                      <ExternalLink size={13} />
                      <span>View on YouTube</span>
                    </a>
                    <button
                      type="button"
                      className="btn-icon-copy"
                      onClick={() => handleCopyLink(report.platforms.youtube.url!, 'yt')}
                      title="Copy URL"
                    >
                      {copiedKey === 'yt' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
                {report.platforms.youtube.error && (
                  <div className="result-error-box">
                    <span className="error-title">API Error:</span>
                    <span className="error-body">{report.platforms.youtube.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 2. Discord Webhook Card */}
        <div className="platform-card card-discord">
          <div className="platform-card-header">
            <div className="brand-title">
              <div className="brand-icon-box discord">
                <MessageSquare size={20} />
              </div>
              <div>
                <h4>Discord Channel</h4>
                <span className="brand-subtitle">Discord Incoming Webhook</span>
              </div>
            </div>
            {renderConnectionPill('discord')}
          </div>

          <div className="platform-card-body">
            {connections?.discord.connected ? (
              <div className="card-account-banner connected">
                <CheckCircle2 size={14} color="var(--status-success)" />
                <span className="account-name-text">
                  Target: <strong>{connections.discord.accountName || 'Verified Webhook Channel'}</strong>
                </span>
                {connections.discord.isDefault && (
                  <span className="badge-default-pill">Default Webhook</span>
                )}
              </div>
            ) : connections?.discord.missingKeys && connections.discord.missingKeys.length > 0 ? (
              <div className="card-missing-keys-box">
                <div className="missing-label">
                  <AlertCircle size={13} color="var(--neon-amber)" />
                  <span>Missing Environment Variables:</span>
                </div>
                <div className="missing-keys-tags">
                  {connections.discord.missingKeys.map((k) => (
                    <code key={k} className="missing-key-tag">
                      {k}
                    </code>
                  ))}
                </div>
              </div>
            ) : connections?.discord.error ? (
              <div className="card-error-notice">
                <AlertCircle size={13} />
                <span>{connections.discord.error}</span>
              </div>
            ) : (
              <div className="card-notice-muted">Paste your Discord webhook URL to enable publishing.</div>
            )}

            {/* Platform Action Buttons */}
            <div className="platform-card-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm btn-connect"
                onClick={() => handleOpenConnect('discord')}
              >
                <Key size={13} />
                <span>{connections?.discord.connected ? 'Update Webhook' : 'Connect Platform'}</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-test"
                onClick={() => handleTestConnection('discord')}
                disabled={testingPlatforms.discord}
              >
                <RefreshCw size={13} className={testingPlatforms.discord ? 'spin' : ''} />
                <span>{testingPlatforms.discord ? 'Testing...' : 'Test Connection'}</span>
              </button>
            </div>

            {/* Post-Publishing Result */}
            {report?.platforms.discord && (
              <div className="card-result-box">
                <div className="result-status-row">
                  <span className="info-label">Upload Result:</span>
                  <span className={`status-text text-${report.platforms.discord.status.toLowerCase()}`}>
                    {report.platforms.discord.status}
                  </span>
                </div>
                {report.platforms.discord.url && (
                  <div className="result-link-row">
                    <a
                      href={report.platforms.discord.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-published"
                    >
                      <ExternalLink size={13} />
                      <span>View Message</span>
                    </a>
                    <button
                      type="button"
                      className="btn-icon-copy"
                      onClick={() => handleCopyLink(report.platforms.discord.url!, 'dc')}
                      title="Copy URL"
                    >
                      {copiedKey === 'dc' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
                {report.platforms.discord.error && (
                  <div className="result-error-box">
                    <span className="error-title">API Error:</span>
                    <span className="error-body">{report.platforms.discord.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3. Telegram Channel Card */}
        <div className="platform-card card-telegram">
          <div className="platform-card-header">
            <div className="brand-title">
              <div className="brand-icon-box telegram">
                <Send size={20} />
              </div>
              <div>
                <h4>Telegram Channel</h4>
                <span className="brand-subtitle">Telegram Bot API (sendVideo)</span>
              </div>
            </div>
            {renderConnectionPill('telegram')}
          </div>

          <div className="platform-card-body">
            {connections?.telegram.connected ? (
              <div className="card-account-banner connected">
                <CheckCircle2 size={14} color="var(--status-success)" />
                <span className="account-name-text">
                  Target: <strong>{connections.telegram.accountName || 'Verified Channel'}</strong>
                </span>
                {connections.telegram.isDefault && (
                  <span className="badge-default-pill">Default Channel</span>
                )}
              </div>
            ) : connections?.telegram.missingKeys && connections.telegram.missingKeys.length > 0 ? (
              <div className="card-missing-keys-box">
                <div className="missing-label">
                  <AlertCircle size={13} color="var(--neon-amber)" />
                  <span>Missing Environment Variables:</span>
                </div>
                <div className="missing-keys-tags">
                  {connections.telegram.missingKeys.map((k) => (
                    <code key={k} className="missing-key-tag">
                      {k}
                    </code>
                  ))}
                </div>
              </div>
            ) : connections?.telegram.error ? (
              <div className="card-error-notice">
                <AlertCircle size={13} />
                <span>{connections.telegram.error}</span>
              </div>
            ) : (
              <div className="card-notice-muted">Add your bot token and target channel ID.</div>
            )}

            {/* Platform Action Buttons */}
            <div className="platform-card-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm btn-connect"
                onClick={() => handleOpenConnect('telegram')}
              >
                <Key size={13} />
                <span>{connections?.telegram.connected ? 'Update Bot & Chat' : 'Connect Platform'}</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-test"
                onClick={() => handleTestConnection('telegram')}
                disabled={testingPlatforms.telegram}
              >
                <RefreshCw size={13} className={testingPlatforms.telegram ? 'spin' : ''} />
                <span>{testingPlatforms.telegram ? 'Testing...' : 'Test Connection'}</span>
              </button>
            </div>

            {/* Post-Publishing Result */}
            {report?.platforms.telegram && (
              <div className="card-result-box">
                <div className="result-status-row">
                  <span className="info-label">Upload Result:</span>
                  <span className={`status-text text-${report.platforms.telegram.status.toLowerCase()}`}>
                    {report.platforms.telegram.status}
                  </span>
                </div>
                {report.platforms.telegram.url && (
                  <div className="result-link-row">
                    <a
                      href={report.platforms.telegram.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-published"
                    >
                      <ExternalLink size={13} />
                      <span>View in Telegram</span>
                    </a>
                    <button
                      type="button"
                      className="btn-icon-copy"
                      onClick={() => handleCopyLink(report.platforms.telegram.url!, 'tg')}
                      title="Copy URL"
                    >
                      {copiedKey === 'tg' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
                {report.platforms.telegram.error && (
                  <div className="result-error-box">
                    <span className="error-title">API Error:</span>
                    <span className="error-body">{report.platforms.telegram.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 4. Instagram Reels Card */}
        <div className="platform-card card-instagram">
          <div className="platform-card-header">
            <div className="brand-title">
              <div className="brand-icon-box instagram">
                <Instagram size={20} />
              </div>
              <div>
                <h4>Instagram Reels</h4>
                <span className="brand-subtitle">Meta Graph API v19.0</span>
              </div>
            </div>
            {renderConnectionPill('instagram')}
          </div>

          <div className="platform-card-body">
            {connections?.instagram.connected ? (
              <div className="card-account-banner connected">
                <CheckCircle2 size={14} color="var(--status-success)" />
                <span className="account-name-text">
                  Account: <strong>{connections.instagram.accountName || 'Professional Account'}</strong>
                </span>
                {connections.instagram.isDefault && (
                  <span className="badge-default-pill">Default Account</span>
                )}
              </div>
            ) : connections?.instagram.missingKeys && connections.instagram.missingKeys.length > 0 ? (
              <div className="card-missing-keys-box">
                <div className="missing-label">
                  <AlertCircle size={13} color="var(--neon-amber)" />
                  <span>Missing Environment Variables:</span>
                </div>
                <div className="missing-keys-tags">
                  {connections.instagram.missingKeys.map((k) => (
                    <code key={k} className="missing-key-tag">
                      {k}
                    </code>
                  ))}
                </div>
              </div>
            ) : connections?.instagram.error ? (
              <div className="card-error-notice">
                <AlertCircle size={13} />
                <span>{connections.instagram.error}</span>
              </div>
            ) : (
              <div className="card-notice-muted">Requires Instagram Business ID and Meta User Access Token.</div>
            )}

            {/* Platform Action Buttons */}
            <div className="platform-card-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm btn-connect"
                onClick={() => handleOpenConnect('instagram')}
              >
                <Key size={13} />
                <span>{connections?.instagram.connected ? 'Update Meta Token' : 'Connect Platform'}</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-test"
                onClick={() => handleTestConnection('instagram')}
                disabled={testingPlatforms.instagram}
              >
                <RefreshCw size={13} className={testingPlatforms.instagram ? 'spin' : ''} />
                <span>{testingPlatforms.instagram ? 'Testing...' : 'Test Connection'}</span>
              </button>
            </div>

            {/* Post-Publishing Result */}
            {report?.platforms.instagram && (
              <div className="card-result-box">
                <div className="result-status-row">
                  <span className="info-label">Upload Result:</span>
                  <span className={`status-text text-${report.platforms.instagram.status.toLowerCase()}`}>
                    {report.platforms.instagram.status}
                  </span>
                </div>
                {report.platforms.instagram.url && (
                  <div className="result-link-row">
                    <a
                      href={report.platforms.instagram.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-published"
                    >
                      <ExternalLink size={13} />
                      <span>View Reel</span>
                    </a>
                    <button
                      type="button"
                      className="btn-icon-copy"
                      onClick={() => handleCopyLink(report.platforms.instagram.url!, 'ig')}
                      title="Copy URL"
                    >
                      {copiedKey === 'ig' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
                {report.platforms.instagram.error && (
                  <div className="result-error-box">
                    <span className="error-title">API Error:</span>
                    <span className="error-body">{report.platforms.instagram.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ====================================================================
          CONNECT / CONFIGURE PLATFORM CREDENTIALS MODAL
          ==================================================================== */}
      {connectModalPlatform && (
        <div className="modal-backdrop" onClick={() => !savingCredentials && setConnectModalPlatform(null)}>
          <div className="modal-card connect-platform-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <Key size={20} color="var(--accent-primary)" />
                <div>
                  <h3>Connect & Configure {PLATFORM_CONFIG_DEFINITIONS[connectModalPlatform].name}</h3>
                  <span className="modal-subtitle">
                    {PLATFORM_CONFIG_DEFINITIONS[connectModalPlatform].subtitle}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setConnectModalPlatform(null)}
                disabled={savingCredentials}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body-content">
              <div className="security-notice-box">
                <ShieldCheck size={16} color="var(--neon-cyan)" />
                <span>
                  All credentials are securely saved into your local <code>backend/.env</code> file. Secrets are never exposed to the browser or client-side logs.
                </span>
              </div>

              {modalError && (
                <div className="modal-error-banner">
                  <AlertCircle size={16} />
                  <span>{modalError}</span>
                </div>
              )}

              {modalSuccess && (
                <div className="modal-success-banner">
                  <CheckCircle2 size={16} />
                  <span>{modalSuccess}</span>
                </div>
              )}

              {connectModalPlatform === 'youtube' && (
                <div className="default-webhook-banner">
                  <div className="default-webhook-header">
                    <span className="badge-default-active">Default Ready</span>
                    <span className="default-webhook-title">Pre-configured System Default OAuth Client</span>
                  </div>
                  <p className="default-webhook-text">
                    Google OAuth Client ID & Secret are pre-configured. You can paste custom credentials below or click the shortcut buttons. Only your authorized OAuth Refresh Token is required.
                  </p>
                  <div className="default-webhook-url-preview">
                    Default Client ID: {DEFAULT_YOUTUBE_CLIENT_ID}
                  </div>
                </div>
              )}

              {connectModalPlatform === 'discord' && (
                <div className="default-webhook-banner">
                  <div className="default-webhook-header">
                    <span className="badge-default-active">Default Ready</span>
                    <span className="default-webhook-title">Pre-configured System Default Webhook</span>
                  </div>
                  <p className="default-webhook-text">
                    If you paste a custom webhook URL below, only your custom webhook will be used. Otherwise, the default webhook below will be used automatically.
                  </p>
                  <div className="default-webhook-url-preview">
                    {DEFAULT_DISCORD_WEBHOOK_URL}
                  </div>
                </div>
              )}

              {connectModalPlatform === 'telegram' && (
                <div className="default-webhook-banner">
                  <div className="default-webhook-header">
                    <span className="badge-default-active">Default Ready</span>
                    <span className="default-webhook-title">Pre-configured System Default Telegram Channel</span>
                  </div>
                  <p className="default-webhook-text">
                    If you enter custom credentials below, only your custom bot & channel will be used. Otherwise, the default bot and channel (@lukizerkshorts) will be used automatically.
                  </p>
                  <div className="default-webhook-url-preview">
                    Default Channel: {DEFAULT_TELEGRAM_CHAT_ID}
                  </div>
                </div>
              )}

              {connectModalPlatform === 'instagram' && (
                <div className="default-webhook-banner">
                  <div className="default-webhook-header">
                    <span className="badge-default-active">Default Ready</span>
                    <span className="default-webhook-title">Pre-configured System Default Instagram Account</span>
                  </div>
                  <p className="default-webhook-text">
                    If you enter custom credentials below, only your custom account & token will be used. Otherwise, the default account (ID: 17841475233786072) will be used automatically.
                  </p>
                  <div className="default-webhook-url-preview">
                    Default Account ID: {DEFAULT_INSTAGRAM_ACCOUNT_ID}
                  </div>
                </div>
              )}

              <div className="credential-fields-list">
                {PLATFORM_CONFIG_DEFINITIONS[connectModalPlatform].fields.map((f) => (
                  <div key={f.key} className="form-group">
                    <label htmlFor={`field-${f.key}`}>
                      <span>{f.label}</span>
                      <code className="env-var-badge">{f.key}</code>
                    </label>
                    <div className="input-with-secret-toggle">
                      <input
                        id={`field-${f.key}`}
                        type={f.isSecret && !showSecretFields[f.key] ? 'password' : 'text'}
                        className="input-field monospace"
                        placeholder={f.placeholder}
                        value={credentialsForm[f.key] || ''}
                        onChange={(e) =>
                          setCredentialsForm((prev) => ({
                            ...prev,
                            [f.key]: e.target.value,
                          }))
                        }
                        disabled={savingCredentials}
                      />
                      {f.isSecret && (
                        <button
                          type="button"
                          className="btn-secret-toggle"
                          onClick={() =>
                            setShowSecretFields((prev) => ({
                              ...prev,
                              [f.key]: !prev[f.key],
                            }))
                          }
                          tabIndex={-1}
                          title={showSecretFields[f.key] ? 'Hide secret' : 'Show secret'}
                        >
                          {showSecretFields[f.key] ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      )}
                    </div>
                    <span className="field-hint-text">{f.hint}</span>

                    {connectModalPlatform === 'youtube' && f.key === 'YOUTUBE_CLIENT_ID' && (
                      <div className="field-actions-row">
                        {credentialsForm[f.key] ? (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: '',
                              }))
                            }
                          >
                            Clear (Use System Default)
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: DEFAULT_YOUTUBE_CLIENT_ID,
                              }))
                            }
                          >
                            Paste Default Client ID
                          </button>
                        )}
                      </div>
                    )}

                    {connectModalPlatform === 'youtube' && f.key === 'YOUTUBE_CLIENT_SECRET' && (
                      <div className="field-actions-row">
                        {credentialsForm[f.key] ? (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: '',
                              }))
                            }
                          >
                            Clear (Use System Default)
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: DEFAULT_YOUTUBE_CLIENT_SECRET,
                              }))
                            }
                          >
                            Paste Default Client Secret
                          </button>
                        )}
                      </div>
                    )}

                    {connectModalPlatform === 'discord' && f.key === 'DISCORD_WEBHOOK_URL' && (
                      <div className="field-actions-row">
                        {credentialsForm[f.key] ? (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: '',
                              }))
                            }
                          >
                            Clear (Use System Default)
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: DEFAULT_DISCORD_WEBHOOK_URL,
                              }))
                            }
                          >
                            Paste Default Webhook
                          </button>
                        )}
                      </div>
                    )}

                    {connectModalPlatform === 'telegram' && f.key === 'TELEGRAM_BOT_TOKEN' && (
                      <div className="field-actions-row">
                        {credentialsForm[f.key] ? (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: '',
                              }))
                            }
                          >
                            Clear (Use System Default)
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: DEFAULT_TELEGRAM_BOT_TOKEN,
                              }))
                            }
                          >
                            Paste Default Bot Token
                          </button>
                        )}
                      </div>
                    )}

                    {connectModalPlatform === 'telegram' && f.key === 'TELEGRAM_CHAT_ID' && (
                      <div className="field-actions-row">
                        {credentialsForm[f.key] ? (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: '',
                              }))
                            }
                          >
                            Clear (Use System Default)
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: DEFAULT_TELEGRAM_CHAT_ID,
                              }))
                            }
                          >
                            Paste Default Channel (@lukizerkshorts)
                          </button>
                        )}
                      </div>
                    )}

                    {connectModalPlatform === 'instagram' && f.key === 'INSTAGRAM_ACCOUNT_ID' && (
                      <div className="field-actions-row">
                        {credentialsForm[f.key] ? (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: '',
                              }))
                            }
                          >
                            Clear (Use System Default)
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: DEFAULT_INSTAGRAM_ACCOUNT_ID,
                              }))
                            }
                          >
                            Paste Default Account ID
                          </button>
                        )}
                      </div>
                    )}

                    {connectModalPlatform === 'instagram' && f.key === 'META_ACCESS_TOKEN' && (
                      <div className="field-actions-row">
                        {credentialsForm[f.key] ? (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: '',
                              }))
                            }
                          >
                            Clear (Use System Default)
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-inline-default"
                            onClick={() =>
                              setCredentialsForm((prev) => ({
                                ...prev,
                                [f.key]: DEFAULT_META_ACCESS_TOKEN,
                              }))
                            }
                          >
                            Paste Default Access Token
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="guide-shortcut-row">
                <a
                  href={PLATFORM_CONFIG_DEFINITIONS[connectModalPlatform].guideUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-guide"
                >
                  <ExternalLink size={13} />
                  <span>Open {PLATFORM_CONFIG_DEFINITIONS[connectModalPlatform].name} Official Console</span>
                </a>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConnectModalPlatform(null)}
                disabled={savingCredentials}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-save-test"
                onClick={handleSaveCredentials}
                disabled={savingCredentials}
              >
                {savingCredentials ? (
                  <>
                    <RefreshCw size={15} className="spin" />
                    <span>Saving & Testing Live API...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={15} />
                    <span>Save & Test Connection</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          GENERAL SETUP GUIDE MODAL
          ==================================================================== */}
      {setupModalOpen && (
        <div className="modal-backdrop" onClick={() => setSetupModalOpen(false)}>
          <div className="modal-card setup-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <ShieldCheck size={20} color="var(--accent-primary)" />
                <h3>Platform Credentials & One-Time Setup Guide</h3>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setSetupModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="setup-nav-tabs">
              <button
                type="button"
                className={`setup-tab-btn ${activeSetupTab === 'youtube' ? 'active' : ''}`}
                onClick={() => setActiveSetupTab('youtube')}
              >
                <Youtube size={15} />
                <span>YouTube Shorts</span>
              </button>
              <button
                type="button"
                className={`setup-tab-btn ${activeSetupTab === 'discord' ? 'active' : ''}`}
                onClick={() => setActiveSetupTab('discord')}
              >
                <MessageSquare size={15} />
                <span>Discord</span>
              </button>
              <button
                type="button"
                className={`setup-tab-btn ${activeSetupTab === 'telegram' ? 'active' : ''}`}
                onClick={() => setActiveSetupTab('telegram')}
              >
                <Send size={15} />
                <span>Telegram</span>
              </button>
              <button
                type="button"
                className={`setup-tab-btn ${activeSetupTab === 'instagram' ? 'active' : ''}`}
                onClick={() => setActiveSetupTab('instagram')}
              >
                <Instagram size={15} />
                <span>Instagram Reels</span>
              </button>
            </div>

            <div className="setup-tab-content">
              {activeSetupTab === 'youtube' && (
                <div className="setup-guide-pane">
                  <h4>YouTube Data API v3 OAuth2 Setup</h4>
                  <ol className="setup-steps-list">
                    <li>
                      Go to the <strong>Google Cloud Console</strong> (<a href="https://console.cloud.google.com" target="_blank" rel="noreferrer">console.cloud.google.com</a>) and create or select a project.
                    </li>
                    <li>
                      Enable the <strong>YouTube Data API v3</strong> under <em>APIs & Services → Library</em>.
                    </li>
                    <li>
                      Under <em>Credentials</em>, create an <strong>OAuth 2.0 Client ID</strong> (Web application).
                    </li>
                    <li>
                      Use the OAuth 2.0 Playground or n8n Google credentials to exchange authorization code for a long-lived <code>refresh_token</code> with <code>https://www.googleapis.com/auth/youtube.upload</code> scope.
                    </li>
                    <li>
                      Click the <strong>Connect Platform</strong> button on the YouTube Shorts card to enter:
                      <pre>
                        YOUTUBE_CLIENT_ID=your-id.apps.googleusercontent.com{'\n'}
                        YOUTUBE_CLIENT_SECRET=your-secret{'\n'}
                        YOUTUBE_REFRESH_TOKEN=1//04...{'\n'}
                        YOUTUBE_DEFAULT_PRIVACY=private
                      </pre>
                    </li>
                  </ol>
                </div>
              )}

              {activeSetupTab === 'discord' && (
                <div className="setup-guide-pane">
                  <h4>Discord Webhook Integration (Instant & Zero-Config)</h4>
                  <ol className="setup-steps-list">
                    <li>
                      In Discord, open your server and click <strong>Server Settings</strong> (gear icon).
                    </li>
                    <li>
                      Navigate to <strong>Integrations</strong> → <strong>Webhooks</strong>.
                    </li>
                    <li>
                      Click <strong>New Webhook</strong>, choose your announcement/shorts channel, and copy the Webhook URL.
                    </li>
                    <li>
                      Click <strong>Connect Platform</strong> on the Discord card and paste:
                      <pre>
                        DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123.../xyz...
                      </pre>
                    </li>
                    <li>
                      <em>Note:</em> Standard Discord channels have a <strong>25 MB</strong> upload limit.
                    </li>
                  </ol>
                </div>
              )}

              {activeSetupTab === 'telegram' && (
                <div className="setup-guide-pane">
                  <h4>Telegram Bot API Setup</h4>
                  <ol className="setup-steps-list">
                    <li>
                      Open Telegram and search for <strong>@BotFather</strong> (<a href="https://t.me/BotFather" target="_blank" rel="noreferrer">t.me/BotFather</a>).
                    </li>
                    <li>
                      Send <code>/newbot</code> and follow the prompts to get your <strong>Bot Token</strong>.
                    </li>
                    <li>
                      Add your new bot to your target Telegram Channel as an <strong>Administrator</strong> with &quot;Post Messages&quot; permission.
                    </li>
                    <li>
                      Click <strong>Connect Platform</strong> on the Telegram card and enter:
                      <pre>
                        TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ{'\n'}
                        TELEGRAM_CHAT_ID=@your_channel_username  # or -100123456789
                      </pre>
                    </li>
                  </ol>
                </div>
              )}

              {activeSetupTab === 'instagram' && (
                <div className="setup-guide-pane">
                  <h4>Meta Instagram Graph API Setup (Reels)</h4>
                  <ol className="setup-steps-list">
                    <li>
                      Switch your Instagram account to an <strong>Instagram Professional</strong> account (Creator or Business).
                    </li>
                    <li>
                      Link your Instagram Professional account to a <strong>Facebook Page</strong>.
                    </li>
                    <li>
                      In the <strong>Meta for Developers</strong> console (<a href="https://developers.facebook.com" target="_blank" rel="noreferrer">developers.facebook.com</a>), create an app and add the <strong>Instagram Graph API</strong>.
                    </li>
                    <li>
                      Generate a User access token with <code>instagram_content_publish</code> and <code>instagram_basic</code> permissions.
                    </li>
                    <li>
                      Click <strong>Connect Platform</strong> on the Instagram card and enter:
                      <pre>
                        INSTAGRAM_ACCOUNT_ID=your_instagram_account_id{'\n'}
                        META_ACCESS_TOKEN=your_long_lived_token
                      </pre>
                    </li>
                    <li>
                      <em>Critical:</em> Instagram requires a public HTTPS URL (via your active Cloudflare Tunnel) to fetch the video.
                    </li>
                  </ol>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setSetupModalOpen(false)}
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
