#!/usr/bin/env bash
# Run voice-api in Docker and verify it responds.
# Requires: Redis and Postgres running (e.g. docker-compose.dev.yml).

set -e
IMAGE="${1:-voice-api}"
PORT="${2:-3003}"

echo "Stopping any existing container on port $PORT..."
cid=$(docker ps -q --filter "publish=$PORT" 2>/dev/null) && [ -n "$cid" ] && docker stop $cid || true

echo "Starting container (image=$IMAGE, port=$PORT)..."
docker run -d --rm \
  --name voice-api-test \
  -e REDIS_URL="${REDIS_URL:-redis://host.docker.internal:6379}" \
  -e DATABASE_URL="${DATABASE_URL:-postgresql://voice_user:voice_pass@host.docker.internal:5432/voice_db}" \
  -p "$PORT:3000" \
  "$IMAGE"

echo "Waiting for server..."
for i in $(seq 1 15); do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/health" | grep -q 200; then
    echo "Server is up."
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "Timeout waiting for server."
    docker logs voice-api-test
    docker stop voice-api-test
    exit 1
  fi
  sleep 1
done

echo ""
echo "--- /health ---"
curl -s "http://localhost:$PORT/health" | head -1
echo ""
echo ""
echo "--- /voices (first 200 chars) ---"
curl -s "http://localhost:$PORT/voices" | head -c 200
echo ""
echo ""
echo "Done. Container 'voice-api-test' is still running. Stop with: docker stop voice-api-test"
