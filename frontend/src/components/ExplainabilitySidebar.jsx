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

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!doc || !doc.entities || doc.entities.length === 0 || previewMode) return;

      // Prevent interacting with inputs/textareas
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        let nextIndex = 0;
        if (activeSpan) {
          const idx = doc.entities.findIndex(ent => ent.id === activeSpan.id);
          nextIndex = (idx + 1) % doc.entities.length;
        }
        window.dispatchEvent(new CustomEvent('conseal:select-entity', { detail: doc.entities[nextIndex] }));
      }
      
      if (activeSpan) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setOverride(activeSpan.id, 'redact');
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          setOverride(activeSpan.id, 'show');
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [doc, activeSpan, previewMode, setOverride]);

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

  const [selectedFlags, setSelectedFlags] = useState(new Set());

  const handleToggleFlag = (id) => {
    const newSet = new Set(selectedFlags);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedFlags(newSet);
  };

  const handleBulkDelete = () => {
    selectedFlags.forEach(id => {
      setOverride(id, 'show');
    });
    setSelectedFlags(new Set());
  };

  if (!activeSpan) {
    return (
      <aside className="explain-sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="sidebar-header">
          <h3>Explainability Engine</h3>
          <p>Document Analysis Complete</p>
        </div>
        <div className="sidebar-content hide-scrollbar" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <SummaryPanel doc={doc} />
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>All Detected Entities</h4>
            {selectedFlags.size > 0 && (
              <button 
                onClick={handleBulkDelete}
                className="icon-btn" 
                style={{ color: 'var(--accent-red)', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                title="Mark selected as visible (delete redaction)"
              >
                <i className="fa-solid fa-trash"></i> Delete Selected
              </button>
            )}
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {doc.entities && doc.entities.length === 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', marginTop: '1rem' }}>No entities detected.</p>
            )}
            {doc.entities && doc.entities.map(entity => {
              const isHidden = entity.finalDisplayAction === 'redact';
              
              let statusColor = 'var(--text-secondary)';
              if (isHidden) statusColor = 'var(--accent-red)';
              else if (entity.finalDisplayAction === 'flag') statusColor = '#f59e0b';
              else statusColor = '#10b981';

              return (
                <div key={entity.id} style={{ display: 'flex', alignItems: 'center', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: '4px' }}>
                  <input 
                    type="checkbox" 
                    checked={selectedFlags.has(entity.id)} 
                    onChange={() => handleToggleFlag(entity.id)}
                    style={{ marginRight: '0.75rem', cursor: 'pointer' }}
                  />
                  <div 
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} 
                    onClick={() => {
                      // Fire a custom event to select the span in App.jsx
                      // Since we don't have setActiveSpan prop, we can dispatch a custom event
                      // Or wait! activeSpan is passed, but we don't have a setter for it?
                      // We can dispatch an event that App.jsx listens to, or just tell the user to click in document.
                      // Let's fire a custom event just in case App.jsx can listen to it.
                      window.dispatchEvent(new CustomEvent('conseal:select-entity', { detail: entity }));
                    }}
                  >
                    <div style={{ fontWeight: '500', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={entity.text}>
                      {entity.text}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: statusColor, display: 'flex', gap: '0.5rem' }}>
                      <span>{entity.entityType}</span>
                      <span>•</span>
                      <span>{isHidden ? 'Redacted' : (entity.finalDisplayAction === 'flag' ? 'Flagged' : 'Visible')}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
              aria-label="Keep this entity visible"
            >
              <i className="fa-solid fa-eye"></i> Show This
            </button>
          </div>
          <div style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem'}}>
            <button 
              className="primary-btn inactive-override"
              onClick={() => {
                const matches = doc.entities.filter(e => e.text.toLowerCase() === activeSpan.text.toLowerCase());
                matches.forEach(m => setOverride(m.id, 'redact'));
              }}
              disabled={previewMode}
              style={{flex: 1, justifyContent: 'center', fontSize: '0.8rem', padding: '0.4rem'}}
              title={`Hide all instances of "${activeSpan.text}"`}
            >
              <i className="fa-solid fa-list-check"></i> Hide All ({doc.entities.filter(e => e.text.toLowerCase() === activeSpan.text.toLowerCase()).length})
            </button>
            <button 
              className="primary-btn inactive-override"
              onClick={() => {
                const matches = doc.entities.filter(e => e.text.toLowerCase() === activeSpan.text.toLowerCase());
                matches.forEach(m => setOverride(m.id, 'show'));
              }}
              disabled={previewMode}
              style={{flex: 1, justifyContent: 'center', fontSize: '0.8rem', padding: '0.4rem'}}
              title={`Show all instances of "${activeSpan.text}"`}
            >
              <i className="fa-solid fa-list-check"></i> Show All ({doc.entities.filter(e => e.text.toLowerCase() === activeSpan.text.toLowerCase()).length})
            </button>
          </div>
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
    </aside>
  );
}
