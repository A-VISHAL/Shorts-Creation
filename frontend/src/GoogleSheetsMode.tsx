import { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Play,
  Download,
  Copy,
  ExternalLink,
  Shuffle,
  Film,
  Music,
  Type,
  FileText,
  Check,
  Key,
  Layers,
  Clock,
  X,
  Info,
} from 'lucide-react';
import {
  DEFAULT_SPREADSHEET_URL,
  LOCAL_BACKEND_URL,
  SheetsAuthStatus,
  SheetInspectResult,
  SheetRowItem,
  fetchSheetsAuthStatus,
  inspectSpreadsheet,
  fetchSpreadsheetRows,
  updateSpreadsheetRowStatus,
  generateShort,
  ShortGeneratePayload,
  ShortGenerateResult,
  StudioConfig,
} from './api';

interface GoogleSheetsModeProps {
  config: StudioConfig;
  showToast: (msg: string) => void;
  onPreviewShort?: (url: string, title: string) => void;
}

export function GoogleSheetsMode({ config, showToast }: GoogleSheetsModeProps) {
  // Spreadsheet Connection State
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string>(DEFAULT_SPREADSHEET_URL);
  const [authStatus, setAuthStatus] = useState<SheetsAuthStatus | null>(null);
  const [inspecting, setInspecting] = useState<boolean>(false);
  const [inspectResult, setInspectResult] = useState<SheetInspectResult | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState<boolean>(false);

  // Column Mapping
  const [mapping, setMapping] = useState({
    quote: '',
    video_url: '',
    music_url: '',
    title: '',
    status: '',
    output_url: '',
  });

  // Rows State
  const [rows, setRows] = useState<SheetRowItem[]>([]);
  const [loadingRows, setLoadingRows] = useState<boolean>(false);

  // Batch Generation Settings
  const [batchCount, setBatchCount] = useState<number>(1);
  const [randomSelection, setRandomSelection] = useState<boolean>(true);
  const [duration, setDuration] = useState<number>(30);
  const [style, setStyle] = useState<'dark-motivational' | 'minimal-white' | 'bold-motivational'>('dark-motivational');

  // Generation Execution State
  const [generating, setGenerating] = useState<boolean>(false);
  const [currentProgressText, setCurrentProgressText] = useState<string>('');
  const [currentBatchIndex, setCurrentBatchIndex] = useState<number>(0);
  const [totalBatchSize, setTotalBatchSize] = useState<number>(0);
  const [generatedResults, setGeneratedResults] = useState<Array<{
    rowNumber: number;
    title: string;
    quote: string;
    videoUrl: string;
    downloadUrl: string;
    durationSeconds: number;
    timestamp: string;
  }>>([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState<number>(0);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  // Load backend Google Sheets auth status on mount
  useEffect(() => {
    fetchSheetsAuthStatus()
      .then((status) => setAuthStatus(status))
      .catch((err) => console.warn('Could not fetch sheets auth status:', err));
  }, []);

  // Inspect the Google Spreadsheet
  const handleInspect = async (overrideSheetName?: string) => {
    if (!spreadsheetUrl.trim()) {
      setInspectError('Please enter a valid Google Spreadsheet URL or ID.');
      return;
    }
    setInspecting(true);
    setInspectError(null);

    try {
      const res = await inspectSpreadsheet(spreadsheetUrl, overrideSheetName || selectedSheet);
      setInspectResult(res);
      setSelectedSheet(res.activeSheet);

      // Initialize mapping from auto-detected fields
      const newMapping = {
        quote: res.detectedMapping.quote || '',
        video_url: res.detectedMapping.video_url || '',
        music_url: res.detectedMapping.music_url || '',
        title: res.detectedMapping.title || '',
        status: res.detectedMapping.status || '',
        output_url: res.detectedMapping.output_url || '',
      };
      setMapping(newMapping);

      // Fetch all rows with this mapping
      loadRowsWithMapping(res.activeSheet, newMapping);
      showToast('Spreadsheet connected and inspected successfully!');
    } catch (err: any) {
      setInspectError(err.message || 'Failed to connect to Google Spreadsheet.');
    } finally {
      setInspecting(false);
    }
  };

  // Fetch rows
  const loadRowsWithMapping = async (sheetName: string, mapObj: typeof mapping) => {
    setLoadingRows(true);
    try {
      const res = await fetchSpreadsheetRows(spreadsheetUrl, sheetName, mapObj);
      setRows(res.rows || []);
    } catch (err: any) {
      console.warn('Failed to load full sheet rows:', err);
    } finally {
      setLoadingRows(false);
    }
  };

  // Change active tab
  const handleSheetTabChange = (newSheet: string) => {
    setSelectedSheet(newSheet);
    handleInspect(newSheet);
  };

  // Change mapping
  const handleMappingChange = (field: keyof typeof mapping, columnHeader: string) => {
    const updated = { ...mapping, [field]: columnHeader };
    setMapping(updated);
    if (selectedSheet) {
      loadRowsWithMapping(selectedSheet, updated);
    }
  };

  // Generate Shorts from Sheet
  const handleGenerateFromSheet = async () => {
    if (!mapping.quote || !mapping.video_url) {
      setGenerationError('Please map at least "Quote / Text" and "Background Video URL" to start generation.');
      return;
    }

    // Filter valid candidates
    const validRows = rows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      setGenerationError(
        'No valid rows found in the sheet. Ensure rows contain both a motivational quote and a video URL.'
      );
      return;
    }

    // Pick rows
    const countToPick = Math.min(batchCount, validRows.length);
    let chosenRows: SheetRowItem[] = [];

    if (randomSelection) {
      // Shuffle copy of valid rows
      const shuffled = [...validRows].sort(() => 0.5 - Math.random());
      chosenRows = shuffled.slice(0, countToPick);
    } else {
      chosenRows = validRows.slice(0, countToPick);
    }

    setGenerating(true);
    setGenerationError(null);
    setTotalBatchSize(countToPick);

    const newlyGenerated: typeof generatedResults = [];

    for (let i = 0; i < chosenRows.length; i++) {
      const row = chosenRows[i];
      setCurrentBatchIndex(i + 1);
      setCurrentProgressText(`Processing Short ${i + 1}/${countToPick} (Sheet Row #${row.rowNumber})...`);

      // Update in-sheet status to "Processing"
      await updateSpreadsheetRowStatus(
        spreadsheetUrl,
        row.rowNumber,
        'Processing',
        undefined,
        selectedSheet,
        mapping.status,
        mapping.output_url
      );

      const payload: ShortGeneratePayload = {
        videoUrl: row.videoUrl,
        musicUrl: row.musicUrl || `${LOCAL_BACKEND_URL}/media/test_source_aud.mp3`,
        text: row.quote,
        title: row.title || `Short_${row.rowNumber}_${Date.now()}`,
        durationSeconds: duration,
        width: 1080,
        height: 1920,
        style: style,
      };

      try {
        const result: ShortGenerateResult = await generateShort(payload, config.webhookUrl);

        if (result && (result.videoUrl || result.downloadUrl)) {
          const item = {
            rowNumber: row.rowNumber,
            title: result.title || payload.title,
            quote: row.quote,
            videoUrl: result.videoUrl || result.downloadUrl,
            downloadUrl: result.downloadUrl || result.videoUrl,
            durationSeconds: result.durationSeconds || duration,
            timestamp: new Date().toLocaleTimeString(),
          };
          newlyGenerated.push(item);
          setGeneratedResults((prev) => [item, ...prev]);
          setActivePreviewIndex(0);

          // Update in-sheet status to "Completed" and save video URL
          await updateSpreadsheetRowStatus(
            spreadsheetUrl,
            row.rowNumber,
            'Completed',
            result.videoUrl || result.downloadUrl,
            selectedSheet,
            mapping.status,
            mapping.output_url
          );
        } else {
          throw new Error('No video URL returned from render pipeline.');
        }
      } catch (err: any) {
        console.error(`Generation failed for row #${row.rowNumber}:`, err);
        await updateSpreadsheetRowStatus(
          spreadsheetUrl,
          row.rowNumber,
          'Failed',
          undefined,
          selectedSheet,
          mapping.status,
          mapping.output_url
        );
        setGenerationError(
          `Failed on row #${row.rowNumber}: ${err.message || 'Rendering error'}. Proceeding to next row if any.`
        );
      }
    }

    setGenerating(false);
    setCurrentProgressText('');
    showToast(
      newlyGenerated.length > 0
        ? `Successfully generated ${newlyGenerated.length} short(s) from Google Sheet!`
        : 'Batch generation finished with errors.'
    );

    // Refresh rows to show updated statuses
    if (selectedSheet) {
      loadRowsWithMapping(selectedSheet, mapping);
    }
  };

  const handleCopyPreviewUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
    showToast('Video URL copied to clipboard!');
  };

  const currentPreview = generatedResults[activePreviewIndex];

  return (
    <div className="sheets-mode-container">
      {/* 2-Column Grid */}
      <div className="studio-grid">
        {/* Left Column: Google Sheets Configuration & Row Selection */}
        <div className="form-column">
          {/* SECTION 1: SPREADSHEET CONNECTION */}
          <div className="module-card section-media">
            <div className="module-header">
              <div className="module-title-group">
                <span className="module-step-badge badge-media">SHEETS API</span>
                <h2 className="module-title">Google Sheets Connection</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-setup-guide"
                  onClick={() => setShowSetupGuide(true)}
                  title="How to connect private spreadsheets via Service Account"
                >
                  <Key size={13} />
                  <span>Setup Guide</span>
                </button>
              </div>
            </div>

            {/* Auth Banner */}
            <div className={`sheets-auth-banner ${authStatus?.configured ? 'configured' : 'not-configured'}`}>
              <div className="auth-banner-left">
                {authStatus?.configured ? (
                  <>
                    <CheckCircle2 size={16} className="text-emerald" />
                    <div>
                      <span className="auth-status-title">Service Account Active</span>
                      <p className="auth-status-email">{authStatus.serviceAccountEmail}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Info size={16} className="text-amber" />
                    <div>
                      <span className="auth-status-title">Service Account Not Configured</span>
                      <p className="auth-status-sub">
                        Connect private sheets or write back "Completed" status by adding <code>service_account.json</code> in <code>backend/</code>.
                      </p>
                    </div>
                  </>
                )}
              </div>
              {authStatus?.serviceAccountEmail && (
                <button
                  type="button"
                  className="btn-copy-email"
                  onClick={() => {
                    navigator.clipboard.writeText(authStatus.serviceAccountEmail || '');
                    showToast('Service account email copied! Share your sheet with this email.');
                  }}
                  title="Copy Service Account Email to share spreadsheet"
                >
                  <Copy size={12} />
                  <span>Copy Email</span>
                </button>
              )}
            </div>

            {/* Spreadsheet URL Input */}
            <div className="form-field" style={{ marginTop: '1.15rem' }}>
              <div className="field-label-row">
                <label className="field-label" htmlFor="spreadsheetUrlInput">
                  <FileSpreadsheet size={15} className="field-label-icon icon-cyan" />
                  <span>Spreadsheet URL</span>
                </label>
                <span className="field-hint hint-cyan">Google Docs Sheet</span>
              </div>
              <div className="input-action-group">
                <input
                  id="spreadsheetUrlInput"
                  type="url"
                  className="studio-input input-cyan"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0"
                  value={spreadsheetUrl}
                  onChange={(e) => setSpreadsheetUrl(e.target.value)}
                  disabled={inspecting || generating}
                />
                <button
                  type="button"
                  className="btn-inspect-sheet"
                  onClick={() => handleInspect()}
                  disabled={inspecting || generating}
                >
                  {inspecting ? (
                    <>
                      <RefreshCw size={14} className="spinner" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <ExternalLink size={14} />
                      <span>Connect & Inspect</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Connection Error Message */}
            {inspectError && (
              <div className="alert-error" style={{ marginTop: '1rem' }}>
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div className="alert-error-title">Spreadsheet Connection Notice</div>
                  <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{inspectError}</p>
                  <button
                    type="button"
                    className="btn-action-guide-inline"
                    onClick={() => setShowSetupGuide(true)}
                  >
                    View Step-by-Step Google Service Account Setup Guide →
                  </button>
                </div>
              </div>
            )}

            {/* Connected Sheet Meta */}
            {inspectResult && (
              <div className="sheet-connected-meta">
                <div className="meta-pill">
                  <span className="meta-pill-label">Title:</span>
                  <strong className="meta-pill-val">{inspectResult.spreadsheetTitle}</strong>
                </div>
                <div className="meta-pill">
                  <span className="meta-pill-label">Total Rows:</span>
                  <strong className="meta-pill-val">{inspectResult.totalRows}</strong>
                </div>
                <div className="meta-pill">
                  <span className="meta-pill-label">Valid Candidates:</span>
                  <strong className="meta-pill-val text-emerald">{inspectResult.validRowsCount}</strong>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 2: WORKSHEET & COLUMN MAPPING */}
          {inspectResult && (
            <div className="module-card section-typography">
              <div className="module-header">
                <div className="module-title-group">
                  <span className="module-step-badge badge-typography">MAP</span>
                  <h2 className="module-title">Column Mapping & Worksheet</h2>
                </div>
                {inspectResult.sheets.length > 1 && (
                  <div className="sheet-tab-select-wrap">
                    <label className="sheet-tab-label">Tab:</label>
                    <select
                      className="sheet-tab-select"
                      value={selectedSheet}
                      onChange={(e) => handleSheetTabChange(e.target.value)}
                      disabled={inspecting || generating}
                    >
                      {inspectResult.sheets.map((s) => (
                        <option key={s.title} value={s.title}>
                          {s.title} ({s.rowCount} rows)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="mapping-grid">
                {/* Quote Column */}
                <div className="mapping-item">
                  <label className="mapping-label">
                    <FileText size={13} className="icon-amber" />
                    <span>Motivational Quote / Text *</span>
                  </label>
                  <select
                    className="mapping-select"
                    value={mapping.quote}
                    onChange={(e) => handleMappingChange('quote', e.target.value)}
                    disabled={generating}
                  >
                    <option value="">-- Select Column --</option>
                    {inspectResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h} {h === inspectResult.detectedMapping.quote ? '(Auto-Detected)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Video URL Column */}
                <div className="mapping-item">
                  <label className="mapping-label">
                    <Film size={13} className="icon-cyan" />
                    <span>Background Video URL *</span>
                  </label>
                  <select
                    className="mapping-select"
                    value={mapping.video_url}
                    onChange={(e) => handleMappingChange('video_url', e.target.value)}
                    disabled={generating}
                  >
                    <option value="">-- Select Column --</option>
                    {inspectResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h} {h === inspectResult.detectedMapping.video_url ? '(Auto-Detected)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Soundtrack URL Column */}
                <div className="mapping-item">
                  <label className="mapping-label">
                    <Music size={13} className="icon-purple" />
                    <span>Soundtrack URL (Optional)</span>
                  </label>
                  <select
                    className="mapping-select"
                    value={mapping.music_url}
                    onChange={(e) => handleMappingChange('music_url', e.target.value)}
                    disabled={generating}
                  >
                    <option value="">-- None (Use Studio Default) --</option>
                    {inspectResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h} {h === inspectResult.detectedMapping.music_url ? '(Auto-Detected)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Title Column */}
                <div className="mapping-item">
                  <label className="mapping-label">
                    <Type size={13} className="icon-amber" />
                    <span>Short Title (Optional)</span>
                  </label>
                  <select
                    className="mapping-select"
                    value={mapping.title}
                    onChange={(e) => handleMappingChange('title', e.target.value)}
                    disabled={generating}
                  >
                    <option value="">-- None (Auto-generate) --</option>
                    {inspectResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h} {h === inspectResult.detectedMapping.title ? '(Auto-Detected)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Column */}
                <div className="mapping-item">
                  <label className="mapping-label">
                    <CheckCircle2 size={13} className="text-emerald" />
                    <span>Status Column (Write-Back)</span>
                  </label>
                  <select
                    className="mapping-select"
                    value={mapping.status}
                    onChange={(e) => handleMappingChange('status', e.target.value)}
                    disabled={generating}
                  >
                    <option value="">-- None --</option>
                    {inspectResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h} {h === inspectResult.detectedMapping.status ? '(Auto-Detected)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Output URL Column */}
                <div className="mapping-item">
                  <label className="mapping-label">
                    <Download size={13} className="icon-cyan" />
                    <span>Output URL Column (Write-Back)</span>
                  </label>
                  <select
                    className="mapping-select"
                    value={mapping.output_url}
                    onChange={(e) => handleMappingChange('output_url', e.target.value)}
                    disabled={generating}
                  >
                    <option value="">-- None --</option>
                    {inspectResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h} {h === inspectResult.detectedMapping.output_url ? '(Auto-Detected)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 3: BATCH GENERATION SETTINGS */}
          <div className="module-card section-canvas">
            <div className="module-header">
              <div className="module-title-group">
                <span className="module-step-badge badge-canvas">BATCH</span>
                <h2 className="module-title">Batch Generation Parameters</h2>
              </div>
              <span className="module-subtitle subtitle-canvas">Automated Video Creation</span>
            </div>

            <div className="batch-settings-grid">
              {/* Number of Shorts */}
              <div className="batch-setting-item">
                <label className="field-label">
                  <Sparkles size={14} className="icon-purple" />
                  <span>Number of Shorts to Generate</span>
                </label>
                <div className="segmented-control" style={{ marginTop: '0.4rem' }}>
                  {[1, 2, 3, 5].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      className={`segmented-btn ${batchCount === cnt ? 'active' : ''}`}
                      onClick={() => setBatchCount(cnt)}
                      disabled={generating}
                    >
                      <span>{cnt} {cnt === 1 ? 'Short' : 'Shorts'}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Selection Mode Toggle */}
              <div className="batch-setting-item">
                <label className="field-label">
                  <Shuffle size={14} className="icon-cyan" />
                  <span>Selection Strategy</span>
                </label>
                <div className="toggle-selection-row">
                  <button
                    type="button"
                    className={`btn-toggle-option ${randomSelection ? 'active' : ''}`}
                    onClick={() => setRandomSelection(true)}
                    disabled={generating}
                  >
                    <Shuffle size={13} />
                    <span>Random Valid Rows</span>
                  </button>
                  <button
                    type="button"
                    className={`btn-toggle-option ${!randomSelection ? 'active' : ''}`}
                    onClick={() => setRandomSelection(false)}
                    disabled={generating}
                  >
                    <span>Sequential (Top Down)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Target Duration */}
            <div className="form-field" style={{ marginTop: '1.25rem' }}>
              <div className="field-label-row">
                <label className="field-label">
                  <Clock size={14} className="field-label-icon" />
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
                    disabled={generating}
                  >
                    <span>{d}s</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Visual Typography Style */}
            <div className="form-field" style={{ marginTop: '1.25rem' }}>
              <div className="field-label-row">
                <label className="field-label">
                  <Layers size={14} className="field-label-icon" />
                  <span>Visual Typography Theme</span>
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

          {/* SECTION 4: DATA ROWS PREVIEW TABLE */}
          {rows.length > 0 && (
            <div className="module-card section-presets">
              <div className="module-header">
                <div className="module-title-group">
                  <span className="module-step-badge badge-presets">DATA</span>
                  <h2 className="module-title">Spreadsheet Rows ({rows.length})</h2>
                </div>
                <span className="module-subtitle subtitle-presets">
                  {loadingRows
                    ? 'Loading rows from sheet...'
                    : `${rows.filter((r) => r.isValid).length} ready to render`}
                </span>
              </div>

              <div className="sheet-rows-table-wrap">
                <table className="sheet-rows-table">
                  <thead>
                    <tr>
                      <th style={{ width: '45px' }}>#</th>
                      <th>Motivational Quote</th>
                      <th>Video URL</th>
                      <th>Soundtrack</th>
                      <th style={{ width: '90px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r) => (
                      <tr key={r.rowNumber} className={r.isValid ? 'row-valid' : 'row-invalid'}>
                        <td className="row-num">#{r.rowNumber}</td>
                        <td className="row-quote" title={r.quote}>
                          {r.quote ? (
                            <span>{r.quote}</span>
                          ) : (
                            <span className="text-muted italic">Empty quote</span>
                          )}
                        </td>
                        <td className="row-url" title={r.videoUrl}>
                          {r.videoUrl ? (
                            <span className="code-snippet">{r.videoUrl.replace(/^https?:\/\//, '')}</span>
                          ) : (
                            <span className="text-muted italic">Empty URL</span>
                          )}
                        </td>
                        <td className="row-url" title={r.musicUrl}>
                          {r.musicUrl ? (
                            <span className="code-snippet">{r.musicUrl.replace(/^https?:\/\//, '')}</span>
                          ) : (
                            <span className="text-muted">Default</span>
                          )}
                        </td>
                        <td>
                          {r.isValid ? (
                            <span className="badge-row-status valid">Ready</span>
                          ) : (
                            <span className="badge-row-status invalid" title={r.invalidReason || ''}>
                              Incomplete
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 10 && (
                  <div className="table-more-hint">
                    + {rows.length - 10} more rows loaded from spreadsheet
                  </div>
                )}
              </div>
            </div>
          )}

          {/* MASTER TRIGGER: GENERATE SHORTS */}
          <button
            type="button"
            className="btn-generate"
            onClick={handleGenerateFromSheet}
            disabled={generating || inspecting}
          >
            {generating ? (
              <>
                <RefreshCw size={20} className="spinner" />
                <span>
                  {currentProgressText || `Generating Short (${currentBatchIndex}/${totalBatchSize})...`}
                </span>
              </>
            ) : (
              <>
                <Sparkles size={20} />
                <span>
                  Generate {batchCount === 1 ? '1 Short' : `${batchCount} Shorts`} Automatically from Sheet
                </span>
              </>
            )}
          </button>

          {/* Error Banner */}
          {generationError && (
            <div className="alert-error" style={{ marginTop: '1rem' }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div className="alert-error-title">Generation Notice</div>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{generationError}</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Shorts Canvas Preview & Batch Gallery */}
        <div className="preview-column">
          <div className="preview-container-card section-preview">
            <div className="preview-top-bar">
              <div className="preview-heading">
                <Play size={18} className="preview-heading-icon" />
                <span>Google Sheets Shorts Preview</span>
              </div>
              <span className="resolution-pill">1080 × 1920 MP4</span>
            </div>

            {/* Phone Bezel Player */}
            <div className="canvas-frame">
              <div className="phone-notch" />

              {/* Progress Overlay */}
              {generating && (
                <div className="progress-overlay">
                  <div className="progress-pct-huge">
                    {totalBatchSize > 0 ? Math.round((currentBatchIndex / totalBatchSize) * 100) : 0}%
                  </div>
                  <div className="progress-track-bg">
                    <div
                      className="progress-track-fill"
                      style={{
                        width: `${totalBatchSize > 0 ? (currentBatchIndex / totalBatchSize) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p className="generating-status-sub">
                    {currentProgressText || 'Rendering vertical short...'}
                  </p>
                </div>
              )}

              {currentPreview?.videoUrl ? (
                <video
                  src={currentPreview.videoUrl}
                  controls
                  autoPlay
                  playsInline
                  className="active-short-video"
                  key={currentPreview.videoUrl}
                />
              ) : (
                <div className="canvas-empty-state">
                  <div className="canvas-empty-icon">
                    <Sparkles size={26} />
                  </div>
                  <span className="canvas-empty-title">Automated Shorts Canvas</span>
                  <p className="canvas-empty-desc">
                    Connect your Google Sheet and click 'Generate Shorts' to render inspiring 9:16 vertical videos.
                  </p>
                </div>
              )}
            </div>

            {/* Action Bar for Currently Displayed Video */}
            {currentPreview && (
              <div className="render-success-bar">
                <div className="success-meta-row">
                  <CheckCircle2 size={16} color="var(--status-success)" style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Render Complete: <strong>{currentPreview.title}</strong> ({currentPreview.durationSeconds}s)
                  </span>
                </div>

                <div className="action-btn-group">
                  <a
                    href={currentPreview.downloadUrl}
                    download={`${currentPreview.title.replace(/\s+/g, '_')}.mp4`}
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
                    onClick={() => handleCopyPreviewUrl(currentPreview.videoUrl)}
                  >
                    {copiedUrl ? <Check size={15} color="var(--status-success)" /> : <Copy size={15} />}
                    <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Batch Gallery List */}
            {generatedResults.length > 1 && (
              <div className="batch-gallery-section">
                <h4 className="batch-gallery-title">Generated Shorts Gallery ({generatedResults.length})</h4>
                <div className="batch-gallery-list">
                  {generatedResults.map((item, idx) => (
                    <div
                      key={idx}
                      className={`batch-gallery-item ${activePreviewIndex === idx ? 'active' : ''}`}
                      onClick={() => setActivePreviewIndex(idx)}
                    >
                      <div className="gallery-item-left">
                        <span className="gallery-item-badge">#{item.rowNumber}</span>
                        <div>
                          <div className="gallery-item-title">{item.title}</div>
                          <div className="gallery-item-time">{item.timestamp}</div>
                        </div>
                      </div>
                      <a
                        href={item.downloadUrl}
                        download
                        className="btn-gallery-dl"
                        onClick={(e) => e.stopPropagation()}
                        title="Download MP4"
                      >
                        <Download size={13} />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SETUP GUIDE MODAL */}
      {showSetupGuide && (
        <div className="modal-overlay" onClick={() => setShowSetupGuide(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <div className="modal-title-group">
                <Key size={18} color="var(--neon-cyan)" />
                <h3 className="modal-heading">Google Sheets Service Account Setup</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowSetupGuide(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-content-area">
              <div className="guide-step">
                <div className="guide-step-num">1</div>
                <div>
                  <h4 className="guide-step-title">Open Google Cloud Console</h4>
                  <p className="guide-step-desc">
                    Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="guide-link">console.cloud.google.com</a>, create a project (e.g. <code>Shorts-Studio</code>), and enable the <strong>Google Sheets API</strong> in APIs & Services.
                  </p>
                </div>
              </div>

              <div className="guide-step">
                <div className="guide-step-num">2</div>
                <div>
                  <h4 className="guide-step-title">Create a Service Account & Download Key</h4>
                  <p className="guide-step-desc">
                    Navigate to <strong>IAM & Admin &gt; Service Accounts</strong>. Click <strong>Create Service Account</strong>, grant the <strong>Editor</strong> role, click on the created account, go to the <strong>Keys</strong> tab, click <strong>Add Key &gt; Create new key (JSON)</strong>, and download the JSON file.
                  </p>
                </div>
              </div>

              <div className="guide-step">
                <div className="guide-step-num">3</div>
                <div>
                  <h4 className="guide-step-title">Place File in Backend Directory</h4>
                  <p className="guide-step-desc">
                    Rename your downloaded file to <code>service_account.json</code> and place it inside the <code>backend/</code> folder of this project:
                  </p>
                  <code className="guide-code-box">
                    /home/vishal/Downloads/shorts creation/backend/service_account.json
                  </code>
                </div>
              </div>

              <div className="guide-step">
                <div className="guide-step-num">4</div>
                <div>
                  <h4 className="guide-step-title">Share Your Google Spreadsheet</h4>
                  <p className="guide-step-desc">
                    Open your Google Sheet, click the green/blue <strong>Share</strong> button, and add your Service Account email as an <strong>Editor</strong>:
                  </p>
                  <div className="service-email-box">
                    <span>{authStatus?.serviceAccountEmail || 'your-service-account@your-project.iam.gserviceaccount.com'}</span>
                    {authStatus?.serviceAccountEmail && (
                      <button
                        type="button"
                        className="btn-copy-email-small"
                        onClick={() => {
                          navigator.clipboard.writeText(authStatus.serviceAccountEmail || '');
                          showToast('Email copied!');
                        }}
                      >
                        Copy
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-bottom">
              <button
                type="button"
                className="btn-action-primary"
                onClick={() => setShowSetupGuide(false)}
              >
                I Understand
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
