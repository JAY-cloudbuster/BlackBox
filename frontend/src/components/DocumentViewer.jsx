import React from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function DocumentViewer({ doc, loading, error, activeSpan, onSpanClick, previewMode, showAiOriginal, setShowAiOriginal }) {
  const [numPages, setNumPages] = React.useState(null);
  const [viewMode, setViewMode] = React.useState('text'); // 'text' or 'pdf'

  const isPdf = doc && doc.sourceFilename && doc.sourceFilename.toLowerCase().endsWith('.pdf');

  // --- Text-based sweep-line renderer (polished inline pills) ---
  const renderTextWithOverlaps = () => {
    if (!doc || !doc.plainTextDocument) return null;
    const text = doc.plainTextDocument;
    const entities = doc.entities || [];
    
    let boundaries = new Set([0, text.length]);
    entities.forEach(e => {
      boundaries.add(e.startIndex);
      boundaries.add(e.endIndex);
    });
    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
    
    const chunks = [];
    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
      const start = sortedBoundaries[i];
      const end = sortedBoundaries[i+1];
      const chunkText = text.slice(start, end);
      const activeEntities = entities.filter(e => e.startIndex <= start && e.endIndex >= end);
      chunks.push({ start, end, text: chunkText, entities: activeEntities });
    }
    
    return chunks.map((chunk, idx) => {
      if (chunk.entities.length === 0) {
        return <span key={idx}>{chunk.text}</span>;
      }
      
      const sortedEntities = [...chunk.entities].sort((a, b) => (a.endIndex - a.startIndex) - (b.endIndex - b.startIndex));
      let element = <>{chunk.text}</>;
      
      for (const entity of sortedEntities) {
        let elementContent = null;
        let isPill = false;
        let spanClass = '';

        if (!previewMode && (entity.finalDisplayAction === 'redact' || entity.finalDisplayAction === 'flag')) {
          isPill = true;
          spanClass = `entity-pill entity-pill--${entity.finalDisplayAction} `;
          if (activeSpan && activeSpan.id === entity.id) spanClass += 'active ';
          
          if (chunk.start === entity.startIndex) {
            elementContent = (
              <>
                {entity.finalDisplayAction === 'flag' && <i className="fa-solid fa-circle-dot" style={{fontSize: '8px', marginRight: '6px', opacity: 0.9}}></i>}
                {entity.entityType}
                {entity.isModified && <i className="fa-solid fa-pen" style={{fontSize: '9px', marginLeft: '4px', opacity: 0.8}}></i>}
              </>
            );
          } else {
            elementContent = null;
          }
        } else {
          spanClass = 'pii-span ';
          if (entity.finalDisplayAction === 'redact') {
            spanClass += 'pii-redacted ';
            if (previewMode) spanClass += 'shredded ';
          } else if (entity.finalDisplayAction === 'flag') {
            spanClass += 'pii-flagged ';
          } else if (entity.finalDisplayAction === 'show') {
            spanClass += 'pii-visible ';
          }
          if (entity.isModified) spanClass += 'is-modified ';
          if (activeSpan && activeSpan.id === entity.id) spanClass += 'active ';

          elementContent = (
            <>
              {previewMode && entity.finalDisplayAction === 'redact' ? '█'.repeat(chunk.text.length) : element}
              {entity.isModified && !previewMode && <i className="fa-solid fa-pen modifier-badge"></i>}
              {!entity.isModified && entity.finalDisplayAction === 'flag' && !previewMode && <i className="fa-solid fa-flag modifier-badge"></i>}
            </>
          );
        }

        element = elementContent !== null ? (
          <span 
            className={spanClass}
            onClick={(e) => { e.stopPropagation(); onSpanClick(entity, entity.id); }}
            title={entity.isModified ? "User Modified Override" : `AI Layer: ${entity.layer}`}
          >
            {elementContent}
          </span>
        ) : <></>;
      }
      return <React.Fragment key={idx}>{element}</React.Fragment>;
    });
  };

  // --- Entity summary bar for PDF view ---
  const renderEntitySummaryBar = () => {
    if (!doc || !doc.entities) return null;
    const redacted = doc.entities.filter(e => e.finalDisplayAction === 'redact');
    const flagged = doc.entities.filter(e => e.finalDisplayAction === 'flag');
    const visible = doc.entities.filter(e => e.finalDisplayAction === 'show');

    return (
      <div className="pdf-entity-bar">
        <div className="pdf-entity-bar__header">
          <i className="fa-solid fa-shield-halved"></i>
          <span>Detected Entities</span>
          <span className="pdf-entity-bar__count">{doc.entities.length} total</span>
        </div>
        <div className="pdf-entity-bar__chips">
          {redacted.map(e => (
            <span 
              key={e.id} 
              className={`pdf-entity-chip pdf-entity-chip--redact ${activeSpan && activeSpan.id === e.id ? 'active' : ''}`}
              onClick={() => onSpanClick(e, e.id)}
            >
              <i className="fa-solid fa-lock" style={{fontSize: '9px'}}></i>
              {e.entityType}
            </span>
          ))}
          {flagged.map(e => (
            <span 
              key={e.id} 
              className={`pdf-entity-chip pdf-entity-chip--flag ${activeSpan && activeSpan.id === e.id ? 'active' : ''}`}
              onClick={() => onSpanClick(e, e.id)}
            >
              <i className="fa-solid fa-circle-dot" style={{fontSize: '8px'}}></i>
              {e.entityType}
            </span>
          ))}
          {visible.map(e => (
            <span 
              key={e.id} 
              className={`pdf-entity-chip pdf-entity-chip--show ${activeSpan && activeSpan.id === e.id ? 'active' : ''}`}
              onClick={() => onSpanClick(e, e.id)}
            >
              {e.entityType}
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="document-viewer">
      <div className="document-header">
        <h2>{doc ? doc.title || "AI Case File Analysis" : 'Loading Document...'}</h2>
        <div className="confidence-legend">
          <span className="legend-item">
            <span className="color-box redacted"></span> Critical (Redacted)
          </span>
          <span className="legend-item">
            <span className="color-box flagged"></span> Ambiguous (Flagged)
          </span>
          <span className="legend-item">
            <span className="color-box visible"></span> Visible (Safe)
          </span>
        </div>
      </div>

      {/* View mode toggle for PDFs */}
      {isPdf && doc && !loading && !error && (
        <div className="pdf-view-toggle">
          <button 
            className={`pdf-view-toggle__btn ${viewMode === 'text' ? 'active' : ''}`}
            onClick={() => setViewMode('text')}
          >
            <i className="fa-solid fa-font"></i> Redaction View
          </button>
          <button 
            className={`pdf-view-toggle__btn ${viewMode === 'pdf' ? 'active' : ''}`}
            onClick={() => setViewMode('pdf')}
          >
            <i className="fa-solid fa-file-pdf"></i> Original PDF
          </button>
        </div>
      )}

      <div className="document-body">
        {loading ? (
          <div className="ai-loading-state">
            <div className="pulse-ring"></div>
            <div className="loading-content">
              <i className="fa-solid fa-brain fa-fade" style={{fontSize: '3rem', color: 'var(--accent-primary)', marginBottom: '1rem'}}></i>
              <h3>Live 3-Layer AI Analysis...</h3>
              <p>Connecting to Groq LLM and classifying entities.</p>
            </div>
          </div>
        ) : error ? (
          <div className="empty-state error-state">
            <i className="fa-solid fa-triangle-exclamation" style={{color: 'var(--redacted-accent)'}}></i>
            <h3 style={{color: '#fff'}}>AI Engine Failure</h3>
            <p className="error-details" style={{background: 'rgba(244, 63, 94, 0.1)', padding: '1rem', borderRadius: 0, border: '1px solid rgba(244, 63, 94, 0.3)', color: '#fda4af', marginTop: '1rem', fontSize: '0.9rem', maxWidth: '80%'}}>
              {error}
            </p>
          </div>
        ) : (
          <>
            {doc && doc.entities && !previewMode && (
              <div style={{display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem'}}>
                <div className="toggle-container" onClick={() => setShowAiOriginal(!showAiOriginal)} style={{margin: 0, padding: '0.25rem', background: 'rgba(255,255,255,0.05)'}}>
                  <span className={`toggle-label ${showAiOriginal ? 'active' : ''}`} style={{fontSize: '0.8rem'}}>AI Original</span>
                  <div className={`toggle-track ${!showAiOriginal ? 'active' : ''}`} style={{transform: 'scale(0.8)'}}>
                    <div className="toggle-thumb"></div>
                  </div>
                  <span className={`toggle-label ${!showAiOriginal ? 'active' : ''}`} style={{fontSize: '0.8rem'}}>Final (Reviewed)</span>
                </div>
              </div>
            )}
            
            {showAiOriginal && !previewMode && (
              <div style={{background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', padding: '0.75rem 1rem', borderRadius: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#fcd34d'}}>
                <i className="fa-solid fa-eye-slash" style={{fontSize: '1.2rem'}}></i>
                <div>
                  <div style={{fontWeight: 600, fontSize: '0.9rem'}}>Viewing AI's original recommendation</div>
                  <div style={{fontSize: '0.8rem', opacity: 0.9}}>
                    User overrides are temporarily hidden. Switch back to "Final (Reviewed)" to see your applied changes.
                  </div>
                </div>
              </div>
            )}

            {previewMode && doc && doc.entities && (
              <div style={{background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--visible-accent)', padding: '0.75rem 1rem', borderRadius: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#6ee7b7'}}>
                <i className="fa-solid fa-file-export" style={{fontSize: '1.2rem'}}></i>
                <div>
                  <div style={{fontWeight: 600, fontSize: '0.9rem'}}>Export Preview Active</div>
                  <div style={{fontSize: '0.8rem', opacity: 0.9}}>
                    {doc.entities.filter(e => e.isModified).length} entity overrides applied. The redacted text shown below is completely scrubbed from the UI payload.
                  </div>
                </div>
              </div>
            )}

            {/* Text-based redaction view (default, works for both text and PDF) */}
            {viewMode === 'text' && (
              <>
                {isPdf && (
                  <div className="pdf-source-badge">
                    <i className="fa-solid fa-file-pdf"></i>
                    <span>Source: <strong>{doc.sourceFilename}</strong></span>
                    <span className="pdf-source-badge__hint">Switch to "Original PDF" tab to see the native layout</span>
                  </div>
                )}
                {renderTextWithOverlaps()}
              </>
            )}

            {/* Native PDF view with entity summary */}
            {viewMode === 'pdf' && isPdf && (
              <div className="pdf-native-view">
                {renderEntitySummaryBar()}
                <div className="pdf-pages-container">
                  <Document 
                    file={`http://localhost:3000/api/documents/${doc.id}/download-original`} 
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    loading={<div className="pdf-loading">Loading PDF...</div>}
                  >
                    {Array.from(new Array(numPages || 0), (el, index) => (
                      <div key={`page_${index + 1}`} className="pdf-page-wrapper">
                        <Page 
                          pageNumber={index + 1} 
                          renderTextLayer={false} 
                          renderAnnotationLayer={false} 
                          width={580} 
                        />
                        <div className="pdf-page-number">Page {index + 1}</div>
                      </div>
                    ))}
                  </Document>
                </div>
              </div>
            )}

            {/* Fallback for non-PDF text mode */}
            {viewMode === 'pdf' && !isPdf && renderTextWithOverlaps()}
          </>
        )}
      </div>
    </section>
  );
}
