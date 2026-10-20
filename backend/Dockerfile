# Ncode backend (FastAPI). Built by docker-compose.yml at the repository root.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY app ./app

# Ncode's own data (users, library, settings, uploads, backups, secret.key) lives in a volume
RUN useradd --create-home --uid 10001 ncode && mkdir -p /app/data && chown ncode:ncode /app/data
USER ncode
VOLUME ["/app/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health/ready', timeout=4).status == 200 else 1)"

# --proxy-headers: client addresses come from Caddy (login lock-out and rate limits need them)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
