/**
 * TanStack Query hooks for all API calls.
 *
 * Replaces manual useState + useEffect fetch patterns with automatic
 * caching, invalidation, polling, and error handling.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

// ── Queries ──────────────────────────────────────────────────────────────────

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api.getConfig(),
  });
}

export function useUserInfo() {
  return useQuery({
    queryKey: ['userInfo'],
    queryFn: () => api.getUserInfo(),
  });
}

export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.listConversations(),
  });
}

export function useConversation(id) {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.getConversation(id),
    enabled: !!id,
  });
}

/**
 * Poll pending status for a conversation.
 * Automatically polls every 5s while the response is pending but not stale.
 */
export function usePendingStatus(conversationId, { enabled = false } = {}) {
  return useQuery({
    queryKey: ['pendingStatus', conversationId],
    queryFn: () => api.getPendingStatus(conversationId),
    enabled: enabled && !!conversationId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.pending && !data?.stale && !data?.has_error) return 5000;
      return false;
    },
  });
}

export function useAvailableModels() {
  return useQuery({
    queryKey: ['availableModels'],
    queryFn: () => api.getAvailableModels(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCuratedModels() {
  return useQuery({
    queryKey: ['curatedModels'],
    queryFn: () => api.getCuratedModels(),
  });
}

export function useRankings() {
  return useQuery({
    queryKey: ['rankings'],
    queryFn: () => api.getRankings(),
    staleTime: 30_000,
  });
}

export function useRankingsHistory(model) {
  return useQuery({
    queryKey: ['rankingsHistory', model],
    queryFn: () => api.getRankingsHistory(model),
    staleTime: 30_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ councilModels, chairmanModel }) =>
      api.createConversation(councilModels, chairmanModel),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteConversation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useRenameConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }) => api.renameConversation(id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ councilModels, chairmanModel }) =>
      api.updateConfig(councilModels, chairmanModel),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });
}

export function useUpdateCuratedModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelIds) => api.updateCuratedModels(modelIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['curatedModels'] }),
  });
}

export function useRefreshModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.refreshModels(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['availableModels'] }),
  });
}

export function useClearPending() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.clearPending(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pendingStatus', id] });
      qc.invalidateQueries({ queryKey: ['conversation', id] });
    },
  });
}

/**
 * Invalidate conversation-related queries after a stream completes.
 * Call this from useConversationStream's onComplete callback.
 */
export function useStreamInvalidation() {
  const qc = useQueryClient();
  return (conversationId) => {
    qc.invalidateQueries({ queryKey: ['conversations'] });
    qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
    qc.invalidateQueries({ queryKey: ['pendingStatus', conversationId] });
  };
}
