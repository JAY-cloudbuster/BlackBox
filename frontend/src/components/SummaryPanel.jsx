import React, { useState } from 'react';

export default function SummaryPanel({ doc }) {
  if (!doc || !doc.entities || doc.entities.length === 0) return null;

  const entities = doc.entities;
  const totalEntities = entities.length;
  
  const criticalCount = entities.filter(e => e.aiLayer === 'critical').length;
  const ambiguousCount = entities.filter(e => e.aiLayer === 'ambiguous').length;
  const visibleCount = entities.filter(e => e.aiLayer === 'visible').length;

  const totalOverrides = entities.filter(e => e.isModified).length;

  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [auditTrail, setAuditTrail] = useState(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const toggleAudit = async () => {
    if (!isAuditOpen && !auditTrail) {
      setLoadingAudit(true);
      try {
        const res = await fetch(`http://localhost:3000/api/documents/${doc.documentId}/audit-trail`);
        const data = await res.json();
        setAuditTrail(data);
      } catch (e) {
        console.error("Failed to load audit trail", e);
      }
      setLoadingAudit(false);
    }
    setIsAuditOpen(!isAuditOpen);
  };

  const groupedAudit = {};
  if (auditTrail) {
    auditTrail.forEach(entry => {
      if (!groupedAudit[entry.entity_id]) {
        groupedAudit[entry.entity_id] = {
          id: entry.entity_id,
          text: entry.text,
          type: entry.entity_type,
          layer: entry.layer,
          confidence: entry.confidence_score,
          reasoning: entry.reasoning,
          defaultAction: entry.default_action,
          wasCalibrated: entry.was_calibrated === 1,
          events: []
        };
      }
      groupedAudit[entry.entity_id].events.push({
        action: entry.override_action,
        timestamp: entry.override_timestamp
      });
    });
  }
  
  // Breakdown
  const redactedToVisible = entities.filter(e => e.defaultAction !== 'show' && e.finalDisplayAction === 'show').length;
  const visibleToRedacted = entities.filter(e => e.defaultAction === 'show' && e.finalDisplayAction === 'redact').length;

  const avgConfidence = Math.round(
    entities.reduce((acc, curr) => acc + (curr.aiConfidence || 0), 0) / totalEntities
  );

  return (
    <div className="summary-panel explain-card" style={{marginBottom: '2rem', background: 'rgba(15, 23, 42, 0.6)', borderRadius: 0, border: '1px solid var(--border-glass)', overflow: 'hidden'}}>
      <div className="sidebar-header" style={{padding: '1rem', background: 'transparent', borderBottom: '1px solid var(--border-glass)'}}>
        <h4 style={{margin: 0, color: 'var(--accent-primary)', fontSize: '1rem'}}>AI Analysis Summary</h4>
      </div>
      
      <div className="meta-grid" style={{padding: '1rem', margin: 0, borderBottom: 'none'}}>
        <div className="meta-item">
          <div className="meta-label">Total Detected</div>
          <div className="meta-val" style={{fontSize: '1.25rem'}}>{totalEntities}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Avg Confidence</div>
          <div className="meta-val" style={{fontSize: '1.25rem'}}>{avgConfidence}%</div>
        </div>
      </div>

      <div style={{padding: '0 1rem 1rem'}}>
        <div className="card-label" style={{marginBottom: '0.5rem'}}>Layer Breakdown</div>
        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem'}}>
          <span style={{color: 'var(--redacted-accent)'}}><i className="fa-solid fa-circle" style={{fontSize: '0.6rem', marginRight: '0.4rem', verticalAlign: 'middle'}}></i>Critical</span>
          <span>{criticalCount}</span>
        </div>
        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem'}}>
          <span style={{color: '#fcd34d'}}><i className="fa-solid fa-flag" style={{fontSize: '0.6rem', marginRight: '0.4rem', verticalAlign: 'middle'}}></i>Ambiguous</span>
          <span>{ambiguousCount}</span>
        </div>
        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '1rem'}}>
          <span style={{color: 'var(--visible-accent)'}}><i className="fa-solid fa-eye" style={{fontSize: '0.6rem', marginRight: '0.4rem', verticalAlign: 'middle'}}></i>Visible</span>
          <span>{visibleCount}</span>
        </div>
      </div>

      {totalOverrides > 0 && (
        <div style={{background: 'rgba(139, 92, 246, 0.1)', borderTop: '1px solid var(--border-glass)', padding: '1rem'}}>
          <div className="card-label" style={{color: 'var(--accent-primary)'}}>
            <i className="fa-solid fa-user-pen" style={{marginRight: '0.4rem'}}></i> Human-in-the-Loop Audit
          </div>
          <p style={{fontSize: '0.85rem', color: 'var(--text-primary)', marginTop: '0.5rem'}}>
            You changed <strong>{totalOverrides}</strong> of the AI's {totalEntities} decisions.
          </p>
          <ul style={{fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '1.2rem', marginTop: '0.5rem', marginBottom: 0}}>
            {redactedToVisible > 0 && <li style={{marginBottom: '0.25rem'}}>{redactedToVisible} items the AI flagged, you chose to keep visible.</li>}
            {visibleToRedacted > 0 && <li>{visibleToRedacted} items the AI kept visible, you chose to hide.</li>}
          </ul>
          
          <button onClick={toggleAudit} style={{marginTop: '1rem', width: '100%', background: 'transparent', border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)', padding: '0.5rem', borderRadius: 0, cursor: 'pointer', transition: '0.2s', fontWeight: '600'}}>
            <i className={`fa-solid ${isAuditOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{marginRight: '0.5rem'}}></i>
            {isAuditOpen ? 'Hide Full Audit Trail' : 'View Full Audit Trail'}
          </button>
          
          {isAuditOpen && (
            <div style={{marginTop: '1rem', borderTop: '1px solid var(--accent-primary)', paddingTop: '1rem', maxHeight: '400px', overflowY: 'auto'}}>
              {loadingAudit ? (
                <div style={{textAlign: 'center', opacity: 0.7, fontSize: '0.9rem'}}><i className="fa-solid fa-circle-notch fa-spin"></i> Loading audit data...</div>
              ) : Object.keys(groupedAudit).length === 0 ? (
                <div style={{textAlign: 'center', opacity: 0.7, fontSize: '0.9rem'}}>No overrides recorded.</div>
              ) : (
                Object.values(groupedAudit).map(ent => {
                  const getLayerColor = (layer) => {
                    if (layer === 'critical') return 'var(--redacted-accent)';
                    if (layer === 'ambiguous') return '#f59e0b';
                    return 'var(--visible-accent)';
                  };
                  return (
                    <div key={ent.id} style={{background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 0, marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.05)'}}>
                      <div style={{fontWeight: 600, color: '#fff'}}>{ent.text} <span style={{opacity: 0.5, fontSize: '0.8rem', fontWeight: 400}}>({ent.type})</span></div>
                      
                      <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem'}}>
                        Originally: <span style={{color: getLayerColor(ent.layer), fontWeight: 600}}>{ent.layer}</span> (confidence {Math.round(ent.confidence)}%) &rarr; {ent.defaultAction.toUpperCase()}
                      </div>
                      
                      <div style={{fontSize: '0.75rem', opacity: 0.7, marginTop: '0.25rem', fontStyle: 'italic', lineHeight: 1.4}}>{ent.reasoning}</div>
                      
                      <div style={{marginTop: '0.75rem', paddingLeft: '0.75rem', borderLeft: '2px solid rgba(96, 165, 250, 0.3)', display: 'flex', flexDirection: 'column', gap: '0.25rem'}}>
                        {ent.events.map((ev, idx) => (
                           <div key={idx} style={{fontFamily: 'monospace', fontSize: '0.75rem', color: '#93c5fd'}}>
                              <span style={{opacity: 0.6}}>{new Date(ev.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span> &mdash; User changed to: <span style={{color: '#60a5fa', fontWeight: 600}}>{ev.action.toUpperCase()}</span>
                           </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
