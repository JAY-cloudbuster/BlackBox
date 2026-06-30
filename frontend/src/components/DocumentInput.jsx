import React, { useState, useRef } from 'react';
import { exampleDocuments } from '../constants/exampleDocuments';

export default function DocumentInput({ onAnalyzeText, onAnalyzeFile }) {
  const [mode, setMode] = useState('text'); // 'text' | 'file'
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  
  const [loadingStep, setLoadingStep] = useState(null); // 'extracting' | 'analyzing'
  const [error, setError] = useState(null);
  
  const fileInputRef = useRef(null);

  const [exampleIndex, setExampleIndex] = useState(0);

  const executeAnalyzeText = async (textToSubmit) => {
    if (!textToSubmit.trim()) return;
    setLoadingStep('analyzing');
    setError(null);
    try {
      await onAnalyzeText(textToSubmit);
    } catch (err) {
      setError({ message: err.message || 'Failed to analyze document.', code: err.code || 'unknown' });
      setLoadingStep(null);
    }
  };

  const handleSubmitText = async (e) => {
    e.preventDefault();
    executeAnalyzeText(text);
  };

  const handleTryExample = () => {
    const doc = exampleDocuments[exampleIndex];
    setText(doc.text);
    setMode('text');
    executeAnalyzeText(doc.text);
    setExampleIndex((prev) => (prev + 1) % exampleDocuments.length);
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected && selected.type === 'application/pdf') {
      setFile(selected);
      setError(null);
    } else if (selected) {
      setError({ message: "Only .pdf files are supported for upload.", code: 'invalid_file' });
      setFile(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type === 'application/pdf') {
      setFile(dropped);
      setError(null);
    } else if (dropped) {
      setError({ message: "Only .pdf files are supported for upload.", code: 'invalid_file' });
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleSubmitFile = async (e) => {
    e.preventDefault();
    if (!file) return;
    setLoadingStep('extracting');
    setError(null);
    try {
      await onAnalyzeFile(file, (step) => setLoadingStep(step));
    } catch (err) {
      setError({ message: err.message || 'Failed to analyze PDF.', code: err.code || 'unknown' });
      setLoadingStep(null);
    }
  };

  return (
    <div className="document-input-container explain-card">
      <div className="sidebar-header" style={{borderRadius: 0, display: 'flex', gap: '1rem', alignItems: 'center'}}>
        <div 
          onClick={() => !loadingStep && setMode('text')}
          style={{
            cursor: loadingStep ? 'not-allowed' : 'pointer', 
            padding: '0.5rem 1rem', 
            background: mode === 'text' ? 'rgba(255,255,255,0.1)' : 'transparent', 
            borderRadius: 0, 
            fontWeight: mode === 'text' ? '600' : '400',
            transition: 'all 0.2s'
          }}
        >
          Paste Text
        </div>
        <div 
          onClick={() => !loadingStep && setMode('file')}
          style={{
            cursor: loadingStep ? 'not-allowed' : 'pointer', 
            padding: '0.5rem 1rem', 
            background: mode === 'file' ? 'rgba(255,255,255,0.1)' : 'transparent', 
            borderRadius: 0, 
            fontWeight: mode === 'file' ? '600' : '400',
            transition: 'all 0.2s'
          }}
        >
          Upload PDF
        </div>
        
        <div style={{flex: 1}}></div>
        
        <button 
          onClick={handleTryExample}
          disabled={!!loadingStep}
          style={{
            background: 'var(--accent-primary)',
            color: '#fff',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: 0,
            cursor: loadingStep ? 'not-allowed' : 'pointer',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            opacity: loadingStep ? 0.5 : 1,
            transition: 'all 0.2s'
          }}
        >
          <i className="fa-solid fa-bolt"></i> Try Example Document
        </button>
      </div>
      <div style={{padding: '2rem'}}>
        {error && (
          <div className="status-box shredded" style={{
            marginBottom: '1.5rem', 
            background: error.code === 'rate_limited' ? 'rgba(245, 158, 11, 0.1)' : error.code === 'timeout' ? 'rgba(139, 92, 246, 0.1)' : undefined, 
            borderColor: error.code === 'rate_limited' ? '#f59e0b' : error.code === 'timeout' ? '#8b5cf6' : undefined
          }}>
            <i className={`fa-solid ${error.code === 'rate_limited' ? 'fa-hourglass-half' : error.code === 'timeout' ? 'fa-stopwatch' : 'fa-triangle-exclamation'}`} 
               style={{color: error.code === 'rate_limited' ? '#f59e0b' : error.code === 'timeout' ? '#8b5cf6' : undefined}}></i>
            <div>
              <div className="status-title" style={{color: error.code === 'rate_limited' ? '#f59e0b' : error.code === 'timeout' ? '#8b5cf6' : undefined}}>
                {error.code === 'rate_limited' ? 'Too Many Requests' : error.code === 'timeout' ? 'Analysis Timeout' : error.code === 'invalid_schema' ? 'Schema Error' : 'Analysis Failed'}
              </div>
              <div className="status-desc" style={{color: error.code === 'rate_limited' ? '#fcd34d' : error.code === 'timeout' ? '#c4b5fd' : undefined}}>
                {error.message}
              </div>
            </div>
          </div>
        )}

        {mode === 'text' ? (
          <form onSubmit={handleSubmitText}>
            <textarea
              className="document-textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste sensitive text here (e.g. emails, medical notes, financial records)..."
              disabled={!!loadingStep}
            ></textarea>
            
            <div style={{display: 'flex', gap: '1rem', marginTop: '1.5rem'}}>
              <button 
                type="submit" 
                className="primary-btn" 
                style={{flex: 1, justifyContent: 'center'}}
                disabled={!!loadingStep || !text.trim()}
              >
                {loadingStep === 'analyzing' ? (
                  <><i className="fa-solid fa-circle-notch fa-spin"></i> Analyzing with Groq LLM...</>
                ) : (
                  <><i className="fa-solid fa-brain"></i> Analyze Text</>
                )}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmitFile}>
            <div 
              onClick={() => !loadingStep && fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              style={{
                border: '2px dashed var(--border-glass)', 
                borderRadius: 0, 
                padding: '3rem 2rem', 
                textAlign: 'center', 
                cursor: loadingStep ? 'not-allowed' : 'pointer', 
                background: 'rgba(15,23,42,0.4)', 
                color: 'var(--text-secondary)',
                transition: 'all 0.2s ease'
              }}
            >
              <i className="fa-solid fa-file-pdf" style={{fontSize: '3rem', color: file ? 'var(--accent-primary)' : 'var(--text-secondary)', marginBottom: '1rem'}}></i>
              <h3 style={{color: 'var(--text-primary)'}}>{file ? file.name : 'Drag & Drop or Click to Select PDF'}</h3>
              <p style={{fontSize: '0.875rem', marginTop: '1rem', color: 'var(--text-secondary)', lineHeight: 1.5}}>
                PDF text will be extracted and redacted. Export will produce a clean redacted PDF — original formatting and layout are not preserved in this version.
              </p>
              <input 
                type="file" 
                accept="application/pdf" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                style={{display: 'none'}}
                disabled={!!loadingStep}
              />
            </div>
            <div style={{display: 'flex', gap: '1rem', marginTop: '1.5rem'}}>
              <button 
                type="submit" 
                className="primary-btn" 
                style={{flex: 1, justifyContent: 'center'}}
                disabled={!!loadingStep || !file}
              >
                {loadingStep === 'extracting' ? (
                  <><i className="fa-solid fa-file-export fa-bounce"></i> Extracting Text & Analyzing PDF...</>
                ) : loadingStep === 'analyzing' ? (
                  <><i className="fa-solid fa-circle-notch fa-spin"></i> Analyzing with Groq LLM...</>
                ) : (
                  <><i className="fa-solid fa-brain"></i> Analyze PDF</>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
