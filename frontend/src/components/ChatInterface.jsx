import { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Copy,
  Check,
  RotateCcw,
  AlertTriangle,
  X,
  Paperclip,
  FileText,
  Image,
  Play,
} from 'lucide-react';
import { api } from '../api';
import {
  convertCouncilToRounds,
  convertSynthesis,
  getParticipantMapping,
  getMessageText,
  canRetryMessage,
} from '../lib/messageUtils';
import Round from './Round';
import Synthesis from './Synthesis';
import './ChatInterface.css';

export default function ChatInterface({
  conversation,
  onSendMessage,
  onRetry,
  onRetryInterrupted,
  onDismissInterrupted,
  onForkConversation,
  onExtendDebate,
  onRetryStage3,
  onCancel,
  isLoading,
  isExtendingDebate,
  webSearchAvailable,
  searchProvider,
  useWebSearch,
  onToggleWebSearch,
  mode,
  onModeChange,
  arenaRoundCount,
  onArenaRoundCountChange,
  arenaConfig,
  hasPendingForkContext,
}) {
  const [input, setInput] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const userHasScrolled = useRef(false);
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

  const canRetry = (index) =>
    canRetryMessage(conversation?.messages, index, isLoading);

  const handleRetry = () => {
    if (onRetry && conversation && conversation.messages.length >= 2) {
      // Get the last user message
      const userMsgIndex = conversation.messages.length - 2;
      if (conversation.messages[userMsgIndex]?.role === 'user') {
        onRetry(conversation.messages[userMsgIndex].content);
      }
    }
  };

  const scrollToBottom = (force = false) => {
    if (force || !userHasScrolled.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Auto-scroll only when user hasn't scrolled away from bottom
  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  // Reset auto-scroll when a new message is sent (user action)
  useEffect(() => {
    if (conversation?.messages?.length) {
      userHasScrolled.current = false;
      scrollToBottom(true);
    }
  }, [conversation?.messages?.length]);

  // Detect user scroll — pause auto-scroll if they've scrolled up
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      userHasScrolled.current = distanceFromBottom > 150;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

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

    // Escape to cancel stream or clear input
    if (e.key === 'Escape') {
      if (isLoading || isExtendingDebate) {
        onCancel?.();
      } else {
        setInput('');
        e.target.blur();
      }
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
      <div className="messages-container" ref={messagesContainerRef}>
        {/* Interrupted Response Banner */}
        {conversation.pendingInterrupted &&
          conversation.pendingInfo &&
          (() => {
            const hasStage1 = conversation.pendingInfo.partial_data?.stage1?.length > 0;
            const canResume = hasStage1 && conversation.pendingInfo.mode === 'council';
            return (
              <div className="interrupted-banner">
                <div className="interrupted-content">
                  <AlertTriangle size={20} />
                  <div className="interrupted-text">
                    <strong>Response was interrupted</strong>
                    <span>
                      {conversation.pendingInfo.mode === 'arena'
                        ? 'Arena debate'
                        : 'Council response'}{' '}
                      was interrupted.
                      {canResume
                        ? ' Stage 1 completed - you can resume from Stage 2.'
                        : ' Would you like to retry?'}
                    </span>
                  </div>
                </div>
                <div className="interrupted-actions">
                  {canResume && (
                    <button
                      className="interrupted-btn resume"
                      onClick={() => onRetryInterrupted(true)}
                      disabled={isLoading}
                    >
                      <Play size={14} />
                      Resume
                    </button>
                  )}
                  <button
                    className="interrupted-btn retry"
                    onClick={() => onRetryInterrupted(false)}
                    disabled={isLoading}
                  >
                    <RotateCcw size={14} />
                    Retry
                  </button>
                  <button
                    className="interrupted-btn dismiss"
                    onClick={onDismissInterrupted}
                  >
                    <X size={14} />
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })()}

        {conversation.messages.length === 0 && !conversation.pendingInterrupted ? (
          <div className="empty-state">
            <img src="/icon-source.png" alt="LLM Council" className="empty-state-icon" />
            <h2>{mode === 'arena' ? 'Start a Debate' : 'Consult the Council'}</h2>
            <p>
              {mode === 'arena'
                ? 'Watch AI models debate and deliberate on controversial topics.'
                : 'Get synthesized answers from multiple AI models with peer review.'}
            </p>
            <div className="prompt-suggestions">
              <span className="suggestions-label">Try asking about:</span>
              <div className="prompt-chips">
                {mode === 'arena' ? (
                  <>
                    <button
                      type="button"
                      className="prompt-chip"
                      onClick={() =>
                        setInput('Is remote work better than office work for software teams?')
                      }
                    >
                      Remote vs Office
                    </button>
                    <button
                      type="button"
                      className="prompt-chip"
                      onClick={() => setInput('Should AI development be regulated by governments?')}
                    >
                      AI Regulation
                    </button>
                    <button
                      type="button"
                      className="prompt-chip"
                      onClick={() =>
                        setInput('Is social media a net positive or negative for society?')
                      }
                    >
                      Social Media Impact
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="prompt-chip"
                      onClick={() =>
                        setInput(
                          'What are the trade-offs between monolith and microservices architectures?'
                        )
                      }
                    >
                      Architecture Decisions
                    </button>
                    <button
                      type="button"
                      className="prompt-chip"
                      onClick={() =>
                        setInput(
                          'How should I approach learning a new programming language effectively?'
                        )
                      }
                    >
                      Learning Strategies
                    </button>
                    <button
                      type="button"
                      className="prompt-chip"
                      onClick={() =>
                        setInput('What factors should I consider when choosing between job offers?')
                      }
                    >
                      Career Advice
                    </button>
                  </>
                )}
              </div>
            </div>
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
                        aria-label={copiedIndex === index ? 'Copied' : 'Copy message'}
                      >
                        {copiedIndex === index ? (
                          <Check size={14} aria-hidden="true" />
                        ) : (
                          <Copy size={14} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`assistant-message ${msg.partial ? 'partial-response' : ''}`}>
                  <div className="message-header">
                    <div className="message-label">
                      {msg.mode === 'arena' ? 'Arena Debate' : 'LLM Council'}
                      {msg.partial && <span className="partial-badge">Partial</span>}
                    </div>
                    <div className="message-actions">
                      {getMessageText(msg) && (
                        <button
                          className="message-action-btn"
                          onClick={() => handleCopy(getMessageText(msg), index)}
                          aria-label={copiedIndex === index ? 'Copied' : 'Copy final answer'}
                        >
                          {copiedIndex === index ? (
                            <Check size={14} aria-hidden="true" />
                          ) : (
                            <Copy size={14} aria-hidden="true" />
                          )}
                        </button>
                      )}
                      {canRetry(index) && (
                        <button
                          className="message-action-btn retry-btn"
                          onClick={handleRetry}
                          aria-label="Retry this question"
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Web Search */}
                  {msg.loading?.webSearch && (
                    <div className="stage-loading" role="status" aria-live="polite">
                      <div className="spinner" aria-hidden="true"></div>
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

                  {/* Unified Round Display - Works for both Arena and Council modes */}
                  {(() => {
                    const isArena = msg.mode === 'arena';
                    const rounds = isArena ? msg.rounds : convertCouncilToRounds(msg);
                    const synthesis = convertSynthesis(msg);
                    const participantMapping = getParticipantMapping(msg);
                    const mode = isArena ? 'arena' : 'council';

                    return (
                      <>
                        {/* Progress Stepper for Council mode */}
                        {!isArena &&
                          (msg.loading?.stage1 ||
                            msg.loading?.stage2 ||
                            msg.loading?.stage3 ||
                            msg.stage1) && (
                            <div
                              className="council-progress"
                              role="progressbar"
                              aria-label="Council deliberation progress"
                            >
                              <div
                                className={`progress-step ${msg.stage1 ? 'complete' : ''} ${msg.loading?.stage1 ? 'active' : ''}`}
                              >
                                <div className="step-indicator">{msg.stage1 ? '✓' : '1'}</div>
                                <span className="step-label">Responses</span>
                              </div>
                              <div className="step-connector"></div>
                              <div
                                className={`progress-step ${msg.stage2 ? 'complete' : ''} ${msg.loading?.stage2 ? 'active' : ''}`}
                              >
                                <div className="step-indicator">{msg.stage2 ? '✓' : '2'}</div>
                                <span className="step-label">Rankings</span>
                              </div>
                              <div className="step-connector"></div>
                              <div
                                className={`progress-step ${msg.stage3 ? 'complete' : ''} ${msg.loading?.stage3 ? 'active' : ''}`}
                              >
                                <div className="step-indicator">{msg.stage3 ? '✓' : '3'}</div>
                                <span className="step-label">Synthesis</span>
                              </div>
                            </div>
                          )}

                        {/* Loading states */}
                        {msg.loading?.stage1 && (
                          <div className="stage-loading streaming" role="status" aria-live="polite">
                            {msg.streaming?.progress ? (
                              <>
                                <div className="streaming-header">
                                  <div className="spinner" aria-hidden="true"></div>
                                  <span>
                                    Collecting responses: {msg.streaming.progress.completed} of{' '}
                                    {msg.streaming.progress.total}
                                  </span>
                                </div>
                                <div className="streaming-models">
                                  {msg.streaming.models?.map((model) => {
                                    const modelShort = model.split('/')[1] || model;
                                    const isComplete = msg.streaming.progress.completed_models?.includes(model);
                                    const isStreaming = msg.streaming.tokens?.[model];
                                    return (
                                      <div
                                        key={model}
                                        className={`streaming-model ${isComplete ? 'complete' : ''} ${isStreaming ? 'active' : ''}`}
                                      >
                                        <span className="model-status">
                                          {isComplete ? '✓' : isStreaming ? '⋯' : '○'}
                                        </span>
                                        <span className="model-name">{modelShort}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                {/* Show streaming token preview for currently active models */}
                                {Object.entries(msg.streaming.tokens || {}).map(([model, tokens]) => (
                                  <div key={model} className="streaming-preview">
                                    <span className="preview-model">{model.split('/')[1] || model}:</span>
                                    <span className="preview-text">
                                      {tokens.slice(-100)}
                                      <span className="cursor">▋</span>
                                    </span>
                                  </div>
                                ))}
                              </>
                            ) : (
                              <>
                                <div className="spinner" aria-hidden="true"></div>
                                <span>Collecting individual responses...</span>
                              </>
                            )}
                          </div>
                        )}
                        {msg.loading?.stage2 && (
                          <div className="stage-loading" role="status" aria-live="polite">
                            <div className="spinner" aria-hidden="true"></div>
                            <span>Peer rankings in progress...</span>
                          </div>
                        )}
                        {msg.loading?.round && (
                          <div className="stage-loading" role="status" aria-live="polite">
                            <div className="spinner" aria-hidden="true"></div>
                            <span>
                              {msg.loading.roundType === 'initial'
                                ? 'Collecting initial positions...'
                                : `Round ${msg.loading.roundNumber}: Deliberating...`}
                            </span>
                          </div>
                        )}

                        {/* Render rounds using unified Round component */}
                        {rounds.map((round, i) => (
                          <Round
                            key={`${round.round_type}-${round.round_number || i}`}
                            round={round}
                            participantMapping={participantMapping}
                            isCollapsible={isArena}
                            defaultCollapsed={false}
                            showMetrics={false}
                          />
                        ))}

                        {/* Synthesis loading */}
                        {(msg.loading?.stage3 || msg.loading?.synthesis) && (
                          <div className="stage-loading" role="status" aria-live="polite">
                            <div className="spinner" aria-hidden="true"></div>
                            <span>
                              {isArena
                                ? 'Synthesizing debate outcomes...'
                                : 'Final synthesis in progress...'}
                            </span>
                          </div>
                        )}

                        {/* Render synthesis using unified Synthesis component */}
                        {synthesis && (
                          <Synthesis
                            synthesis={synthesis}
                            participantMapping={participantMapping}
                            originalQuestion={conversation?.messages[index - 1]?.content}
                            conversationId={conversation?.id}
                            onForkConversation={onForkConversation}
                            onExtendDebate={isArena ? onExtendDebate : undefined}
                            onRetryStage3={!isArena ? onRetryStage3 : undefined}
                            isExtending={isExtendingDebate}
                            isLoading={isLoading}
                            mode={mode}
                          />
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && !messages[messages.length - 1]?.loading?.stage3 && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

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
        <div
          className={`mode-toggle ${mode === 'arena' ? 'arena-mode' : ''}`}
          role="radiogroup"
          aria-label="Response mode"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'council'}
            className={`mode-btn ${mode === 'council' ? 'active' : ''}`}
            onClick={() => onModeChange('council')}
            disabled={isLoading}
          >
            Council Mode
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'arena'}
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
            <span className="rounds-hint">Round 1: Initial positions, Rounds 2+: Deliberation</span>
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
                  aria-label={`Remove ${att.filename}`}
                >
                  <X size={12} aria-hidden="true" />
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
            aria-label="Attach files (PDF, images, text)"
          >
            <Paperclip size={18} aria-hidden="true" />
            {uploadingFile && (
              <span className="uploading-indicator" aria-live="polite">
                Uploading...
              </span>
            )}
          </button>

          {webSearchAvailable && (
            <label
              className="web-search-toggle"
              title={`Search via ${searchProvider === 'tavily' ? 'Tavily' : 'DuckDuckGo'}`}
            >
              <input
                type="checkbox"
                checked={useWebSearch}
                onChange={onToggleWebSearch}
                disabled={isLoading}
              />
              <span className="toggle-label">
                🔍 Web Search
                {searchProvider && (
                  <span className="provider-badge">
                    {searchProvider === 'tavily' ? 'Tavily' : 'DDG'}
                  </span>
                )}
              </span>
            </label>
          )}
          {(isLoading || isExtendingDebate) ? (
            <button
              type="button"
              className="cancel-button"
              onClick={onCancel}
              title="Cancel stream (Esc)"
            >
              Cancel
            </button>
          ) : (
            <button type="submit" className="send-button" disabled={!input.trim()}>
              {mode === 'arena' ? 'Start Debate' : 'Send'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
