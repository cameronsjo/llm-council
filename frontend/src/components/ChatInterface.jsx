import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
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
import Round from './Round';
import Synthesis from './Synthesis';
import './ChatInterface.css';

// Convert legacy Council stage data to unified rounds format
function convertCouncilToRounds(msg) {
  const rounds = [];

  // Stage 1 → Round with type "responses"
  if (msg.stage1) {
    rounds.push({
      round_number: 1,
      round_type: 'responses',
      responses: msg.stage1.map((r) => ({
        model: r.model,
        content: r.response,
        reasoning_details: r.reasoning_details,
      })),
    });
  }

  // Stage 2 → Round with type "rankings"
  if (msg.stage2) {
    rounds.push({
      round_number: 2,
      round_type: 'rankings',
      responses: msg.stage2.map((r) => ({
        model: r.model,
        content: r.ranking,
        reasoning_details: r.reasoning_details,
        parsed_ranking: r.parsed_ranking,
      })),
      metadata: {
        label_to_model: msg.metadata?.label_to_model,
        aggregate_rankings: msg.metadata?.aggregate_rankings,
      },
    });
  }

  return rounds;
}

// Convert legacy synthesis format to unified format
function convertSynthesis(msg) {
  if (msg.stage3) {
    return {
      model: msg.stage3.model,
      content: msg.stage3.response,
      reasoning_details: msg.stage3.reasoning_details,
    };
  }
  return msg.synthesis;
}

// Get participant mapping for de-anonymization
function getParticipantMapping(msg) {
  // For unified format
  if (msg.participant_mapping) {
    return msg.participant_mapping;
  }
  // For Council mode, use label_to_model from metadata
  if (msg.metadata?.label_to_model) {
    return msg.metadata.label_to_model;
  }
  // Check rounds for metadata
  if (msg.rounds) {
    for (const round of msg.rounds) {
      if (round.metadata?.label_to_model) {
        return round.metadata.label_to_model;
      }
    }
  }
  return null;
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  onRetry,
  onRetryInterrupted,
  onDismissInterrupted,
  onForkConversation,
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
  hasPendingForkContext,
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
                    disabled={isLoading}
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
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
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
                          <div className="stage-loading" role="status" aria-live="polite">
                            <div className="spinner" aria-hidden="true"></div>
                            <span>Collecting individual responses...</span>
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

        {isLoading && (
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
          <button type="submit" className="send-button" disabled={!input.trim() || isLoading}>
            {mode === 'arena' ? 'Start Debate' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
