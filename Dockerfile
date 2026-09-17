# Use a slim Python base matching your local version (3.11+).
FROM python:3.12-slim

# Don't buffer stdout/stderr — logs show up immediately in Cloud Run.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install curl for healthcheck, then clean up to keep image small.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (cached layer — only re-runs when requirements change).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code.
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY project_data/ ./project_data/
COPY .agents/ ./.agents/

# Cloud Run provides the port via the $PORT env var (defaults to 8080).
ENV PORT=8080

# Container healthcheck — Cloud Run ignores this but it helps local Docker and
# orchestrators like Docker Compose detect readiness.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Run as non-root for security.
RUN adduser --disabled-password --no-create-home appuser
USER appuser

# Start the app. Note: no --reload in production.
# Shell form so $PORT is expanded at runtime.
CMD ["sh", "-c", "uvicorn src.jira_ai.api.main:app --host 0.0.0.0 --port $PORT"]
