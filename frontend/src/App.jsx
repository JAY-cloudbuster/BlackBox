import { useState, useEffect } from 'react'
import DocumentViewer from './components/DocumentViewer'
import ExplainabilitySidebar from './components/ExplainabilitySidebar'
import DocumentInput from './components/DocumentInput'
import ExportModal from './components/ExportModal'
import Logo from './components/Logo'
import { useEntityDecisions } from './hooks/useEntityDecisions'
import './App.css'

function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const docIdFromUrl = searchParams.get('doc');

  const [rawDoc, setRawDoc] = useState(null)
  const [showAiOriginal, setShowAiOriginal] = useState(false)
  const { document: doc, setOverride, resetOverride, userOverrides } = useEntityDecisions(rawDoc, showAiOriginal)
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeSpan, setActiveSpan] = useState(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [isExportModalOpen, setExportModalOpen] = useState(false)
  
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Rehydrate from URL on mount
  useEffect(() => {
    if (docIdFromUrl) {
      setLoading(true);
      fetch(`http://localhost:3000/api/documents/${docIdFromUrl}`)
        .then(async res => {
          let data;
          try {
            data = await res.json();
          } catch (e) {
            throw new Error(`Server returned an invalid response (Status: ${res.status}). Ensure the backend is running and up to date.`);
          }
          if (!res.ok) throw new Error(data.error || data.message || "Failed to load document");
          return data;
        })
        .then(data => {
          setRawDoc(data);
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
          setError(err.message);
          setLoading(false);
        });
    }
  }, [docIdFromUrl]);

  const handleAnalyze = async (text) => {
    const res = await fetch('http://localhost:3000/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    
    let data;
    try {
      data = await res.json();
    } catch (e) {
      const err = new Error(`Server returned an invalid response (Status: ${res.status}). Ensure the backend is running and up to date.`);
      err.code = res.status === 404 ? 'not_found' : 'invalid_response';
      throw err;
    }

    if (!res.ok) {
      const err = new Error(data.message || data.error || "Analysis failed");
      err.code = data.code || 'unknown';
      throw err;
    }
    
    setRawDoc(data);
    window.history.pushState({}, '', `?doc=${data.documentId}`);
  };

  const handleAnalyzeFile = async (file, setStep) => {
    setStep('extracting');
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetch('http://localhost:3000/api/documents/upload', {
      method: 'POST',
      body: formData
    });
    
    let data;
    try {
      data = await res.json();
    } catch (e) {
      const err = new Error(`Server returned an invalid response (Status: ${res.status}). Ensure the backend is running and up to date.`);
      err.code = res.status === 404 ? 'not_found' : 'invalid_response';
      throw err;
    }

    if (!res.ok) {
      const err = new Error(data.message || data.error || "Analysis failed");
      err.code = data.code || 'unknown';
      throw err;
    }
    
    setRawDoc(data);
    window.history.pushState({}, '', `?doc=${data.documentId}`);
  };

  const handleSpanClick = (span, index) => {
    setActiveSpan({ ...span, id: index })
  }

  const togglePreview = () => {
    setPreviewMode(!previewMode)
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo" onClick={() => { window.history.pushState({}, '', '/'); setRawDoc(null); setError(null); }} style={{cursor: 'pointer'}}>
          <Logo style={{ fontSize: '1.5rem', color: 'var(--accent-brand)' }} />
          <h1>Con<span style={{fontWeight: 800}}>seal</span></h1>
        </div>
        
        <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
          {doc && (
            <div className="doc-meta">
              <div className="toggle-container" onClick={togglePreview}>
                <span className={`toggle-label ${!previewMode ? 'active' : ''}`}>Audit View</span>
                <div className={`toggle-track ${previewMode ? 'active' : ''}`}>
                  <div className="toggle-thumb"></div>
                </div>
                <span className={`toggle-label ${previewMode ? 'active' : ''}`}>Export Preview</span>
              </div>

              <span className="status-badge" style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                <i className="fa-solid fa-check-circle"></i> AI Analysis Complete
                {doc.analysisLatencyMs && (
                  <span style={{fontSize: '0.8rem', opacity: 0.7, borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '0.5rem'}}>
                    <i className="fa-solid fa-bolt"></i> Analyzed in {(doc.analysisLatencyMs / 1000).toFixed(1)}s via Groq
                  </span>
                )}
              </span>
              <button className="secondary-btn" onClick={() => { window.history.pushState({}, '', '/'); setRawDoc(null); setError(null); }}>
                <i className="fa-solid fa-plus"></i> Add Another
              </button>
              <button className="primary-btn" onClick={() => setExportModalOpen(true)}>
                <i className="fa-solid fa-download"></i> Export Anonymized
              </button>
            </div>
          )}
          
          <button className="icon-btn theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle Theme">
            <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
          </button>
        </div>
      </header>

      {isExportModalOpen && (
        <ExportModal 
          onClose={() => setExportModalOpen(false)} 
          docId={doc.documentId} 
          userOverrides={userOverrides} 
        />
      )}

      <main className="main-content">
        {!doc && !loading && !error && (
          <DocumentInput onAnalyzeText={handleAnalyze} onAnalyzeFile={handleAnalyzeFile} />
        )}
        
        {loading && !doc && (
          <div className="ai-loading-state" style={{gridColumn: '1 / -1', minHeight: '50vh', position: 'relative', background: 'transparent', backdropFilter: 'none', border: 'none'}}>
            <div className="custom-loader"></div>
            <div className="loading-content" style={{marginTop: '2rem'}}>
              <h3 style={{color: 'var(--text-primary)'}}>Rehydrating Database Record...</h3>
            </div>
          </div>
        )}

        {error && !doc && (
          <div className="empty-state error-state" style={{gridColumn: '1 / -1'}}>
            <i className="fa-solid fa-triangle-exclamation" style={{fontSize: '3rem', color: 'var(--redacted-accent)'}}></i>
            <h3 style={{color: '#fff', marginTop: '1rem'}}>Failed to load document</h3>
            <p className="error-details">{error}</p>
            <button className="primary-btn" onClick={() => { window.history.pushState({}, '', '/'); setError(null); }} style={{marginTop: '1.5rem'}}>
              Start New Analysis
            </button>
          </div>
        )}

        {doc && (
          <>
            <DocumentViewer 
              doc={doc} 
              loading={false} 
              error={null} 
              activeSpan={activeSpan} 
              onSpanClick={handleSpanClick} 
              previewMode={previewMode}
              showAiOriginal={showAiOriginal}
              setShowAiOriginal={setShowAiOriginal}
              setOverride={setOverride}
              resetOverride={resetOverride}
            />
            <ExplainabilitySidebar 
              doc={doc}
              activeSpan={activeSpan} 
              previewMode={previewMode}
              setOverride={setOverride}
              resetOverride={resetOverride}
            />
          </>
        )}
      </main>
    </div>
  )
}

export default App
