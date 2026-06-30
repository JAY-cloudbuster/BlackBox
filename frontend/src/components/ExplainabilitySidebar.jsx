import React, { useState, useEffect } from 'react';
import SummaryPanel from './SummaryPanel';

export default function ExplainabilitySidebar({ doc, activeSpan, previewMode, setOverride, resetOverride }) {
  const [isValueVisible, setIsValueVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('redaction');

  useEffect(() => {
    setIsValueVisible(false);
    if (activeSpan?.aiLayer === 'visible') {
      setActiveTab('whynot');
    } else {
      setActiveTab('redaction');
    }
  }, [activeSpan?.id, activeSpan?.aiLayer]);
  if (!doc) {
    return (
      <aside className="explain-sidebar">
        <div className="sidebar-header">
          <h3>Explainability Engine</h3>
          <p>Waiting for document...</p>
        </div>
      </aside>
    )
  }

  if (!activeSpan) {
    return (
      <aside className="explain-sidebar">
        <div className="sidebar-header">
          <h3>Explainability Engine</h3>
          <p>Document Analysis Complete</p>
        </div>
        <div className="sidebar-content">
          <SummaryPanel doc={doc} />
          <p style={{color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center'}}>
            Click any highlighted entity in the document to see why the AI flagged it and manage overrides.
          </p>
        </div>
      </aside>
    )
  }

  const isHidden = activeSpan.finalDisplayAction === 'redact';
  const statusClass = isHidden ? (previewMode ? 'shredded' : 'redacted') : 'visible';
  const statusText = isHidden ? (previewMode ? 'SHREDDED' : 'REDACTED') : 'VISIBLE';

  return (
    <aside className="explain-sidebar">
      <div className="sidebar-header">
        <h3>Explainability Engine</h3>
        <p>Entity Inspector</p>
      </div>
      
      <div className="sidebar-content explain-card" style={{ display: 'flex', flexDirection: 'column' }}>
        
        {activeTab === 'redaction' && (
          <div style={{ flex: 1 }}>
            <div className="card-label">Entity Detected</div>
            <div className="card-value" style={isHidden && (!isValueVisible || previewMode) ? {fontFamily: 'monospace', letterSpacing: '2px'} : {}}>
              {isHidden && (!isValueVisible || previewMode) ? '█'.repeat(activeSpan.text.length) : activeSpan.text}
            </div>
            
            {isHidden && !previewMode && (
              <button 
                className="primary-btn" 
                onClick={() => setIsValueVisible(!isValueVisible)}
                style={{padding: '0.4rem 0.8rem', fontSize: '0.8rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)'}}
              >
                <i className={`fa-solid ${isValueVisible ? 'fa-eye-slash' : 'fa-eye'}`}></i> 
                {isValueVisible ? "Hide Content" : "See Value"}
              </button>
            )}

            <div className={`status-box ${statusClass}`}>
              <i className={`fa-solid ${isHidden ? 'fa-eye-slash' : 'fa-eye'}`}></i>
              <div>
                <div className="status-title">Current State: {statusText}</div>
                <div className="status-desc">
                  {activeSpan.isModified 
                    ? "You have overridden the AI's default suggestion." 
                    : "This is the AI's default suggestion based on the layer."}
                </div>
              </div>
            </div>

            <div className="meta-grid">
              <div className="meta-item">
                <div className="meta-label">Entity Type</div>
                <div className="meta-val">{activeSpan.entityType}</div>
              </div>
              <div className="meta-item">
                <div className="meta-label">AI Layer</div>
                <div className="meta-val" style={{textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                  {activeSpan.aiLayer}
                  {activeSpan.was_calibrated && (
                    <span title="Safety Calibrated: Automatically downgraded to flag for human review due to low confidence." style={{color: '#f59e0b', fontSize: '0.9rem', padding: '2px 6px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: 0, border: '1px solid rgba(245, 158, 11, 0.3)'}}>
                      <i className="fa-solid fa-shield-halved"></i> Safety Calibrated
                    </span>
                  )}
                </div>
              </div>
              <div className="meta-item">
                <div className="meta-label">AI Confidence</div>
                <div className="meta-val">{activeSpan.aiConfidence}%</div>
                <div className="confidence-bar-bg">
                  <div className="confidence-bar-fill" style={{width: `${activeSpan.aiConfidence}%`}}></div>
                </div>
              </div>
              <div className="meta-item">
                <div className="meta-label">Default Action</div>
                <div className="meta-val" style={{textTransform: 'uppercase'}}>{activeSpan.defaultAction}</div>
              </div>
            </div>

            <div className="reasoning-section">
              <h4>Why was this flagged?</h4>
              <div className="reasoning-text">
                {activeSpan.aiReasoning}
              </div>
            </div>

            <div className="override-section" style={{marginTop: '2rem', borderTop: '1px solid var(--border-glass)', paddingTop: '1.5rem'}}>
              <h4>User Override Controls</h4>
              <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem'}}>
                Manually override the AI's layer classification.
              </p>
              <div style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap'}}>
                <button 
                  className={`primary-btn ${activeSpan.finalDisplayAction === 'redact' ? 'active-override' : 'inactive-override'}`}
                  onClick={() => setOverride(activeSpan.id, 'redact')}
                  disabled={previewMode}
                  style={{flex: 1, justifyContent: 'center'}}
                  aria-label="Hide this entity"
                >
                  <i className="fa-solid fa-eye-slash"></i> Hide This
                </button>
                <button 
                  className={`primary-btn ${activeSpan.finalDisplayAction !== 'redact' ? 'active-override' : 'inactive-override'}`}
                  onClick={() => setOverride(activeSpan.id, 'show')}
                  disabled={previewMode}
                  style={{flex: 1, justifyContent: 'center'}}
                  aria-label="Show this entity"
                >
                  <i className="fa-solid fa-eye"></i> Show This
                </button>
                {activeSpan.isModified && (
                  <button 
                    className="primary-btn"
                    onClick={() => resetOverride(activeSpan.id)}
                    disabled={previewMode}
                    style={{width: '100%', marginTop: '0.5rem', background: 'transparent', border: '1px solid var(--border-glass)', color: 'var(--text-primary)'}}
                  >
                    <i className="fa-solid fa-rotate-left"></i> Reset to AI Suggestion
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'whynot' && (
          <div style={{ flex: 1, animation: 'slideIn 0.3s' }}>
            <div className="card-label">Entity Detected</div>
            <div className="card-value">{activeSpan.text}</div>
            
            <div className="status-box visible" style={{ marginBottom: '1.5rem' }}>
              <i className="fa-solid fa-eye"></i>
              <div>
                <div className="status-title">Deliberately Kept Visible</div>
                <div className="status-desc">This entity was classified as safe to expose.</div>
              </div>
            </div>

            <div className="meta-grid">
              <div className="meta-item">
                <div className="meta-label">Entity Type</div>
                <div className="meta-val">{activeSpan.entityType}</div>
              </div>
              <div className="meta-item">
                <div className="meta-label">AI Layer</div>
                <div className="meta-val" style={{textTransform: 'capitalize'}}>{activeSpan.aiLayer}</div>
              </div>
            </div>

            <div className="reasoning-section">
              <h4>Why was this kept visible?</h4>
              <div className="reasoning-text" style={{ borderLeftColor: 'var(--visible-accent)', background: 'rgba(16, 185, 129, 0.1)' }}>
                {activeSpan.aiReasoning}
              </div>
            </div>
          </div>
        )}

        <div className="sidebar-tabs" style={{ display: 'flex', borderTop: '1px solid var(--border-glass)', marginTop: '2rem', paddingTop: '0.5rem' }}>
          <button 
            onClick={() => setActiveTab('redaction')}
            disabled={activeSpan.aiLayer === 'visible'}
            title={activeSpan.aiLayer === 'visible' ? "This item was kept visible — see the Why Not tab" : ""}
            style={{ 
              flex: 1, 
              padding: '1rem', 
              background: 'none', 
              border: 'none', 
              borderBottom: activeTab === 'redaction' ? '2px solid var(--accent-primary)' : '2px solid transparent', 
              color: activeTab === 'redaction' ? 'var(--text-primary)' : 'var(--text-secondary)', 
              cursor: activeSpan.aiLayer === 'visible' ? 'not-allowed' : 'pointer', 
              fontWeight: 500, 
              opacity: activeSpan.aiLayer === 'visible' ? 0.3 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            Redaction
          </button>
          <button 
            onClick={() => setActiveTab('whynot')}
            disabled={activeSpan.aiLayer !== 'visible'}
            title={activeSpan.aiLayer !== 'visible' ? "This item was flagged — see the Redaction tab" : ""}
            style={{ 
              flex: 1, 
              padding: '1rem', 
              background: 'none', 
              border: 'none', 
              borderBottom: activeTab === 'whynot' ? '2px solid var(--visible-accent)' : '2px solid transparent', 
              color: activeTab === 'whynot' ? 'var(--text-primary)' : 'var(--text-secondary)', 
              cursor: activeSpan.aiLayer !== 'visible' ? 'not-allowed' : 'pointer', 
              fontWeight: 500, 
              opacity: activeSpan.aiLayer !== 'visible' ? 0.3 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            Why Not?
          </button>
        </div>
      </div>
    </aside>
  );
}
