# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY frontend/ ./

# Build for production with relative API path
ENV VITE_API_URL=""
RUN npm run build

# Stage 2: Python backend with frontend static files
FROM python:3.12-slim

WORKDIR /app

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
