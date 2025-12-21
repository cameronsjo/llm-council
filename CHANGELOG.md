# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Mobile responsive sidebar with hamburger menu and drawer pattern
- Progress stepper showing council deliberation stages
- Skeleton loading component with shimmer animation
- ARIA roles and keyboard navigation to tabs for accessibility
- Focus trap and dialog semantics to config modal
- Loading state announcements for screen readers
- Mode toggle slide animation between Council/Arena
- Message action reveal animation on hover
- Conversation selection animation with accent indicator
- Empty state with context-aware prompt suggestions

### Changed

- Unified tab styling across stages using CSS custom properties
- Added aria-labels to all icon-only buttons

### Fixed

- Input form disappearing after first message
- Removed duplicated CSS, consolidated shared styles in index.css

## [0.6.0] - 2024-12-20

### Added

- Resume capability to continue from Stage 1 when interrupted
- Display partial results after page refresh instead of losing data
- Copy buttons to Stage 1 and Stage 2 individual responses

### Changed

- Improved markdown input textarea with monospace font for code/markdown pasting
- Larger default textarea size (150px min, 500px max)
- Preserve whitespace with pre-wrap in textarea

### Fixed

- Reasoning toggle for OpenAI's array format (extract text from {summary} objects)
- Disabled horizontal scroll with overflow-wrap in textarea

## [0.5.0] - 2024-12-19

### Added

- File attachment support (PDF, images, text files)
- DuckDuckGo search as fallback when Tavily unavailable
- Conversation export (Markdown and JSON formats)
- Dark mode with system preference detection
- Hot reload for config (reload .env without restart)
- Reasoning model support (o1/o3) with collapsible reasoning display

### Changed

- Improved dark theme contrast with lighter text colors
- Rewritten ModelSelector.css to use CSS variables instead of hardcoded colors
- Added --color-surface and --color-surface-elevated variables for consistent theming
- Used brighter burgundy accent (#E07A8E) for dark mode visibility

### Fixed

- Sidebar.css hardcoded colors replaced with CSS variables
- Modal, search, filters, and model groups work properly in both themes

## [0.4.0] - 2024-12-18

### Added

- Model curation feature for selecting favorite models
- Curated models API endpoints (GET/POST /api/curated-models)
- Filter model selector to show curated models by default
- Proper HTML meta tags, OG tags, and favicon links
- App icons for all platforms (iOS, Android, web)
- PWA support with site.webmanifest

### Changed

- Extracted shared hooks: useModels, useCuratedModels, useModelFiltering, useExpandableGroups
- Extracted shared utilities in lib/models.js
- Extracted shared components: ModelSearchBox, FilterChips, ModelGroups
- Reduced ModelSelector from 382 to 196 lines (-49%)
- Reduced ModelCuration from 360 to 152 lines (-58%)
- Reduced Sidebar from 281 to 111 lines (-60%)

## [0.3.0] - 2024-12-17

### Added

- GitHub Container Registry (GHCR) workflow for Docker image builds
- MIT LICENSE file for fork modifications
- Fork attribution to README (originally karpathy/llm-council)
- Reverse proxy authentication via trusted proxy headers (Authelia, OAuth2 Proxy compatible)
- Per-user conversation isolation when auth enabled
- Configurable data directory via LLMCOUNCIL_DATA_DIR environment variable
- User display in sidebar when authenticated
- Comprehensive auth setup documentation

### Changed

- Updated CLAUDE.md with Arena Mode and auth module documentation
- Updated data flow diagrams for both Council and Arena modes

## [0.2.0] - 2024-12-16

### Added

- Arena Mode for multi-round LLM debates alongside existing Council Mode
- Debate orchestration with opening statements, rebuttals, closing arguments
- Anonymous participant system (Participant A, B, C) during debates
- Synthesis round with consensus, dissents, and identity reveal
- Mode toggle between Council and Arena with round count slider
- ArenaRound, ArenaSynthesis, ArenaMode frontend components
- Purple-themed styling for arena UI
- Per-model custom prompts support in openrouter.py

### Changed

- Extended API with mode parameter and arena streaming events
- Added arena message storage format

### Fixed

- Animation causing group-models height issue in ModelSelector
- Widened config modal for better model selector display
- Increased ModelSelector font sizes for readability
- Added fixed height and scroll to model-groups container

## [0.1.0] - 2024-12-15

### Added

- Core council deliberation system with 3-stage workflow:
  - Stage 1: Parallel queries to multiple LLMs
  - Stage 2: Anonymized peer review and ranking
  - Stage 3: Chairman synthesis of final response
- Web search integration via Tavily API (optional)
- Docker containerization with multi-stage builds
- Dynamic model list fetched from OpenRouter API
- Model configuration UI with provider grouping
- Metrics display showing cost, tokens, and latency
- JSON-based conversation storage
- SSE streaming for real-time response updates
- Scholarly deliberation theme UI redesign
- Collapsible provider groups and search in ModelSelector
- Single container deployment (FastAPI serves both API and frontend)

### Changed

- Frontend port from 3000 to 3100 in docker-compose
- Unified frontend and backend into single container build

### Fixed

- SPA routing (serve at root, move health check to /api/health)

[Unreleased]: https://github.com/cameronsjo/llm-council/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/cameronsjo/llm-council/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/cameronsjo/llm-council/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/cameronsjo/llm-council/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/cameronsjo/llm-council/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cameronsjo/llm-council/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/cameronsjo/llm-council/releases/tag/v0.1.0
