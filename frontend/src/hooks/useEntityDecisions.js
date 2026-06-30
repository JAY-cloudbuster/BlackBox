import { useState, useMemo, useCallback, useEffect } from 'react';
import { API_BASE } from '../config';

export function useEntityDecisions(initialDoc, showAiOriginal = false) {
  const [userOverrides, setUserOverrides] = useState({});
  const [manualEntities, setManualEntities] = useState([]);

  useEffect(() => {
    if (initialDoc && initialDoc.overrides) {
      setUserOverrides(initialDoc.overrides);
      setManualEntities([]); // reset manual entities on load, they come baked into doc.entities from DB!
      console.log("Document loaded. Overrides synced from database.");
    } else if (initialDoc) {
      setUserOverrides({});
      setManualEntities([]);
    }
  }, [initialDoc]);

  const derivedEntities = useMemo(() => {
    if (!initialDoc || !initialDoc.entities) return [];
    
    const allEntities = [...initialDoc.entities, ...manualEntities];
    
    return allEntities.map(entity => {
      const override = showAiOriginal ? null : (userOverrides[entity.id] || null);
      const finalDisplayAction = override !== null ? override : entity.defaultAction;
      
      return {
        ...entity,
        aiLayer: entity.layer,
        aiReasoning: entity.reasoning,
        aiConfidence: entity.confidenceScore,
        userOverride: override,
        finalDisplayAction,
        isModified: override !== null || entity.entityType === 'USER_DEFINED'
      };
    });
  }, [initialDoc, userOverrides, showAiOriginal, manualEntities]);

  const setOverride = useCallback(async (id, action) => {
    setUserOverrides(prev => ({ ...prev, [id]: action }));
    try {
      await fetch(`${API_BASE}/api/entities/${id}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
    } catch (e) {
      console.error("Failed to persist override to DB:", e);
    }
  }, []);

  const resetOverride = useCallback(async (id) => {
    setUserOverrides(prev => {
      const newState = { ...prev };
      delete newState[id];
      return newState;
    });
    try {
      await fetch(`${API_BASE}/api/entities/${id}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });
    } catch (e) {
      console.error("Failed to reset override in DB:", e);
    }
  }, []);

  const addManualEntity = useCallback(async (documentId, text, startIndex, endIndex, boundingBoxes) => {
    try {
      const res = await fetch(`${API_BASE}/api/documents/${documentId}/manual-entity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, startIndex, endIndex, boundingBoxes })
      });
      const data = await res.json();
      if (data.success && data.entity) {
        setManualEntities(prev => [...prev, data.entity]);
        setUserOverrides(prev => ({ ...prev, [data.entity.id]: 'redact' }));
        return data.entity;
      }
    } catch (e) {
      console.error("Failed to add manual entity:", e);
    }
    return null;
  }, []);

  return {
    document: initialDoc ? { ...initialDoc, entities: derivedEntities } : null,
    setOverride,
    resetOverride,
    addManualEntity,
    userOverrides
  };
}
