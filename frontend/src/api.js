/**
 * API client for the LLM Council backend.
 */

// API base URL - empty string means same origin (production)
// VITE_API_URL can override for development with separate servers
const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Read SSE events from a ReadableStream, buffering across chunk boundaries.
 * @param {ReadableStreamDefaultReader} reader
 * @param {function} onEvent - Called with (eventType, eventData) for each parsed event
 * @param {AbortSignal|null} signal - Optional abort signal
 */
async function readSSEStream(reader, onEvent, signal = null) {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) break;

    let result;
    try {
      result = await reader.read();
    } catch (e) {
      if (e.name === 'AbortError') break;
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
            onEvent(event.type, event);
          } catch (e) {
            if (e.name === 'AbortError') break;
            console.error('Failed to parse SSE event:', e);
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
          onEvent(event.type, event);
        } catch (e) {
          // Incomplete final event — nothing to do
        }
      }
    }
  }
}

export const api = {
  /**
   * Get API configuration (feature flags).
   */
  async getConfig() {
    const response = await fetch(`${API_BASE}/api/config`);
    if (!response.ok) {
      throw new Error('Failed to get config');
    }
    return response.json();
  },

  /**
   * Get application version information.
   */
  async getVersion() {
    const response = await fetch(`${API_BASE}/api/version`);
    if (!response.ok) {
      throw new Error('Failed to get version');
    }
    return response.json();
  },

  /**
   * Get current user information (from reverse proxy auth headers).
   */
  async getUserInfo() {
    const response = await fetch(`${API_BASE}/api/user`);
    if (!response.ok) {
      throw new Error('Failed to get user info');
    }
    return response.json();
  },

  /**
   * Update council configuration.
   */
  async updateConfig(councilModels, chairmanModel) {
    const response = await fetch(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        council_models: councilModels,
        chairman_model: chairmanModel,
      }),
    });
    if (!response.ok) {
      throw new Error('Failed to update config');
    }
    return response.json();
  },

  /**
   * Get available models from OpenRouter.
   */
  async getAvailableModels() {
    const response = await fetch(`${API_BASE}/api/models`);
    if (!response.ok) {
      throw new Error('Failed to get available models');
    }
    return response.json();
  },

  /**
   * Refresh available models from OpenRouter (invalidates cache).
   * Use this to fetch the latest models when new models are available.
   */
  async refreshModels() {
    const response = await fetch(`${API_BASE}/api/models/refresh`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to refresh models');
    }
    return response.json();
  },

  /**
   * Get curated models list.
   */
  async getCuratedModels() {
    const response = await fetch(`${API_BASE}/api/curated-models`);
    if (!response.ok) {
      throw new Error('Failed to get curated models');
    }
    return response.json();
  },

  /**
   * Update curated models list.
   */
  async updateCuratedModels(modelIds) {
    const response = await fetch(`${API_BASE}/api/curated-models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model_ids: modelIds }),
    });
    if (!response.ok) {
      throw new Error('Failed to update curated models');
    }
    return response.json();
  },

  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation with optional model configuration.
   * @param {string[]|null} councilModels - Optional council models (inherits global if null)
   * @param {string|null} chairmanModel - Optional chairman model (inherits global if null)
   */
  async createConversation(councilModels = null, chairmanModel = null) {
    const body = {};
    if (councilModels) {
      body.council_models = councilModels;
    }
    if (chairmanModel) {
      body.chairman_model = chairmanModel;
    }
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Delete a conversation.
   */
  async deleteConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  /**
   * Rename a conversation.
   */
  async renameConversation(conversationId, title) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to rename conversation');
    }
    return response.json();
  },

  /**
   * Export a conversation as Markdown.
   * @returns {Promise<Blob>}
   */
  async exportMarkdown(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/export/markdown`
    );
    if (!response.ok) {
      throw new Error('Failed to export conversation');
    }
    return response.blob();
  },

  /**
   * Export a conversation as JSON.
   * @returns {Promise<Blob>}
   */
  async exportJson(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/export/json`
    );
    if (!response.ok) {
      throw new Error('Failed to export conversation');
    }
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

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to upload file');
    }

    return response.json();
  },

  /**
   * Get pending response status for a conversation.
   * Returns info about any in-progress or interrupted response.
   */
  async getPendingStatus(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/pending`
    );
    if (!response.ok) {
      throw new Error('Failed to get pending status');
    }
    return response.json();
  },

  /**
   * Clear pending status and remove the orphaned user message for retry.
   */
  async clearPending(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/pending`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to clear pending');
    }
    return response.json();
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

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    await readSSEStream(response.body.getReader(), onEvent, signal);
  },

  /**
   * Extend an arena debate with one more deliberation round.
   * @param {string} conversationId - The conversation ID
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async extendDebateStream(conversationId, onEvent, signal = null) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/extend-debate/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to extend debate');
    }

    await readSSEStream(response.body.getReader(), onEvent, signal);
  },
};

export { readSSEStream };
