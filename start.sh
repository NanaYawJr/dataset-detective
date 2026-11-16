#!/bin/bash
# Runs the counting server and the web server together. If either one stops,
# the container stops, and the host starts a fresh one.
set -u

cd "${API_DIR:-/app/api}"
uvicorn app.main:create_app --factory --host 127.0.0.1 --port "${API_PORT:-8000}" --no-access-log --log-level warning &
caddy run --config "${CADDYFILE:-/etc/caddy/Caddyfile}" --adapter caddyfile &

trap 'kill $(jobs -p) 2>/dev/null' TERM INT
wait -n
status=$?
kill $(jobs -p) 2>/dev/null
exit "$status"
