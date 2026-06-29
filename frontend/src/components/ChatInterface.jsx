import { useState, useEffect, useRef, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Copy,
  Check,
  RotateCw,
  AlertTriangle,
  X,
  Paperclip,
  FileText,
  Image,
  Play,
  MessageSquarePlus,
  ChevronDown,
  ChevronRight,
  Globe,
  ArrowRight,
} from 'lucide-react';
import { api } from '../api';
import { getParticipantMapping, getMessageText, canRetryMessage } from '../lib/messageUtils';
import { useUIStore } from '../stores/uiStore';
import { useConfig } from '../hooks/queries';
import { useSeatColors } from '../hooks/useSeatColors';
import { SeatAvatar, StageRail } from './ui';
import Round from './Round';
import Synthesis from './Synthesis';
import ModelErrors from './ModelErrors';
import './ChatInterface.css';

export default function ChatInterface({
  conversation,
  onSendMessage,
  onRetry,
  onRetryInterrupted,
  onDismissInterrupted,
  onForkConversation,
  onExtendDebate,
  onRetrySynthesis,
  onRetryRankings,
  onRetryAll,
  onCancel,
  isLoading,
  isExtendingDebate,
}) {
  const { data: config } = useConfig();
  const webSearchAvailable = config?.web_search_available;
  const searchProvider = config?.search_provider || '';
  const arenaConfig = config?.arena || { default_rounds: 3, min_rounds: 2, max_rounds: 10 };
  const councilModels = config?.council_models ?? [];
  const chairmanModel = config?.chairman_model ?? '';

  const mode = useUIStore((s) => s.mode);
  const useWebSearch = useUIStore((s) => s.useWebSearch);
  const toggleWebSearch = useUIStore((s) => s.toggleWebSearch);
  const arenaRoundCount = useUIStore((s) => s.arenaRoundCount);
  const setArenaRoundCount = useUIStore((s) => s.setArenaRoundCount);
  const pendingForkContext = useUIStore((s) => s.pendingForkContext);
  const setPendingForkContext = useUIStore((s) => s.setPendingForkContext);

  const { seatOf } = useSeatColors();

  const [input, setInput] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [forkContextExpanded, setForkContextExpanded] = useState(true);
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

  const canRetry = (index) => canRetryMessage(conversation?.messages, index, isLoading);

  const handleRetry = () => {
    if (onRetry && conversation && conversation.messages.length >= 2) {
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

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  useEffect(() => {
    if (conversation?.messages?.length) {
      userHasScrolled.current = false;
      scrollToBottom(true);
    }
  }, [conversation?.messages?.length]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userHasScrolled.current = scrollHeight - scrollTop - clientHeight > 150;
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
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && isMod)) {
      e.preventDefault();
      handleSubmit(e);
    }
    if (e.key === 'Escape') {
      if (isLoading || isExtendingDebate) {
        onCancel?.();
      } else {
        setInput('');
        e.target.blur();
      }
    }
  };

  // ── helpers ────────────────────────────────────────────────────────────────
  const modelShortName = (id) => id?.split('/')[1] || id || '';
  const chairShort = modelShortName(chairmanModel);

  const getCouncilCompleted = (msg) => {
    const rounds = msg.rounds || [];
    const hasResponses = rounds.some((r) => r.round_type === 'responses');
    const hasRankings = rounds.some((r) => r.round_type === 'rankings');
    return (hasResponses ? 1 : 0) + (hasRankings ? 1 : 0) + (msg.synthesis ? 1 : 0);
  };

  const getArenaCompleted = (msg) => {
    const debateRounds = (msg.rounds || []).filter((r) => r.round_type !== 'synthesis');
    if (msg.synthesis) return 4;
    if (debateRounds.length >= 3) return 3;
    if (debateRounds.length >= 2) return 2;
    if (debateRounds.length >= 1) return 1;
    return 0;
  };

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      className="file-input-hidden"
      onChange={handleFileSelect}
      disabled={isLoading || uploadingFile}
      multiple
      accept=".txt,.md,.json,.csv,.xml,.html,.py,.js,.ts,.pdf,.png,.jpg,.jpeg,.gif,.webp"
    />
  );

  const showLanding =
    !conversation || (conversation.messages.length === 0 && !conversation.pendingInterrupted);

  // ── LANDING ────────────────────────────────────────────────────────────────
  if (showLanding) {
    return (
      <div className="chat-interface">
        {hiddenFileInput}
        <div className="landing-scroll">
          <div className="landing-content">
            {/* Status pill */}
            <div className="landing-status-pill">
              <span className="landing-status-dot" aria-hidden="true" />
              <span className="landing-status-text">
                {councilModels.length > 0
                  ? `${councilModels.length} model${councilModels.length !== 1 ? 's' : ''} convened · ${chairShort || 'no chair'} chairing`
                  : 'No models configured'}
              </span>
            </div>

            {/* Hero */}
            <h1 className="landing-hero-h1">
              {mode === 'arena' ? (
                <>
                  Stage the debate
                  <span className="landing-hero-faint">, not the prompt.</span>
                </>
              ) : (
                <>
                  Ask the council
                  <span className="landing-hero-faint">, not a model.</span>
                </>
              )}
            </h1>
            <p className="landing-hero-sub">
              {mode === 'arena'
                ? 'Two models argue opposing sides across structured rounds. A chairman de-anonymizes and rules.'
                : 'Your question goes to every model at once. They answer, rank each other blind, and a chairman synthesizes one accountable response.'}
            </p>

            {/* Seat cards */}
            {councilModels.length > 0 && (
              <div className="landing-seats">
                {councilModels.map((modelId) => {
                  const seat = seatOf(modelId);
                  const shortName = modelShortName(modelId);
                  const isChair = modelId === chairmanModel;
                  return (
                    <div key={modelId} className={`seat-card${isChair ? ' seat-card--chair' : ''}`}>
                      <SeatAvatar
                        color={seat.color}
                        initial={shortName[0]?.toUpperCase()}
                        name={shortName}
                        size={30}
                      />
                      <span className="seat-card-name">{shortName}</span>
                      <span className="seat-card-role">{isChair ? 'chairman' : 'member'}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Ask box */}
            <form className="ask-box" onSubmit={handleSubmit}>
              <textarea
                className="ask-box-textarea"
                placeholder={
                  mode === 'arena'
                    ? 'Is remote work better than office work for software teams?'
                    : 'Is it worth rewriting our Go API gateway in Rust for throughput?'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || !conversation}
                rows={2}
              />
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
              <div className="ask-box-toolbar">
                <div className="ask-box-chips">
                  {webSearchAvailable && (
                    <button
                      type="button"
                      className={`ghost-chip${useWebSearch ? ' ghost-chip--active' : ''}`}
                      onClick={toggleWebSearch}
                      disabled={isLoading}
                      title={`Search via ${searchProvider === 'tavily' ? 'Tavily' : 'DuckDuckGo'}`}
                    >
                      <Globe size={13} strokeWidth={2} aria-hidden="true" />
                      web search
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost-chip"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading || uploadingFile}
                  >
                    <Paperclip size={13} strokeWidth={2} aria-hidden="true" />
                    {uploadingFile ? 'uploading…' : 'attach'}
                  </button>
                </div>
                {isLoading || isExtendingDebate ? (
                  <button type="button" className="ask-bar-cancel" onClick={onCancel}>
                    Cancel
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="convene-btn"
                    disabled={!input.trim() || !conversation}
                  >
                    {mode === 'arena' ? 'Open debate' : 'Convene council'}
                    <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
            </form>

            {/* Prompt chips */}
            <div className="landing-prompt-chips">
              {mode === 'arena' ? (
                <>
                  <button
                    type="button"
                    className="landing-prompt-chip"
                    onClick={() =>
                      setInput('Is remote work better than office work for software teams?')
                    }
                  >
                    Remote vs Office
                  </button>
                  <button
                    type="button"
                    className="landing-prompt-chip"
                    onClick={() => setInput('Should AI development be regulated by governments?')}
                  >
                    AI Regulation
                  </button>
                  <button
                    type="button"
                    className="landing-prompt-chip"
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
                    className="landing-prompt-chip"
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
                    className="landing-prompt-chip"
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
                    className="landing-prompt-chip"
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
      </div>
    );
  }

  // ── CONVERSATION FLOW ──────────────────────────────────────────────────────
  const councilStages = [
    { label: 'First opinions', sublabel: 'stage 1' },
    { label: 'Peer review', sublabel: 'stage 2' },
    { label: 'Synthesis', sublabel: 'stage 3' },
  ];
  const arenaStages = ['Opening', 'Rebuttal', 'Closing', 'Verdict'];

  return (
    <div className="chat-interface">
      {hiddenFileInput}

      <div className="messages-container" ref={messagesContainerRef}>
        {/* Interrupted banner */}
        {conversation.pendingInterrupted &&
          conversation.pendingInfo &&
          (() => {
            const hasStage1 =
              conversation.pendingInfo.partial_data?.responses?.length > 0 ||
              conversation.pendingInfo.partial_data?.stage1?.length > 0;
            const canResume = hasStage1 && conversation.pendingInfo.mode === 'council';
            return (
              <div className="interrupted-banner">
                <div className="interrupted-content">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div className="interrupted-text">
                    <strong>Response interrupted</strong>
                    <span>
                      {conversation.pendingInfo.mode === 'arena'
                        ? 'Arena debate'
                        : 'Council response'}{' '}
                      was interrupted.
                      {canResume
                        ? ' Stage 1 completed — resume from Stage 2?'
                        : ' Retry the full request?'}
                    </span>
                  </div>
                </div>
                <div className="interrupted-actions">
                  {canResume && (
                    <button
                      className="interrupted-btn interrupted-btn--resume"
                      onClick={() => onRetryInterrupted(true)}
                      disabled={isLoading}
                    >
                      <Play size={13} aria-hidden="true" />
                      Resume
                    </button>
                  )}
                  <button
                    className="interrupted-btn interrupted-btn--retry"
                    onClick={() => onRetryInterrupted(false)}
                    disabled={isLoading}
                  >
                    <RotateCw size={13} aria-hidden="true" />
                    Retry
                  </button>
                  <button
                    className="interrupted-btn interrupted-btn--dismiss"
                    onClick={onDismissInterrupted}
                  >
                    <X size={13} aria-hidden="true" />
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })()}

        {/* Messages */}
        {conversation.messages.map((msg, index) => (
          <div key={index} className="message-group">
            {msg.role === 'user' ? (
              <div className="user-message">
                <span className="user-badge" aria-label="You">
                  you
                </span>
                <div className="user-message-body">
                  <div className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                  <div className="message-actions">
                    <button
                      className="message-action-btn"
                      onClick={() => handleCopy(msg.content, index)}
                      aria-label={copiedIndex === index ? 'Copied' : 'Copy message'}
                    >
                      {copiedIndex === index ? (
                        <Check size={13} aria-hidden="true" />
                      ) : (
                        <Copy size={13} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`assistant-message${msg.partial ? ' partial-response' : ''}`}>
                {msg.partial && (
                  <div className="partial-badge-row">
                    <span className="partial-badge">Partial</span>
                  </div>
                )}

                <div className="message-header">
                  <span className="message-label">
                    {msg.mode === 'arena' ? 'Arena Debate' : 'LLM Council'}
                  </span>
                  <div className="message-actions">
                    {getMessageText(msg) && (
                      <button
                        className="message-action-btn"
                        onClick={() => handleCopy(getMessageText(msg), index)}
                        aria-label={copiedIndex === index ? 'Copied' : 'Copy final answer'}
                      >
                        {copiedIndex === index ? (
                          <Check size={13} aria-hidden="true" />
                        ) : (
                          <Copy size={13} aria-hidden="true" />
                        )}
                      </button>
                    )}
                    {canRetry(index) && (
                      <button
                        className="message-action-btn"
                        onClick={handleRetry}
                        aria-label="Retry this question"
                      >
                        <RotateCw size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Web search states */}
                {msg.loading?.webSearch && (
                  <div className="stage-loading" role="status" aria-live="polite">
                    <div className="spinner" aria-hidden="true" />
                    <span>Searching the web…</span>
                  </div>
                )}
                {msg.webSearchUsed && (
                  <div className="web-search-badge">
                    <Globe size={12} aria-hidden="true" />
                    Web search results included
                  </div>
                )}
                {msg.webSearchError && !msg.webSearchUsed && (
                  <div className="web-search-error">
                    <AlertTriangle size={12} aria-hidden="true" />
                    {msg.webSearchError}
                  </div>
                )}

                {msg.errors?.length > 0 && (
                  <ModelErrors
                    errors={msg.errors}
                    onRetry={
                      !isLoading && onRetryAll ? () => onRetryAll(conversation.id) : undefined
                    }
                  />
                )}

                {(() => {
                  const isArena = msg.mode === 'arena';
                  const rounds = msg.rounds || [];
                  const synthesis = msg.synthesis;
                  const participantMapping = getParticipantMapping(msg);
                  const msgMode = isArena ? 'arena' : 'council';

                  const hasResponsesRound = rounds.some((r) => r.round_type === 'responses');
                  const showCouncilRail =
                    !isArena && (msg.loading?.round || msg.loading?.synthesis || rounds.length > 0);

                  return (
                    <>
                      {/* Council: stage rail */}
                      {showCouncilRail && (
                        <div className="stage-rail-card">
                          <StageRail
                            stages={councilStages}
                            completedCount={getCouncilCompleted(msg)}
                          />
                        </div>
                      )}

                      {/* Arena: resolution card + round rail */}
                      {isArena && (rounds.length > 0 || synthesis) && (
                        <>
                          <div className="arena-resolution-card">
                            <div className="arena-resolution-header">
                              <span className="arena-resolved-tag">RESOLVED</span>
                              <span className="arena-meta">
                                {arenaRoundCount} round{arenaRoundCount !== 1 ? 's' : ''} ·{' '}
                                {participantMapping ? Object.keys(participantMapping).length : 2}{' '}
                                participants
                              </span>
                            </div>
                            {conversation.messages[index - 1]?.content && (
                              <h2 className="arena-resolution-statement">
                                {conversation.messages[index - 1].content}
                              </h2>
                            )}
                            {participantMapping && Object.keys(participantMapping).length >= 2 && (
                              <div className="arena-participants">
                                {Object.entries(participantMapping)
                                  .slice(0, 2)
                                  .map(([label, modelId], pIdx) => {
                                    const pSeat = seatOf(modelId);
                                    const pShort = modelShortName(modelId);
                                    return (
                                      <Fragment key={label}>
                                        {pIdx === 1 && (
                                          <span className="arena-vs" aria-hidden="true">
                                            vs
                                          </span>
                                        )}
                                        <div
                                          className="arena-participant-card"
                                          style={{
                                            background: pSeat.soft,
                                            borderColor: pSeat.color,
                                          }}
                                        >
                                          <SeatAvatar
                                            color={pSeat.color}
                                            initial={pShort[0]?.toUpperCase()}
                                            name={pShort}
                                            size={26}
                                          />
                                          <div className="arena-participant-info">
                                            <span className="arena-participant-name">{pShort}</span>
                                            <span
                                              className="arena-participant-role"
                                              style={{ color: pSeat.color }}
                                            >
                                              {pIdx === 0 ? 'ARGUING FOR' : 'ARGUING AGAINST'}
                                            </span>
                                          </div>
                                        </div>
                                      </Fragment>
                                    );
                                  })}
                              </div>
                            )}
                          </div>

                          <div className="stage-rail-card">
                            <StageRail
                              stages={arenaStages}
                              completedCount={getArenaCompleted(msg)}
                            />
                          </div>
                        </>
                      )}

                      {/* Loading: responses */}
                      {msg.loading?.round && msg.loading?.roundType === 'responses' && (
                        <div
                          className="stage-loading stage-loading--streaming"
                          role="status"
                          aria-live="polite"
                        >
                          {msg.streaming?.progress ? (
                            <>
                              <div className="streaming-header">
                                <div className="spinner" aria-hidden="true" />
                                <span>
                                  Collecting responses:{' '}
                                  <span className="mono-count">
                                    {msg.streaming.progress.completed} /{' '}
                                    {msg.streaming.progress.total}
                                  </span>
                                </span>
                              </div>
                              <div className="streaming-models">
                                {msg.streaming.models?.map((model) => {
                                  const mShort = model.split('/')[1] || model;
                                  const isComplete =
                                    msg.streaming.progress.completed_models?.includes(model);
                                  const isStreaming = msg.streaming.tokens?.[model];
                                  const mSeat = seatOf(model);
                                  return (
                                    <div
                                      key={model}
                                      className={`streaming-model${isComplete ? ' streaming-model--complete' : ''}${isStreaming ? ' streaming-model--active' : ''}`}
                                      style={
                                        isComplete
                                          ? { borderColor: mSeat.color, color: mSeat.color }
                                          : isStreaming
                                            ? { borderColor: mSeat.color }
                                            : {}
                                      }
                                    >
                                      <span className="model-status">
                                        {isComplete ? (
                                          <Check size={10} strokeWidth={3} />
                                        ) : isStreaming ? (
                                          '·'
                                        ) : (
                                          '○'
                                        )}
                                      </span>
                                      <span className="model-name">{mShort}</span>
                                    </div>
                                  );
                                })}
                              </div>
                              {Object.entries(msg.streaming.tokens || {}).map(([model, tokens]) => (
                                <div key={model} className="streaming-preview">
                                  <span className="preview-model">
                                    {model.split('/')[1] || model}:
                                  </span>
                                  <span className="preview-text">
                                    {tokens.slice(-100)}
                                    <span className="cursor" aria-hidden="true">
                                      ▋
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </>
                          ) : (
                            <>
                              <div className="spinner" aria-hidden="true" />
                              <span>Collecting individual responses…</span>
                            </>
                          )}
                        </div>
                      )}

                      {/* Loading: rankings */}
                      {msg.loading?.round && msg.loading?.roundType === 'rankings' && (
                        <div className="stage-loading" role="status" aria-live="polite">
                          <div className="spinner" aria-hidden="true" />
                          <span>Peer rankings in progress…</span>
                        </div>
                      )}

                      {/* Loading: arena rounds */}
                      {msg.loading?.round &&
                        !['responses', 'rankings'].includes(msg.loading?.roundType) && (
                          <div className="stage-loading" role="status" aria-live="polite">
                            <div className="spinner" aria-hidden="true" />
                            <span>
                              {msg.loading.roundType === 'initial'
                                ? 'Collecting initial positions…'
                                : `Round ${msg.loading.roundNumber}: Deliberating…`}
                            </span>
                          </div>
                        )}

                      {/* Council Stage 1 header */}
                      {!isArena && hasResponsesRound && (
                        <div className="stage-section-header">
                          <span className="stage-tag stage-tag--1">STAGE 1</span>
                          <h3 className="stage-title">First opinions</h3>
                          <span className="stage-status">
                            {rounds.find((r) => r.round_type === 'responses')?.responses?.length ??
                              '?'}{' '}
                            / {councilModels.length} responded
                          </span>
                        </div>
                      )}

                      {/* Rounds */}
                      {rounds.map((round, i) => (
                        <Fragment key={`${round.round_type}-${round.round_number ?? i}`}>
                          {/* Council Stage 2 header — injected before rankings round */}
                          {!isArena && round.round_type === 'rankings' && (
                            <div className="stage-section-header stage-section-header--spaced">
                              <span className="stage-tag stage-tag--2">STAGE 2</span>
                              <h3 className="stage-title">Peer review</h3>
                              <span className="stage-status">blind · anonymized</span>
                            </div>
                          )}
                          <Round
                            round={round}
                            participantMapping={participantMapping}
                            isCollapsible={isArena}
                            defaultCollapsed={false}
                            showMetrics={false}
                          />
                        </Fragment>
                      ))}

                      {/* Loading: synthesis */}
                      {msg.loading?.synthesis && (
                        <div className="stage-loading" role="status" aria-live="polite">
                          <div className="spinner" aria-hidden="true" />
                          <span>
                            {isArena
                              ? 'Synthesizing debate outcomes…'
                              : 'Final synthesis in progress…'}
                          </span>
                        </div>
                      )}

                      {/* Council Stage 3 header + Synthesis */}
                      {synthesis && !isArena && (
                        <div className="stage-section-header stage-section-header--spaced">
                          <span className="stage-tag stage-tag--3">STAGE 3</span>
                          <h3 className="stage-title">Synthesis</h3>
                          <span className="stage-status">chairman · {chairShort}</span>
                        </div>
                      )}

                      {synthesis && (
                        <Synthesis
                          synthesis={synthesis}
                          participantMapping={participantMapping}
                          originalQuestion={conversation?.messages[index - 1]?.content}
                          conversationId={conversation?.id}
                          onForkConversation={onForkConversation}
                          onExtendDebate={isArena ? onExtendDebate : undefined}
                          onRetrySynthesis={!isArena ? onRetrySynthesis : undefined}
                          isExtending={isExtendingDebate}
                          isLoading={isLoading}
                          mode={msgMode}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        ))}

        {isLoading &&
          (() => {
            const last = conversation.messages[conversation.messages.length - 1];
            return !(last?.loading?.round || last?.loading?.synthesis);
          })() && (
            <div className="loading-indicator">
              <div className="spinner" aria-hidden="true" />
              <span>Consulting the council…</span>
            </div>
          )}

        <div ref={messagesEndRef} />
      </div>

      {/* Fork context preview */}
      {pendingForkContext && (
        <div className="fork-context-preview">
          <div className="fork-context-header">
            <button
              type="button"
              className="fork-context-toggle"
              onClick={() => setForkContextExpanded(!forkContextExpanded)}
              aria-expanded={forkContextExpanded}
            >
              {forkContextExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <MessageSquarePlus size={14} />
              <span>Continuing from previous discussion</span>
            </button>
            <button
              type="button"
              className="fork-context-dismiss"
              onClick={() => setPendingForkContext(null)}
              aria-label="Dismiss context"
            >
              <X size={13} />
            </button>
          </div>
          {forkContextExpanded && (
            <div className="fork-context-body">
              <div className="fork-context-section">
                <span className="fork-context-label">Original question</span>
                <p className="fork-context-text">{pendingForkContext.original_question}</p>
              </div>
              <div className="fork-context-section">
                <span className="fork-context-label">Previous synthesis</span>
                <div className="fork-context-synthesis markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {pendingForkContext.synthesis}
                  </ReactMarkdown>
                </div>
              </div>
              <p className="fork-context-hint">
                This context will be sent to models with your next message.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Attachment chips above ask-bar */}
      {attachments.length > 0 && (
        <div className="attachment-chips attachment-chips--bar">
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

      {/* Bottom ask-bar */}
      <form className="ask-bar" onSubmit={handleSubmit}>
        <div className="ask-bar-inner">
          {/* Arena round count */}
          {mode === 'arena' && arenaConfig && (
            <div className="arena-config">
              <label className="rounds-label">
                <span className="rounds-label-text">
                  Rounds:{' '}
                  <span className="mono-count" aria-label={`${arenaRoundCount} rounds`}>
                    {arenaRoundCount}
                  </span>
                </span>
                <input
                  type="range"
                  min={arenaConfig.min_rounds}
                  max={arenaConfig.max_rounds}
                  value={arenaRoundCount}
                  onChange={(e) => setArenaRoundCount(parseInt(e.target.value))}
                  disabled={isLoading}
                  className="rounds-slider"
                  aria-label="Number of debate rounds"
                />
              </label>
            </div>
          )}
          <div className="ask-bar-row">
            <div className="ask-bar-chips">
              {webSearchAvailable && (
                <button
                  type="button"
                  className={`ghost-chip${useWebSearch ? ' ghost-chip--active' : ''}`}
                  onClick={toggleWebSearch}
                  disabled={isLoading}
                  title={`Search via ${searchProvider === 'tavily' ? 'Tavily' : 'DuckDuckGo'}`}
                >
                  <Globe size={12} strokeWidth={2} aria-hidden="true" />
                  web search
                </button>
              )}
              <button
                type="button"
                className="ghost-chip"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || uploadingFile}
              >
                <Paperclip size={12} strokeWidth={2} aria-hidden="true" />
                {uploadingFile ? 'uploading…' : 'attach'}
              </button>
            </div>
            <div className="ask-bar-input-wrap">
              <textarea
                className="ask-bar-input"
                placeholder="Ask a follow-up… (Enter to send)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                rows={1}
              />
            </div>
            {isLoading || isExtendingDebate ? (
              <button
                type="button"
                className="ask-bar-cancel"
                onClick={onCancel}
                title="Cancel stream (Esc)"
              >
                Cancel
              </button>
            ) : (
              <button type="submit" className="ask-bar-send" disabled={!input.trim()}>
                Send
                <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
