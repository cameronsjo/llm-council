import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

/**
 * Hook for fetching available models with loading/error states.
 *
 * @returns {Object} Models state and controls
 * @returns {Array} returns.models - Array of available model objects
 * @returns {boolean} returns.loading - True while fetching
 * @returns {boolean} returns.refreshing - True while refreshing from OpenRouter
 * @returns {string|null} returns.error - Error message if fetch failed
 * @returns {Function} returns.refetch - Function to manually refetch models (uses cache)
 * @returns {Function} returns.refresh - Function to refresh models from OpenRouter (invalidates cache)
 */
export function useModels() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.getAvailableModels();
      setModels(response.models || []);
    } catch (err) {
      setError('Failed to load models');
      console.error('Failed to load models:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const response = await api.refreshModels();
      setModels(response.models || []);
      return true;
    } catch (err) {
      setError('Failed to refresh models');
      console.error('Failed to refresh models:', err);
      return false;
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  return {
    models,
    loading,
    refreshing,
    error,
    refetch: loadModels,
    refresh: refreshModels,
  };
}
