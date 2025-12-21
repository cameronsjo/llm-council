import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check, RotateCcw, AlertTriangle, X, Paperclip, FileText, Image } from 'lucide-react';
import { api } from '../api';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import ArenaMode from './ArenaMode';
import './ChatInterface.css';

export default function ChatInterface({
  conversation,
  onSendMessage,
  onRetry,
  onRetryInterrupted,
  onDismissInterrupted,
  isLoading,
  webSearchAvailable,
  searchProvider,
  useWebSearch,
  onToggleWebSearch,
  mode,
  onModeChange,
  arenaRoundCount,
  onArenaRoundCountChange,
  arenaConfig,
}) {
  const [input, setInput] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleCopy = async (text, index) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getMessageText = (msg) => {
    if (msg.role === 'user') {
      return msg.content;
    }
    // For assistant messages, copy the final synthesis/stage3
    if (msg.mode === 'arena' && msg.synthesis) {
      return msg.synthesis.answer || '';
    }
    if (msg.stage3) {
      return msg.stage3.response || '';
    }
    return '';
  };

  const canRetry = (index) => {
    if (!conversation || isLoading) return false;
    // Can retry if this is the last message pair and it's an assistant message
    const messages = conversation.messages;
    return (
      index === messages.length - 1 &&
      messages[index].role === 'assistant' &&
      !messages[index].loading?.stage1 &&
      !messages[index].loading?.stage2 &&
      !messages[index].loading?.stage3 &&
      !messages[index].loading?.round &&
      !messages[index].loading?.synthesis
    );
  };

  const handleRetry = () => {
    if (onRetry && conversation && conversation.messages.length >= 2) {
      // Get the last user message
      const userMsgIndex = conversation.messages.length - 2;
      if (conversation.messages[userMsgIndex]?.role === 'user') {
        onRetry(conversation.messages[userMsgIndex].content);
      }
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadingFile(true);
    try {
      for (const file of files) {
        const attachment = await api.uploadAttachment(file);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (error) {
      console.error('Failed to upload file:', error);
      alert(error.message || 'Failed to upload file');
    } finally {
      setUploadingFile(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveAttachment = (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input, attachments);
      setInput('');
      setAttachments([]);
    }
  };

  const handleKeyDown = (e) => {
    const isMod = e.metaKey || e.ctrlKey;

    // Submit on Enter (without Shift) or Cmd/Ctrl+Enter
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && isMod)) {
      e.preventDefault();
      handleSubmit(e);
    }

    // Escape to clear input
    if (e.key === 'Escape') {
      setInput('');
      e.target.blur();
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <img src="/icon-source.png" alt="LLM Council" className="empty-state-icon" />
          <h2>Welcome to LLM Council</h2>
          <p>Create a new conversation to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-interface">
      <div className="messages-container">
        {/* Interrupted Response Banner */}
        {conversation.pendingInterrupted && conversation.pendingInfo && (
          <div className="interrupted-banner">
            <div className="interrupted-content">
              <AlertTriangle size={20} />
              <div className="interrupted-text">
                <strong>Response was interrupted</strong>
                <span>
                  {conversation.pendingInfo.mode === 'arena' ? 'Arena debate' : 'Council response'}
                  {' '}was interrupted. Would you like to retry?
                </span>
              </div>
            </div>
            <div className="interrupted-actions">
              <button
                className="interrupted-btn retry"
                onClick={onRetryInterrupted}
                disabled={isLoading}
              >
                <RotateCcw size={14} />
                Retry
              </button>
              <button
                className="interrupted-btn dismiss"
                onClick={onDismissInterrupted}
                disabled={isLoading}
              >
                <X size={14} />
                Dismiss
              </button>
            </div>
          </div>
        )}

        {conversation.messages.length === 0 && !conversation.pendingInterrupted ? (
          <div className="empty-state">
            <img src="/icon-source.png" alt="LLM Council" className="empty-state-icon" />
            <h2>Start a conversation</h2>
            <p>Ask a question to consult the LLM Council</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-header">
                    <div className="message-label">You</div>
                    <div className="message-actions">
                      <button
                        className="message-action-btn"
                        onClick={() => handleCopy(msg.content, index)}
                        title="Copy message"
                      >
                        {copiedIndex === index ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-header">
                    <div className="message-label">
                      {msg.mode === 'arena' ? 'Arena Debate' : 'LLM Council'}
                    </div>
                    <div className="message-actions">
                      {getMessageText(msg) && (
                        <button
                          className="message-action-btn"
                          onClick={() => handleCopy(getMessageText(msg), index)}
                          title="Copy final answer"
                        >
                          {copiedIndex === index ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      )}
                      {canRetry(index) && (
                        <button
                          className="message-action-btn retry-btn"
                          onClick={handleRetry}
                          title="Retry this question"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Web Search */}
                  {msg.loading?.webSearch && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Searching the web...</span>
                    </div>
                  )}
                  {msg.webSearchUsed && (
                    <div className="web-search-badge">
                      <span className="web-search-icon">🔍</span> Web search results included
                    </div>
                  )}
                  {msg.webSearchError && !msg.webSearchUsed && (
                    <div className="web-search-error">
                      <span className="web-search-icon">⚠️</span> {msg.webSearchError}
                    </div>
                  )}

                  {/* Arena Mode */}
                  {msg.mode === 'arena' ? (
                    <ArenaMode
                      rounds={msg.rounds}
                      synthesis={msg.synthesis}
                      participantMapping={msg.participant_mapping}
                      loading={msg.loading}
                    />
                  ) : (
                    <>
                      {/* Stage 1 */}
                      {msg.loading?.stage1 && (
                        <div className="stage-loading">
                          <div className="spinner"></div>
                          <span>Running Stage 1: Collecting individual responses...</span>
                        </div>
                      )}
                      {msg.stage1 && <Stage1 responses={msg.stage1} />}

                      {/* Stage 2 */}
                      {msg.loading?.stage2 && (
                        <div className="stage-loading">
                          <div className="spinner"></div>
                          <span>Running Stage 2: Peer rankings...</span>
                        </div>
                      )}
                      {msg.stage2 && (
                        <Stage2
                          rankings={msg.stage2}
                          labelToModel={msg.metadata?.label_to_model}
                          aggregateRankings={msg.metadata?.aggregate_rankings}
                          metrics={msg.metrics}
                        />
                      )}

                      {/* Stage 3 */}
                      {msg.loading?.stage3 && (
                        <div className="stage-loading">
                          <div className="spinner"></div>
                          <span>Running Stage 3: Final synthesis...</span>
                        </div>
                      )}
                      {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}
                    </>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {conversation.messages.length === 0 && (
        <form className="input-form" onSubmit={handleSubmit}>
          <textarea
            className="message-input"
            placeholder="Ask your question... (Shift+Enter for new line, Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={3}
          />

          {/* Mode Toggle */}
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-btn ${mode === 'council' ? 'active' : ''}`}
              onClick={() => onModeChange('council')}
              disabled={isLoading}
            >
              Council Mode
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'arena' ? 'active' : ''}`}
              onClick={() => onModeChange('arena')}
              disabled={isLoading}
            >
              Arena Debate
            </button>
          </div>

          {/* Arena Round Count */}
          {mode === 'arena' && arenaConfig && (
            <div className="arena-config">
              <label className="rounds-label">
                <span>Debate Rounds: {arenaRoundCount}</span>
                <input
                  type="range"
                  min={arenaConfig.min_rounds}
                  max={arenaConfig.max_rounds}
                  value={arenaRoundCount}
                  onChange={(e) => onArenaRoundCountChange(parseInt(e.target.value))}
                  disabled={isLoading}
                  className="rounds-slider"
                />
              </label>
              <span className="rounds-hint">
                Round 1: Initial positions, Rounds 2+: Deliberation
              </span>
            </div>
          )}

          {/* Attachment Chips */}
          {attachments.length > 0 && (
            <div className="attachment-chips">
              {attachments.map((att) => (
                <div key={att.id} className="attachment-chip">
                  {att.file_type === 'image' ? <Image size={14} /> : <FileText size={14} />}
                  <span className="attachment-name">{att.filename}</span>
                  <button
                    type="button"
                    className="attachment-remove"
                    onClick={() => handleRemoveAttachment(att.id)}
                    disabled={isLoading}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="input-controls">
            {/* File attachment button */}
            <input
              ref={fileInputRef}
              type="file"
              className="file-input-hidden"
              onChange={handleFileSelect}
              disabled={isLoading || uploadingFile}
              multiple
              accept=".txt,.md,.json,.csv,.xml,.html,.py,.js,.ts,.pdf,.png,.jpg,.jpeg,.gif,.webp"
            />
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || uploadingFile}
              title="Attach files (PDF, images, text)"
            >
              <Paperclip size={18} />
              {uploadingFile && <span className="uploading-indicator">...</span>}
            </button>

            {webSearchAvailable && (
              <label className="web-search-toggle" title={`Search via ${searchProvider === 'tavily' ? 'Tavily' : 'DuckDuckGo'}`}>
                <input
                  type="checkbox"
                  checked={useWebSearch}
                  onChange={onToggleWebSearch}
                  disabled={isLoading}
                />
                <span className="toggle-label">
                  🔍 Web Search
                  {searchProvider && <span className="provider-badge">{searchProvider === 'tavily' ? 'Tavily' : 'DDG'}</span>}
                </span>
              </label>
            )}
            <button
              type="submit"
              className="send-button"
              disabled={!input.trim() || isLoading}
            >
              {mode === 'arena' ? 'Start Debate' : 'Send'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
