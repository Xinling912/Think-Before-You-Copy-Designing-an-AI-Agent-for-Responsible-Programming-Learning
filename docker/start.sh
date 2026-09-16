#!/usr/bin/env sh
set -eu

cd /app

export PYTHONPATH=/app/services/ai-core-python

DATABASE_PATH=/app/runtime/responsible-edu-agent.db
BACKUP_DIRECTORY=/app/runtime/backups
BACKUP_INTERVAL_SECONDS="${SQLITE_BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_RETENTION="${SQLITE_BACKUP_RETENTION:-7}"

python scripts/runtime_db_backup.py \
  --db "$DATABASE_PATH" \
  --backup-dir "$BACKUP_DIRECTORY" \
  --retention "$BACKUP_RETENTION" \
  --once

python scripts/runtime_db_backup.py \
  --db "$DATABASE_PATH" \
  --backup-dir "$BACKUP_DIRECTORY" \
  --retention "$BACKUP_RETENTION" \
  --watch-seconds "$BACKUP_INTERVAL_SECONDS" &
BACKUP_PID=$!

python -m uvicorn app.main:app --host 127.0.0.1 --port 9000 --app-dir /app/services/ai-core-python &
AI_CORE_PID=$!
API_PID=''

cleanup() {
  kill "$BACKUP_PID" 2>/dev/null || true
  kill "$AI_CORE_PID" 2>/dev/null || true
  if [ -n "$API_PID" ]; then
    kill "$API_PID" 2>/dev/null || true
  fi
}

trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

ready_attempts=0
until python - <<'PY'
from urllib.request import urlopen

try:
    with urlopen("http://127.0.0.1:9000/ai/health", timeout=1) as response:
        raise SystemExit(0 if response.status == 200 else 1)
except Exception:
    raise SystemExit(1)
PY
do
  ready_attempts=$((ready_attempts + 1))
  if [ "$ready_attempts" -ge 30 ]; then
    echo "AI Core did not become ready in time" >&2
    exit 1
  fi
  sleep 1
done

./responsible-api -f /app/responsible-api.yaml &
API_PID=$!

wait "$API_PID"
