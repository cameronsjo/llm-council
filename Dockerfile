# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Build args for version info
ARG VERSION=dev
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY frontend/ ./

# Build for production with version info
ENV VITE_API_URL=""
ENV VITE_APP_VERSION=${VERSION}
ENV VITE_GIT_COMMIT=${GIT_COMMIT}
ENV VITE_BUILD_TIME=${BUILD_TIME}
RUN npm run build

# Stage 2: Build the Python virtualenv with uv
FROM python:3.12-slim AS python-builder

WORKDIR /app

# Install uv for faster dependency management
RUN pip install uv

# Build an isolated virtualenv that will be copied into the runtime stage
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN uv venv "${VIRTUAL_ENV}"

# Copy the files needed to build the wheel. Only backend* is present, so the
# setuptools `find` (include = backend*, tui*) resolves to backend just as today.
COPY pyproject.toml ./
COPY backend/ ./backend/

# Install the project and its dependencies into the virtualenv
RUN uv pip install .

# Stage 3: Slim runtime
FROM python:3.12-slim

WORKDIR /app

# Build args for version info (need to redeclare in each stage)
ARG VERSION=dev
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown

# OCI labels for container registry linking and metadata
LABEL org.opencontainers.image.source="https://github.com/cameronsjo/llm-council"
LABEL org.opencontainers.image.description="Collaborative LLM deliberation system with Council and Arena modes"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL org.opencontainers.image.created="${BUILD_TIME}"

# Set version info as environment variables
ENV APP_VERSION=${VERSION}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}

# Use the virtualenv built in the previous stage
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

# Create an unprivileged system user to run the application
RUN groupadd --system --gid 10001 council \
    && useradd --system --uid 10001 --gid 10001 council

# Copy the pre-built virtualenv (dependencies + installed backend package)
COPY --from=python-builder /opt/venv /opt/venv

# Copy application source. Running `python -m backend.main` from /app resolves
# `backend` from here (cwd wins over the venv copy), so STATIC_DIR = /app/static
# as backend/main.py expects.
COPY --chown=council:council backend/ ./backend/

# Copy built frontend from the frontend builder stage
COPY --from=frontend-builder --chown=council:council /app/dist ./static

# Create the data directory owned by the runtime user. The council-data named
# volume mounts here and inherits this ownership on first use.
RUN mkdir -p /app/data/conversations \
    && chown -R council:council /app/data

# Drop privileges
USER council

# Expose port
EXPOSE 8001

# Container-level health probe using only the Python stdlib (slim images lack
# curl, and this avoids coupling the probe to httpx).
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/health').read()"

# Run the application
CMD ["python", "-m", "backend.main"]
