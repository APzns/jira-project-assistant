# Use a slim Python base matching your local version (3.11+).
FROM python:3.12-slim

# Don't buffer stdout/stderr — logs show up immediately in Cloud Run.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install dependencies first (cached layer — only re-runs when requirements change).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code.
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY project_data/ ./project_data/

# Cloud Run provides the port via the $PORT env var (defaults to 8080).
ENV PORT=8080

# Start the app. Note: no --reload in production.
# Uses the shell form so $PORT is expanded at runtime.
CMD uvicorn src.jira_ai.api.main:app --host 0.0.0.0 --port $PORT
