#!/bin/bash
# Postflight check for plan 0023: Legacy Auth Removal
# FR-R6 인수조건: 4개 grep 불변식

set -euo pipefail

fail=0

run_grep() {
  local label=$1; shift
  local expected=$1; shift
  local result
  result=$(grep -rn "$@" --exclude-dir=node_modules --exclude-dir=.next \
    --exclude-dir=.git --exclude-dir=docs 2>/dev/null \
    | grep -v "tests/critical-path/auth-builder-removed.test.ts" \
    | grep -v "scripts/preflight-0023.sh" \
    | grep -v "scripts/postflight-0023.sh" \
    || true)
  local count
  count=$(printf "%s" "$result" | grep -c . || true)
  if [ "$count" != "$expected" ]; then
    echo "FAIL [$label]: expected $expected matches, got $count"
    echo "$result"
    fail=1
  else
    echo "OK   [$label]: $count match (expected $expected)"
  fi
}

# 인수조건 § 7 FR-R6
run_grep "auth-helper in public/" 0 "auth-helper" public/
run_grep "buildRiotAuthorizeUrl anywhere (src)" 0 "buildRiotAuthorizeUrl" app/ lib/ tests/ scripts/
run_grep "/api/auth/start in app/" 0 "/api/auth/start" app/
run_grep "/api/auth/callback in app/" 0 "/api/auth/callback" app/

exit $fail
