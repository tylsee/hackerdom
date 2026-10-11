#!/bin/sh
set -eu
export PORT="${PORT:-8080}"
export BACKEND_PORT=3001
if [ "$PORT" = "$BACKEND_PORT" ]; then export BACKEND_PORT=3002; fi
envsubst '${PORT} ${BACKEND_PORT}' < /app/deployment/nginx.conf.template > /tmp/docuai-nginx.conf
nginx -t -c /tmp/docuai-nginx.conf
PORT="$BACKEND_PORT" HOST=127.0.0.1 node /app/backend/src/server.js &
backend_pid=$!
nginx -c /tmp/docuai-nginx.conf -g 'daemon off;' &
nginx_pid=$!
cleanup() {
    trap - TERM INT EXIT
    kill -TERM "$backend_pid" "$nginx_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
    wait "$nginx_pid" 2>/dev/null || true
}
trap cleanup TERM INT EXIT
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
    sleep 1
done
echo 'A required DocuAI process stopped; restarting the service.' >&2
exit 1
