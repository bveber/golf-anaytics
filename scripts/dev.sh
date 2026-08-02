#!/usr/bin/env bash
# Runs `make api` and `make frontend` concurrently, streams combined output to
# the terminal, and writes per-service logs for post-hoc diagnosis.
#
# Logs:
#   logs/api.log       - FastAPI/uvicorn stdout+stderr
#   logs/frontend.log  - Vite dev server stdout+stderr
#
# Query examples:
#   grep -i error logs/api.log
#   grep -i error logs/frontend.log
#   tail -n 100 logs/api.log
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

LOG_DIR="logs"
mkdir -p "$LOG_DIR"

API_LOG="$LOG_DIR/api.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

: > "$API_LOG"
: > "$FRONTEND_LOG"

PIDS=()

cleanup() {
    echo ""
    echo "Shutting down..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null
    done
    wait 2>/dev/null
}
trap cleanup EXIT INT TERM

make api > "$API_LOG" 2>&1 &
PIDS+=($!)

make frontend > "$FRONTEND_LOG" 2>&1 &
PIDS+=($!)

echo "API running (logs: $API_LOG)"
echo "Frontend running (logs: $FRONTEND_LOG)"
echo "Tailing both logs. Press Ctrl+C to stop both services."
echo ""

tail -n +1 -f "$API_LOG" "$FRONTEND_LOG" &
TAIL_PID=$!
PIDS+=("$TAIL_PID")

# Exit (and trigger cleanup) if either service process dies.
while true; do
    for pid in "${PIDS[@]}"; do
        if [ "$pid" != "$TAIL_PID" ] && ! kill -0 "$pid" 2>/dev/null; then
            echo "Process $pid exited unexpectedly — see logs in $LOG_DIR/"
            exit 1
        fi
    done
    sleep 1
done
