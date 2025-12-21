# Roadmap Ideas

Feature ideas and enhancements for LLM Council.

## Ideas

| Item | Priority | Effort | Notes |
|------|----------|--------|-------|
| Ollama integration | p1 | small | Local model execution with zero API cost. Privacy-conscious deployment. Same async pattern as OpenRouter. Config: OLLAMA_HOST, OLLAMA_ENABLED |
| File attachments | p1 | medium | PDF, TXT, MD, image upload support. Uses pymupdf4llm for PDF→markdown. Base64 data URIs for vision models. Opens document analysis use case |
| Built-in tools | p2 | medium | Calculator (AST-based safe eval), Wikipedia, ArXiv, Yahoo Finance. Research capabilities for council. Consider LangChain dependency |
| DuckDuckGo search | p2 | small | Free web search alternative to Tavily. Fallback when no API key. LangChain DuckDuckGoSearchRun |
| Per-model error UI | p3 | small | Show which specific model failed in Stage1/Stage2 tabs. Better UX than silent graceful degradation |
| Export conversations | p2 | small | Markdown/PDF/JSON export for sharing insights |
| Dark mode | p2 | small | Theme toggle, respect system preference |
| Keyboard shortcuts | p2 | small | Cmd+Enter to send, Cmd+N new conversation, etc. |
| Cost tracking dashboard | p2 | medium | Visualize spend per model/conversation over time |
| Hot reload config | p2 | small | Change models without server restart |
| Exa AI search | p3 | small | Alternative to Tavily with neural search |
| Prompt templates | p3 | medium | Save/reuse common queries |
| Reasoning model support | p2 | medium | Special handling for o1/o3 thinking tokens |
| API/headless mode | p3 | medium | Programmatic access for automation |
| Setup wizard | p3 | medium | Better onboarding UX for first-time users |
| PostgreSQL/MySQL support | p4 | medium | Scale beyond JSON files for heavy use |
| Google Drive integration | p4 | medium | Sync conversations to cloud backup |

## Legend

- **p0**: Critical/urgent
- **p1**: High priority - core functionality
- **p2**: Medium priority - nice to have
- **p3**: Low priority - edge case, cosmetic
- **p4**: Backlog

- **small**: < 1 day
- **medium**: 1-3 days
- **large**: > 3 days
