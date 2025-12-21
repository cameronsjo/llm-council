# Contributing to LLM Council

Thank you for your interest in contributing to LLM Council! This document outlines the development workflow and standards for the project.

## Prerequisites

- Python 3.10+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) for Python package management
- An [OpenRouter](https://openrouter.ai/) API key

## Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/cameronsjo/llm-council.git
cd llm-council
```

### 2. Install Dependencies

**Backend (Python):**

```bash
uv sync
```

**Frontend (Node.js):**

```bash
cd frontend
npm install
cd ..
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your OPENROUTER_API_KEY
```

### 4. Run Development Servers

You MUST run both servers in separate terminals:

```bash
# Terminal 1: Backend (port 8001)
uv run python -m backend.main

# Terminal 2: Frontend (port 5173)
cd frontend && npm run dev
```

Open http://localhost:5173 in your browser.

## Code Style

### Python

- **MUST** include type annotations on all functions
- **MUST** use relative imports within the `backend/` package
- **SHOULD** use ruff for linting and formatting
- **SHOULD** use lazy logging: `logger.debug("val=%s", val)` not f-strings

Run linting:

```bash
uv run ruff check backend/
uv run ruff format backend/
```

### JavaScript/React

- **MUST** pass ESLint checks before committing
- **SHOULD** use async/await over callbacks
- **SHOULD** follow React hooks best practices

Run linting:

```bash
cd frontend
npm run lint
```

## Testing

### Backend

Test OpenRouter connectivity:

```bash
uv run python test_openrouter.py
```

### Frontend

Build check:

```bash
cd frontend
npm run build
```

## Submitting Changes

### Branch Naming

Use descriptive branch names:

- `feat/arena-mode` for features
- `fix/ranking-parse` for bug fixes
- `docs/api-reference` for documentation

### Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Build process, dependencies, etc. |

**Examples:**

```bash
feat(arena): add configurable rebuttal rounds
fix(council): handle empty ranking responses gracefully
docs(readme): update authentication section
```

### Pull Request Process

1. **MUST** ensure all linting passes
2. **MUST** test your changes locally
3. **MUST** update documentation if adding new features
4. **SHOULD** keep PRs focused on a single concern
5. **SHOULD** reference related issues using closing keywords (`Closes #123`)

### PR Description Template

```markdown
## Summary

Brief description of changes.

## Test Plan

- [ ] Tested locally with both Council and Arena modes
- [ ] Verified no console errors
- [ ] Checked mobile responsiveness (if UI changes)
```

## Project Structure

```
llm-council/
├── backend/           # FastAPI backend
│   ├── main.py        # API endpoints
│   ├── council.py     # Council mode logic
│   ├── arena.py       # Arena mode logic
│   ├── config.py      # Configuration
│   └── ...
├── frontend/          # React frontend
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   └── ...
│   └── package.json
├── docs/              # Documentation
├── CLAUDE.md          # Technical notes
└── README.md
```

## Questions?

If you have questions about contributing, open an issue or start a discussion.
