#!/usr/bin/env bash
set -uo pipefail

OUTPUT_PATH=""
if [ "${1:-}" = "--output_path" ]; then
  OUTPUT_PATH="$2"
  shift 2
fi

MODE="${1:-new}"
cd /app 2>/dev/null || cd "$(dirname "$0")"

TEST_LOG="$(mktemp)"
STATUS=0
VITEST="./node_modules/.bin/vitest"

run_tests() {
  "$VITEST" run --config tests/vitest.config.js --reporter=junit \
    --outputFile="$OUTPUT_PATH" "$@" 2>&1 | tee -a "$TEST_LOG"
  local status=${PIPESTATUS[0]}
  if [ "$status" -ne 0 ]; then STATUS=$status; fi
}

if [ -n "$OUTPUT_PATH" ]; then
  mkdir -p "$(dirname "$OUTPUT_PATH")" 2>/dev/null || true
fi

case "$MODE" in
  base)
    run_tests tests/unit/defer-loading-cache-control.test.js \
              tests/unit/system-inject.test.js \
              tests/unit/minimax-transport-target-format.test.js \
              tests/translator/bugs-claudeCode-context.test.js
    ;;
  new)
    run_tests tests/unit/9router-5375c2.test.js
    ;;
  *)
    echo "unknown mode: $MODE (expected base or new)" >&2
    exit 2
    ;;
esac

if [ -n "$OUTPUT_PATH" ] && [ ! -s "$OUTPUT_PATH" ]; then
  echo '<?xml version="1.0" encoding="UTF-8"?><testsuites tests="0" failures="0"></testsuites>' > "$OUTPUT_PATH"
fi

exit "$STATUS"
