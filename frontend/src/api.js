/**
 * API client for the LLM Council backend.
 */

// API base URL - empty string means same origin (production)
// VITE_API_URL can override for development with separate servers
const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Thrown when a request is redirected (typically auth proxy sending user to login).
 * Behind Authelia/OAuth2 Proxy, expired sessions return 200 + HTML login page
 * which silently breaks JSON parsing. This error surfaces it clearly.
 */
export class AuthRedirectError extends Error {
  constructor(url) {
    super('Session expired — authentication required');
    this.name = 'AuthRedirectError';
    this.redirectUrl = url;
  }
}

/**
 * Thrown for non-2xx responses or unexpected content types.
 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Fetch wrapper with auth redirect detection.
 * Checks response.redirected and response.ok before returning the raw Response.
 * Use for SSE and blob endpoints that don't return JSON.
 */
async function fetchWithAuth(url, options = {}, errorMessage = 'Request failed') {
  const method = options.method || 'GET';
  console.debug('[api] %s %s', method, url);

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    console.error('[api] Network error on %s %s: %s', method, url, err.message);
    throw err;
  }

  if (response.redirected) {
    console.warn('[api] Auth redirect detected. URL: %s → %s', url, response.url);
    throw new AuthRedirectError(response.url);
  }

  if (!response.ok) {
    console.error('[api] HTTP %d on %s %s: %s', response.status, method, url, errorMessage);
    throw new ApiError(errorMessage, response.status);
  }

  return response;
}

/**
 * Fetch + parse JSON with auth redirect and content-type validation.
 * Replaces the repeated fetch→ok→json pattern across all JSON API methods.
 */
async function fetchJSON(url, options = {}, errorMessage = 'Request failed') {
  const response = await fetchWithAuth(url, options, errorMessage);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // HTML response on a JSON endpoint = auth proxy login page
    if (contentType.includes('text/html')) {
      throw new AuthRedirectError(response.url);
    }
    throw new ApiError(
      `Expected JSON but got ${contentType || 'unknown content type'}`,
      response.status,
    );
  }

  return response.json();
}

/**
 * Fetch wrapper for SSE streaming endpoints.
 * Validates content-type is text/event-stream; detects auth proxy HTML responses.
 * @returns {Promise<Response>} The validated fetch response
 */
async function fetchSSE(url, options = {}, errorMessage = 'Stream request failed') {
  const response = await fetchWithAuth(url, options, errorMessage);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    if (contentType.includes('text/html')) {
      console.warn('[api:sse] Got HTML instead of event-stream. URL: %s', url);
      throw new AuthRedirectError(response.url);
    }
    console.error('[api:sse] Unexpected content-type "%s" on %s', contentType, url);
    throw new ApiError(
      `Expected event stream but got ${contentType || 'unknown content type'}`,
      response.status,
    );
  }

  console.debug('[api:sse] Stream connected. URL: %s', url);
  return response;
}

/**
 * Read SSE events from a ReadableStream, buffering across chunk boundaries.
 * @param {ReadableStreamDefaultReader} reader
 * @param {function} onEvent - Called with (eventType, eventData) for each parsed event
 * @param {AbortSignal|null} signal - Optional abort signal
 */
async function readSSEStream(reader, onEvent, signal = null) {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventCount = 0;

  while (true) {
    if (signal?.aborted) {
      console.debug('[api:sse] Stream aborted by signal after %d events', eventCount);
      break;
    }

    let result;
    try {
      result = await reader.read();
    } catch (e) {
      if (e.name === 'AbortError') {
        console.debug('[api:sse] Stream read aborted after %d events', eventCount);
        break;
      }
      console.error('[api:sse] Stream read error after %d events: %s', eventCount, e.message);
      throw e;
    }
    if (result.done) break;

    buffer += decoder.decode(result.value, { stream: true });

    // SSE events are delimited by double newlines
    const parts = buffer.split('\n\n');
    // Last element is either empty (if buffer ended on \n\n) or an incomplete event
    buffer = parts.pop();

    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            eventCount++;
            onEvent(event.type, event);
          } catch (e) {
            if (e.name === 'AbortError') break;
            console.error('[api:sse] Failed to parse SSE event: %s. Raw: %s', e.message, line.slice(6, 100));
          }
        }
      }
    }
  }

  // Flush any remaining buffered data
  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6));
          eventCount++;
          onEvent(event.type, event);
        } catch (e) {
          // Incomplete final event — nothing to do
        }
      }
    }
  }

  console.debug('[api:sse] Stream ended. Total events: %d', eventCount);
}

export const api = {
  /**
   * Get API configuration (feature flags).
   */
  async getConfig() {
    return fetchJSON(`${API_BASE}/api/config`, {}, 'Failed to get config');
  },

  /**
   * Get application version information.
   */
  async getVersion() {
    return fetchJSON(`${API_BASE}/api/version`, {}, 'Failed to get version');
  },

  /**
   * Get current user information (from reverse proxy auth headers).
   */
  async getUserInfo() {
    return fetchJSON(`${API_BASE}/api/user`, {}, 'Failed to get user info');
  },

  /**
   * Update council configuration.
   */
  async updateConfig(councilModels, chairmanModel) {
    return fetchJSON(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        council_models: councilModels,
        chairman_model: chairmanModel,
      }),
    }, 'Failed to update config');
  },

  /**
   * Get available models from OpenRouter.
   */
  async getAvailableModels() {
    return fetchJSON(`${API_BASE}/api/models`, {}, 'Failed to get available models');
  },

  /**
   * Refresh available models from OpenRouter (invalidates cache).
   * Use this to fetch the latest models when new models are available.
   */
  async refreshModels() {
    return fetchJSON(`${API_BASE}/api/models/refresh`, {
      method: 'POST',
    }, 'Failed to refresh models');
  },

  /**
   * Get curated models list.
   */
  async getCuratedModels() {
    return fetchJSON(`${API_BASE}/api/curated-models`, {}, 'Failed to get curated models');
  },

  /**
   * Update curated models list.
   */
  async updateCuratedModels(modelIds) {
    return fetchJSON(`${API_BASE}/api/curated-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_ids: modelIds }),
    }, 'Failed to update curated models');
  },

  /**
   * List all conversations.
   */
  async listConversations() {
    return fetchJSON(`${API_BASE}/api/conversations`, {}, 'Failed to list conversations');
  },

  /**
   * Create a new conversation with optional model configuration.
   * @param {string[]|null} councilModels - Optional council models (inherits global if null)
   * @param {string|null} chairmanModel - Optional chairman model (inherits global if null)
   */
  async createConversation(councilModels = null, chairmanModel = null) {
    const body = {};
    if (councilModels) body.council_models = councilModels;
    if (chairmanModel) body.chairman_model = chairmanModel;
    return fetchJSON(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 'Failed to create conversation');
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    return fetchJSON(
      `${API_BASE}/api/conversations/${conversationId}`,
      {},
      'Failed to get conversation',
    );
  },

  /**
   * Delete a conversation.
   */
  async deleteConversation(conversationId) {
    return fetchJSON(
      `${API_BASE}/api/conversations/${conversationId}`,
      { method: 'DELETE' },
      'Failed to delete conversation',
    );
  },

  /**
   * Rename a conversation.
   */
  async renameConversation(conversationId, title) {
    return fetchJSON(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      },
      'Failed to rename conversation',
    );
  },

  /**
   * Export a conversation as Markdown.
   * @returns {Promise<Blob>}
   */
  async exportMarkdown(conversationId) {
    const response = await fetchWithAuth(
      `${API_BASE}/api/conversations/${conversationId}/export/markdown`,
      {},
      'Failed to export conversation',
    );
    return response.blob();
  },

  /**
   * Export a conversation as JSON.
   * @returns {Promise<Blob>}
   */
  async exportJson(conversationId) {
    const response = await fetchWithAuth(
      `${API_BASE}/api/conversations/${conversationId}/export/json`,
      {},
      'Failed to export conversation',
    );
    return response.blob();
  },

  /**
   * Upload a file attachment.
   * @param {File} file - File to upload
   * @returns {Promise<{id: string, filename: string, file_type: string}>}
   */
  async uploadAttachment(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/api/attachments`, {
      method: 'POST',
      body: formData,
    });

    if (response.redirected) {
      throw new AuthRedirectError(response.url);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(error.detail || 'Failed to upload file', response.status);
    }

    return response.json();
  },

  /**
   * Get pending response status for a conversation.
   * Returns info about any in-progress or interrupted response.
   */
  async getPendingStatus(conversationId) {
    return fetchJSON(
      `${API_BASE}/api/conversations/${conversationId}/pending`,
      {},
      'Failed to get pending status',
    );
  },

  /**
   * Clear pending status and remove the orphaned user message for retry.
   */
  async clearPending(conversationId) {
    return fetchJSON(
      `${API_BASE}/api/conversations/${conversationId}/pending`,
      { method: 'DELETE' },
      'Failed to clear pending',
    );
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {boolean} useWebSearch - Whether to use web search
   * @param {string} mode - Mode: 'council' or 'arena'
   * @param {object|null} arenaConfig - Arena configuration (e.g., { round_count: 3 })
   * @param {Array} attachments - Array of attachment objects from upload
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @param {boolean} resume - Whether to resume from partial results
   * @param {object|null} priorContext - Context from previous conversation {original_question, synthesis, source_conversation_id}
   * @returns {Promise<void>}
   */
  async sendMessageStream(
    conversationId,
    content,
    useWebSearch,
    mode = 'council',
    arenaConfig = null,
    attachments = [],
    onEvent,
    resume = false,
    priorContext = null,
    signal = null
  ) {
    const body = {
      content,
      use_web_search: useWebSearch,
      mode,
      resume,
    };

    if (mode === 'arena' && arenaConfig) {
      body.arena_config = arenaConfig;
    }

    if (attachments && attachments.length > 0) {
      body.attachments = attachments;
    }

    if (priorContext) {
      body.prior_context = priorContext;
    }

    const response = await fetchSSE(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      },
      'Failed to send message',
    );

    await readSSEStream(response.body.getReader(), onEvent, signal);
  },

  /**
   * Extend an arena debate with one more deliberation round.
   * @param {string} conversationId - The conversation ID
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async extendDebateStream(conversationId, onEvent, signal = null) {
    const response = await fetchSSE(
      `${API_BASE}/api/conversations/${conversationId}/extend-debate/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
      },
      'Failed to extend debate',
    );

    await readSSEStream(response.body.getReader(), onEvent, signal);
  },

  /**
   * Retry Stage 3 synthesis on a conversation where it previously failed.
   * Re-uses existing Stage 1+2 data, only re-runs the chairman call.
   */
  async retryStage3Stream(conversationId, onEvent, signal = null) {
    const response = await fetchSSE(
      `${API_BASE}/api/conversations/${conversationId}/retry-stage3/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
      },
      'Failed to retry Stage 3',
    );

    await readSSEStream(response.body.getReader(), onEvent, signal);
  },
};

export { readSSEStream, fetchJSON, fetchSSE, fetchWithAuth };
