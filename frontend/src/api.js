/**
 * API client for the LLM Council backend.
 */

// API base URL - empty string means same origin (production)
// VITE_API_URL can override for development with separate servers
const API_BASE = import.meta.env.VITE_API_URL || '';

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
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content, useWebSearch = false) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, use_web_search: useWebSearch }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
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
    resume = false
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

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            onEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    }
  },
};
