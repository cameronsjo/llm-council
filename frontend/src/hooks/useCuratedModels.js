import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

/**
 * Hook for managing curated models with optimistic updates.
 *
 * @returns {Object} Curated models state and controls
 */
export function useCuratedModels() {
  const [curatedIds, setCuratedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load curated models on mount
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const response = await api.getCuratedModels();
        setCuratedIds(new Set(response.curated_models || []));
      } catch (err) {
        console.error('Failed to load curated models:', err);
        // Don't set error - gracefully degrade to empty set
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  /**
   * Toggle a single model's curated status.
   */
  const toggle = useCallback((modelId) => {
    setCuratedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  }, []);

  /**
   * Add multiple models to curated list.
   */
  const addAll = useCallback((modelIds) => {
    setCuratedIds((prev) => new Set([...prev, ...modelIds]));
  }, []);

  /**
   * Remove multiple models from curated list.
   */
  const removeAll = useCallback((modelIds) => {
    setCuratedIds((prev) => {
      const next = new Set(prev);
      modelIds.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  /**
   * Replace entire curated list.
   */
  const setAll = useCallback((modelIds) => {
    setCuratedIds(new Set(modelIds));
  }, []);

  /**
   * Save curated models to backend.
   * @returns {Promise<boolean>} True if save succeeded
   */
  const save = useCallback(async () => {
    try {
      setSaving(true);
      setError(null);
      await api.updateCuratedModels(Array.from(curatedIds));
      return true;
    } catch (err) {
      setError('Failed to save curated models');
      console.error('Failed to save curated models:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [curatedIds]);

  /**
   * Check if a model is curated.
   */
  const isCurated = useCallback((modelId) => curatedIds.has(modelId), [curatedIds]);

  return {
    curatedIds,
    loading,
    saving,
    error,
    toggle,
    addAll,
    removeAll,
    setAll,
    save,
    isCurated,
    count: curatedIds.size,
    asArray: Array.from(curatedIds),
  };
}
