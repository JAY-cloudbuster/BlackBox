import { useState, useMemo, useCallback, useEffect } from 'react';
import { API_BASE } from '../config';

export function useEntityDecisions(initialDoc, showAiOriginal = false) {
  const [userOverrides, setUserOverrides] = useState({});

  useEffect(() => {
    if (initialDoc && initialDoc.overrides) {
      setUserOverrides(initialDoc.overrides);
      console.log("Document loaded. Overrides synced from database.");
    } else if (initialDoc) {
      setUserOverrides({});
    }
  }, [initialDoc]);

  const derivedEntities = useMemo(() => {
    if (!initialDoc || !initialDoc.entities) return [];
    
    return initialDoc.entities.map(entity => {
      const override = showAiOriginal ? null : (userOverrides[entity.id] || null);
      const finalDisplayAction = override !== null ? override : entity.defaultAction;
      
      return {
        ...entity,
        aiLayer: entity.layer,
        aiReasoning: entity.reasoning,
        aiConfidence: entity.confidenceScore,
        userOverride: override,
        finalDisplayAction,
        isModified: override !== null
      };
    });
  }, [initialDoc, userOverrides, showAiOriginal]);

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

  return {
    document: initialDoc ? { ...initialDoc, entities: derivedEntities } : null,
    setOverride,
    resetOverride,
    userOverrides
  };
}
