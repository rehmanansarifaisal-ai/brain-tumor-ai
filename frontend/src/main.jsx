import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function Stat({ label, value, muted = false }) {
  return <div className="stat">
    <div className="stat-label">{label}</div>
    <div className={muted ? 'stat-value muted' : 'stat-value'}>{value}</div>
  </div>
}

function StatusPill({ online }) {
  return <div className={`top-status ${online ? 'online' : 'offline'}`}>
    <div className="dot"></div>
    {online ? 'BACKEND ONLINE' : 'BACKEND OFFLINE'}
  </div>
}

function ScanOrb({ active }) {
  return <div className={`scan-orb ${active ? 'active' : ''}`} aria-hidden="true">
    <div className="orb-core"></div>
    <div className="orb-ring ring-one"></div>
    <div className="orb-ring ring-two"></div>
    <div className="orb-ring ring-three"></div>
    <div className="orb-axis axis-one"></div>
    <div className="orb-axis axis-two"></div>
  </div>
}

function EmptyState({ title, text }) {
  return <div className="empty">
    <ScanOrb />
    <strong>{title}</strong>
    <span>{text}</span>
  </div>
}

function App() {
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const initialApiBase = import.meta.env.VITE_API_BASE_URL || (isLocalHost ? localStorage.getItem('brainTumorApiBase') : '/api') || '/api'
  const [apiBase, setApiBase] = useState(() => initialApiBase)
  const [geminiModel, setGeminiModel] = useState(() => localStorage.getItem('brainTumorGeminiModel') || 'gemini-2.5-flash-lite')
  const [health, setHealth] = useState(null)
  const [activePage, setActivePage] = useState('analysis')
  const [files, setFiles] = useState([])
  const [previewUrl, setPreviewUrl] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [explanation, setExplanation] = useState(null)
  const [annotatedUrl, setAnnotatedUrl] = useState('')
  const [modelLogs, setModelLogs] = useState(null)

  const backendOnline = health?.backend === 'online'
  const modelReady = Boolean(health?.model_loaded)
  const confidenceValue = selected?.best_confidence != null ? `${(selected.best_confidence * 100).toFixed(1)}%` : '-'

  const pageCopy = useMemo(() => ({
    analysis: {
      eyebrow: 'Live MRI Workspace',
      title: 'Automated Brain Tumor Detection Using Deep Learning Techniques',
      text: 'Upload a scan, run the AI model, and review classification details with a cleaner diagnostic workflow.'
    },
    batch: {
      eyebrow: 'Processed Scans',
      title: 'Batch Results',
      text: 'Review recent scan outputs and jump back into the selected analysis result.'
    },
    model: {
      eyebrow: 'Runtime Health',
      title: 'Model Status',
      text: 'Check backend availability, loaded model state, device, and current inference configuration.'
    },
    logs: {
      eyebrow: 'Training Console',
      title: 'Model Logs',
      text: 'Inspect uploaded scan inference logs in a terminal-style view.'
    },
    settings: {
      eyebrow: 'Control Center',
      title: 'Settings',
      text: 'Manage API and Gemini configuration used by this local analysis prototype.'
    }
  }), [])

  const candidateApiBases = () => {
    const currentOrigin = `${window.location.protocol}//${window.location.hostname}`
    const persistedBase = localStorage.getItem('brainTumorApiBase')
    const origins = [
      '/api',
      import.meta.env.VITE_API_BASE_URL,
      isLocalHost ? persistedBase : null,
      `${currentOrigin}:8000`,
      `${currentOrigin}:8001`,
      `${currentOrigin}:8002`,
      isLocalHost ? 'http://127.0.0.1:8000' : null,
      isLocalHost ? 'http://127.0.0.1:8001' : null,
      isLocalHost ? 'http://127.0.0.1:8002' : null,
    ]
    return [...new Set(origins.filter(Boolean))]
  }

  const apiUrl = (base, endpoint) => {
    if (!base || base === '/') return endpoint
    if (base === '/api') return endpoint
    return `${base}${endpoint}`
  }

  const probeBackend = async base => {
    const response = await fetch(apiUrl(base, '/api/health'), { cache: 'no-store' })
    if (!response.ok) throw new Error(`Health check failed for ${base}`)
    return response.json()
  }

  const resolveApiBase = async () => {
    for (const base of candidateApiBases()) {
      try {
        const health = await probeBackend(base)
        setApiBase(base)
        localStorage.setItem('brainTumorApiBase', base)
        if (health?.status === 'ok') {
          return base
        }
        return base
      } catch {}
    }
    return apiBase
  }

  const refresh = async () => {
    try {
      const activeBase = await resolveApiBase()
      const r = await fetch(apiUrl(activeBase, '/api/health'), { cache: 'no-store' })
      setHealth(await r.json())
    } catch {
      setHealth({ backend: 'offline', model_loaded: false })
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const loadLogs = async () => {
      try {
        const activeBase = await resolveApiBase()
        const r = await fetch(apiUrl(activeBase, '/api/model/logs'), { cache: 'no-store' })
        if (!r.ok) throw new Error('Failed to load model logs')
        setModelLogs(await r.json())
      } catch {
        setModelLogs(null)
      }
    }
    loadLogs()
  }, [activePage])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const pickFiles = e => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const nextFiles = Array.from(e.target.files || [])
    setFiles(nextFiles)
    setResults([])
    setSelected(null)
    setExplanation(null)
    setAnnotatedUrl('')
    setError('')
    const firstFile = nextFiles[0]
    setPreviewUrl(firstFile ? URL.createObjectURL(firstFile) : '')
  }

  const analyze = async () => {
    if (!files.length) return
    setBusy(true)
    setError('')
    try {
      const activeBase = await resolveApiBase()
      const form = new FormData()
      form.append('file', files[0])
      const r = await fetch(apiUrl(activeBase, '/api/explain'), { method: 'POST', body: form })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || data.message || `Analysis failed (${r.status})`)
      setResults([data.classification])
      setSelected(data.classification)
      setExplanation(data.explanation)
      setAnnotatedUrl(data.classification?.annotated_image ? apiUrl(activeBase, `/api/annotated/${data.classification.annotated_image}`) : '')
      setActivePage('analysis')
    } catch (e) {
      setError(e?.message || 'Failed to fetch backend')
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const navItem = (id, label, index) => (
    <button className={`nav-item ${activePage === id ? 'active' : ''}`} onClick={() => setActivePage(id)} type="button">
      <span className="nav-index">0{index}</span>
      <span>{label}</span>
    </button>
  )

  const saveSettings = () => {
    localStorage.setItem('brainTumorApiBase', apiBase)
    localStorage.setItem('brainTumorGeminiModel', geminiModel)
    refresh()
  }

  useEffect(() => {
    if (!isLocalHost && typeof window !== 'undefined') {
      const storedBase = localStorage.getItem('brainTumorApiBase')
      if (storedBase && storedBase.startsWith('http://127.0.0.1')) {
        localStorage.removeItem('brainTumorApiBase')
      }
    }
  }, [isLocalHost])

  const currentPage = pageCopy[activePage]

  return <div className="app">
    <div className="ambient ambient-one"></div>
    <div className="ambient ambient-two"></div>
    <div className="gridlines"></div>

    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">BT</div>
        <div>
          <div className="brand">BRAIN<span>TUMOR</span> AI</div>
          <div className="subbrand">MRI Classification & Detection</div>
        </div>
      </div>
      <StatusPill online={backendOnline} />
    </header>

    <main className="layout">
      <aside className="sidebar">
        <div className="nav-title">WORKSPACE</div>
        {navItem('analysis', 'MRI Analysis', 1)}
        {navItem('batch', 'Batch Results', 2)}
        {navItem('model', 'Model Status', 3)}
        {navItem('logs', 'Model Logs', 4)}
        {navItem('settings', 'Settings', 5)}
        <div className="sidebar-bottom">
          <div className="mini-card">
            <span>MODEL</span>
            <strong>{modelReady ? 'READY' : 'NOT LOADED'}</strong>
          </div>
          <div className="mini-card">
            <span>DEVICE</span>
            <strong>{health?.device || '-'}</strong>
          </div>
          <div className="mini-card live-card">
            <span>API</span>
            <strong>{apiBase}</strong>
          </div>
        </div>
      </aside>

      <section className="content">
        <section className="hero">
          <div className="hero-copy">
            <span>{currentPage.eyebrow}</span>
            <h1>{currentPage.title}</h1>
            <p>{currentPage.text}</p>
            <div className="hero-metrics">
              <div><strong>{backendOnline ? 'Online' : 'Offline'}</strong><small>Backend</small></div>
              <div><strong>{modelReady ? 'Ready' : 'Waiting'}</strong><small>Model</small></div>
              <div><strong>{files.length}</strong><small>Selected</small></div>
            </div>
          </div>
          <div className="hero-visual">
            <ScanOrb active={busy} />
            <div className="hero-chip chip-one">CNN</div>
            <div className="hero-chip chip-two">MRI</div>
            <div className="hero-chip chip-three">{confidenceValue}</div>
          </div>
        </section>

        {activePage === 'analysis' && <>
          <div className="grid">
            <section className="panel upload-panel">
              <div className="panel-head">
                <span>01</span>
                <div><h2>Input Scan</h2><p>JPG, JPEG, PNG, WEBP</p></div>
              </div>
              <label className={`dropzone ${previewUrl ? 'has-preview' : ''}`}>
                <input type="file" accept="image/*" multiple onChange={pickFiles} />
                <div className="upload-icon">+</div>
                <strong>{previewUrl ? 'Replace MRI image' : 'Choose MRI image'}</strong>
                <span>Click to select a scan from your system</span>
              </label>
              {previewUrl && <div className="preview-wrap">
                <div className="scan-line"></div>
                <img className="preview-image" src={previewUrl} alt="Uploaded MRI preview" />
              </div>}
              {files.length > 0 && <div className="file-list">{files.map((f, i) => <div className="file-row" key={i}>
                <span>{f.name}</span>
                <small>{(f.size / 1024 / 1024).toFixed(2)} MB</small>
              </div>)}</div>}
              <button className={`primary ${busy ? 'loading' : ''}`} disabled={!files.length || busy || !modelReady} onClick={analyze}>
                {busy ? 'ANALYZING SCAN...' : 'RUN AI ANALYSIS'}
              </button>
              {!modelReady && <div className="warning">Place the trained <b>best.pt</b> file in <code>backend/models/</code> before running inference.</div>}
              {error && <div className="error">{error}</div>}
            </section>

            <section className="panel results-panel">
              <div className="panel-head">
                <span>02</span>
                <div><h2>AI Result</h2><p>Classification output</p></div>
              </div>
              {!selected ? <EmptyState title="No analysis result yet" text="Upload an MRI scan and run the model to unlock the result panel." /> : <>
                <div className="result-banner">
                  <div>
                    <span>PREDICTED CLASS</span>
                    <strong className={selected.tumor_detected ? 'bad' : 'good'}>{selected.predicted_type || 'Unknown'}</strong>
                  </div>
                  <div className="confidence">
                    <span>BEST CONFIDENCE</span>
                    <strong>{confidenceValue}</strong>
                  </div>
                </div>
                <div className="result-grid">
                  <Stat label="Tumor status" value={selected.tumor_detected ? 'Tumor detected' : 'No tumor detected'} />
                  <Stat label="Predicted type" value={selected.predicted_type || 'Unknown'} />
                  <Stat label="Inference" value={`${selected.processing_time_ms ?? 0} ms`} />
                  <Stat label="Image size" value={`${selected.image_width || 0} x ${selected.image_height || 0}`} muted />
                </div>
                {annotatedUrl && <div className="preview-wrap annotated-wrap">
                  <div className="scan-line"></div>
                  <img className="preview-image" src={annotatedUrl} alt="Annotated MRI result" />
                </div>}
                <div className="detection-list">{(selected.detections || []).map((d, i) => <div className="detection" key={i}>
                  <span>#{i + 1}</span>
                  <strong>{d.class}</strong>
                  <b>{(d.confidence * 100).toFixed(1)}%</b>
                </div>)}</div>
                {explanation && <div className="insight-stack">
                  <div className="insight-card"><h3>AI Summary</h3><p>{explanation.summary}</p></div>
                  <div className="insight-card"><h3>Confidence Note</h3><p>{explanation.confidence_note}</p></div>
                  <div className="insight-card"><h3>Precautions</h3><ul>{(explanation.precautions || []).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                  <div className="insight-card"><h3>Possible Symptoms</h3><ul>{(explanation.symptoms || []).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                  <div className="insight-card"><h3>When To Seek Help</h3><p>{explanation.when_to_seek_help}</p></div>
                  <div className="insight-card disclaimer-box"><h3>Disclaimer</h3><p>{explanation.disclaimer}</p></div>
                </div>}
              </>}
            </section>
          </div>

          <section className="panel history-panel">
            <div className="panel-head"><span>03</span><div><h2>Analysis Queue</h2><p>Latest processed images</p></div></div>
            {results.length === 0 ? <EmptyState title="Queue is empty" text="Results will appear here after analysis." /> : <div className="table">
              <div className="trow thead"><span>FILE</span><span>STATUS</span><span>TYPE</span><span>CONFIDENCE</span></div>
              {results.map((r, i) => <div className="trow" key={r.request_id || i} onClick={() => setSelected(r)}>
                <span>{r.filename}</span>
                <span className={r.tumor_detected ? 'bad' : 'good'}>{r.tumor_detected ? 'TUMOR' : 'CLEAR'}</span>
                <span>{r.predicted_type || '-'}</span>
                <span>{r.best_confidence != null ? `${(r.best_confidence * 100).toFixed(1)}%` : '-'}</span>
              </div>)}
            </div>}
          </section>
        </>}

        {activePage === 'batch' && <section className="panel history-panel">
          <div className="panel-head"><span>01</span><div><h2>Batch Results</h2><p>Recent analyzed scans</p></div></div>
          {results.length === 0 ? <EmptyState title="No batch results yet" text="Analyze an image first to populate this workspace." /> : <div className="table">
            <div className="trow thead"><span>FILE</span><span>STATUS</span><span>TYPE</span><span>CONFIDENCE</span></div>
            {results.map((r, i) => <div className="trow" key={r.request_id || i} onClick={() => { setSelected(r); setActivePage('analysis') }}>
              <span>{r.filename}</span>
              <span className={r.tumor_detected ? 'bad' : 'good'}>{r.tumor_detected ? 'TUMOR' : 'CLEAR'}</span>
              <span>{r.predicted_type || '-'}</span>
              <span>{r.best_confidence != null ? `${(r.best_confidence * 100).toFixed(1)}%` : '-'}</span>
            </div>)}
          </div>}
        </section>}

        {activePage === 'model' && <section className="panel history-panel">
          <div className="panel-head"><span>01</span><div><h2>Model Status</h2><p>Current runtime details</p></div></div>
          <div className="page-actions">
            <button className="secondary" type="button" onClick={refresh}>Refresh status</button>
            <button className="secondary" type="button" onClick={() => navigator.clipboard.writeText(health?.model_path || '')}>Copy model path</button>
          </div>
          <div className="result-grid">
            <Stat label="Model loaded" value={modelReady ? 'READY' : 'NOT LOADED'} />
            <Stat label="Device" value={health?.device || 'Unknown'} />
            <Stat label="Backend" value={backendOnline ? 'Online' : 'Offline'} />
            <Stat label="Model path" value={health?.model_path || 'backend/models/best.pt'} muted />
          </div>
          <div className="insight-stack">
            <div className="insight-card"><h3>Classes</h3><p>glioma, meningioma, notumor, pituitary</p></div>
            <div className="insight-card"><h3>Current API</h3><p>{apiBase}</p></div>
            <div className="insight-card"><h3>Gemini Model</h3><p>{geminiModel}</p></div>
          </div>
        </section>}

        {activePage === 'logs' && <section className="panel logs-panel">
          <div className="panel-head"><span>01</span><div><h2>Model Logs</h2><p>Terminal-style evaluation trace</p></div></div>
          <div className="page-actions">
            <button className="secondary" type="button" onClick={() => setActivePage('model')}>Back to status</button>
            <button className="secondary" type="button" onClick={refresh}>Refresh backend</button>
          </div>
          <div className="terminal-shell">
            <div className="terminal-bar">
              <span className="terminal-dot red"></span>
              <span className="terminal-dot yellow"></span>
              <span className="terminal-dot green"></span>
              <strong>model@brain-tumor-ai</strong>
            </div>
            <div className="terminal-body">
              {!modelLogs ? <div className="terminal-line dim">No logs loaded yet. Refresh backend or check the training results files.</div> : <>
                <div className="terminal-line">[{new Date().toLocaleString()}] model_path = {modelLogs.model_path}</div>
                <div className="terminal-line">[{new Date().toLocaleString()}] device = {modelLogs.active_device}</div>
                <div className="terminal-line dim">recent upload logs = {modelLogs.recent_upload_logs?.length || 0}</div>
                {(modelLogs.recent_upload_logs || []).length === 0 ? <div className="terminal-line dim">No uploaded scan logs yet.</div> : (modelLogs.recent_upload_logs || []).map((entry, index) => <div className="terminal-block" key={entry.request_id || index}>
                  <div className="terminal-line bright">[{entry.timestamp}] {entry.filename}</div>
                  <div className="terminal-line terminal-row"><span>task={entry.task || '-'}</span></div>
                  <div className="terminal-line terminal-row"><span>status={entry.status || '-'}</span></div>
                  <div className="terminal-line terminal-row"><span>predicted={entry.predicted_type || '-'}</span></div>
                  <div className="terminal-line terminal-row"><span>tumor_detected={entry.tumor_detected ? 'yes' : 'no'}</span></div>
                  <div className="terminal-line terminal-row"><span>confidence={entry.best_confidence != null ? `${(entry.best_confidence * 100).toFixed(1)}%` : '-'}</span></div>
                  <div className="terminal-line terminal-row"><span>processing_time={entry.processing_time_ms != null ? `${entry.processing_time_ms} ms` : '-'}</span></div>
                  <div className="terminal-line terminal-row"><span>detections={entry.detections?.length || 0}</span></div>
                  {(entry.detections || []).map((d, detIndex) => <div className="terminal-line terminal-row" key={`${entry.request_id || index}-det-${detIndex}`}>
                    <span>{`#${detIndex + 1} ${d.class} ${((d.confidence || 0) * 100).toFixed(1)}%`}</span>
                  </div>)}
                </div>)}
              </>}
            </div>
          </div>
        </section>}

        {activePage === 'settings' && <section className="panel history-panel">
          <div className="panel-head"><span>01</span><div><h2>Settings</h2><p>Integration and safety notes</p></div></div>
          <div className="page-actions">
            <button className="secondary" type="button" onClick={saveSettings}>Save settings</button>
            <button className="secondary" type="button" onClick={() => setActivePage('analysis')}>Back to analysis</button>
          </div>
          <div className="insight-stack">
            <div className="insight-card">
              <h3>API Base URL</h3>
              <input className="text-input" value={apiBase} onChange={e => setApiBase(e.target.value)} />
            </div>
            <div className="insight-card">
              <h3>Gemini Model</h3>
              <input className="text-input" value={geminiModel} onChange={e => setGeminiModel(e.target.value)} />
            </div>
            <div className="insight-card"><h3>Gemini API</h3><p>Backend reads backend/.env, uses gemini_api, and generates readable scan explanations.</p></div>
            <div className="insight-card"><h3>Mode</h3><p>This app is currently configured for classification-based MRI analysis.</p></div>
            <div className="insight-card disclaimer-box"><h3>Safety</h3><p>Outputs are educational only and should not be treated as a medical diagnosis.</p></div>
          </div>
        </section>}

        <div className="disclaimer">Research / educational prototype. AI output is not a definitive medical diagnosis and must be reviewed by a qualified medical professional.</div>
      </section>
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
