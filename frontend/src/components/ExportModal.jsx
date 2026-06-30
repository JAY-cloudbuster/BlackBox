import React, { useState } from 'react';

export default function ExportModal({ onClose, docId, userOverrides }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);

  const handleExport = async (format) => {
    setLoading(format);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3000/api/documents/${docId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, overrides: userOverrides })
      });
      
      if (!res.ok) {
        let data;
        try {
          data = await res.json();
        } catch (e) {
          throw new Error(`Export endpoint not found or invalid response (Status: ${res.status}). Restart the backend.`);
        }
        throw new Error(data.message || 'Export failed');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conseal-export-${docId}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      onClose();
    } catch (err) {
      setError(err.message);
      setLoading(null);
    }
  };

  return (
    <div className="modal-backdrop" style={backdropStyle}>
      <div className="explain-card" style={modalStyle}>
        <div className="sidebar-header" style={{borderRadius: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <h3 style={{margin: 0}}>Export Anonymized Case File</h3>
          <button onClick={onClose} style={{background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem'}}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        
        <div style={{padding: '2rem'}}>
          <p style={{marginBottom: '1.5rem', color: 'var(--text-secondary)'}}>
            Select a format to download. Redacted entities will be replaced with block characters, while visible entities will remain unchanged.
          </p>

          {error && (
            <div className="status-box shredded" style={{marginBottom: '1.5rem'}}>
              <i className="fa-solid fa-triangle-exclamation"></i>
              <div>
                <div className="status-title">Export Failed</div>
                <div className="status-desc">{error}</div>
              </div>
            </div>
          )}

          <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
            <button 
              className="primary-btn" 
              onClick={() => handleExport('pdf')}
              disabled={loading !== null}
              style={{justifyContent: 'center'}}
            >
              {loading === 'pdf' ? <><i className="fa-solid fa-circle-notch fa-spin"></i> Generating PDF...</> : <><i className="fa-solid fa-file-pdf"></i> Export as PDF Document</>}
            </button>
            <button 
              className="primary-btn" 
              onClick={() => handleExport('docx')}
              disabled={loading !== null}
              style={{justifyContent: 'center', background: 'var(--bg-panel)', border: '1px solid var(--border-glass)', boxShadow: 'none'}}
            >
              {loading === 'docx' ? <><i className="fa-solid fa-circle-notch fa-spin"></i> Generating Word...</> : <><i className="fa-solid fa-file-word"></i> Export as Word (.docx)</>}
            </button>
            <button 
              className="primary-btn" 
              onClick={() => handleExport('txt')}
              disabled={loading !== null}
              style={{justifyContent: 'center', background: 'var(--bg-panel)', border: '1px solid var(--border-glass)', boxShadow: 'none'}}
            >
              {loading === 'txt' ? <><i className="fa-solid fa-circle-notch fa-spin"></i> Generating Text...</> : <><i className="fa-solid fa-file-lines"></i> Export as Plain Text (.txt)</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const backdropStyle = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(15, 23, 42, 0.8)',
  backdropFilter: 'blur(4px)',
  zIndex: 1000,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center'
};

const modalStyle = {
  width: '100%',
  maxWidth: '500px',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
};
