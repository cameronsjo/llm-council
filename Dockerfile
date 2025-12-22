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

# Stage 2: Python backend with frontend static files
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

# Install uv for faster dependency management
RUN pip install uv

# Copy project files
COPY pyproject.toml ./
COPY backend/ ./backend/

# Install dependencies
RUN uv pip install --system .

# Create data directory
RUN mkdir -p /app/data/conversations

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/dist ./static

# Expose port
EXPOSE 8001

# Run the application
CMD ["python", "-m", "backend.main"]
