.PHONY: help install dev backend frontend tui docker clean lint test

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies
	uv sync
	uv pip install -e ".[tui]"
	cd frontend && npm install

dev: ## Run backend + frontend in parallel
	@echo "Starting backend on :8001 and frontend on :5173..."
	@trap 'kill 0' EXIT; \
		uv run python -m backend.main & \
		cd frontend && npm run dev & \
		wait

backend: ## Run backend server
	uv run python -m backend.main

frontend: ## Run frontend dev server
	cd frontend && npm run dev

tui: ## Run terminal UI
	uv run llm-council-tui

build: ## Build frontend for production
	cd frontend && npm run build

docker: ## Build and run with Docker
	docker compose up --build

docker-build: ## Build Docker image only
	docker build -t llm-council .

lint: ## Run linters
	uv run ruff check backend/ tui/
	uv run ruff format --check backend/ tui/
	cd frontend && npm run lint

lint-fix: ## Fix linting issues
	uv run ruff check --fix backend/ tui/
	uv run ruff format backend/ tui/
	cd frontend && npm run lint -- --fix

clean: ## Clean build artifacts
	rm -rf frontend/dist
	rm -rf .venv
	rm -rf __pycache__ backend/__pycache__ tui/__pycache__
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
