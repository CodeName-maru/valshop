#!/bin/bash
# Preflight check for plan 0023: Legacy Auth Removal
# Exit code 0 = OK (can proceed), 1 = FAIL (must stop)

set -euo pipefail

echo "=== Plan 0023 Preflight Check ==="

# 1) buildRiotAuthorizeUrl 호출처는 삭제 대상 디렉토리 안에서만 존재해야 함
# Only check source files (.ts, .tsx), not docs
# Filter out: lib/riot/auth.ts (definition itself), lib/auth/callback.ts (legacy callback), legacy routes
callers=$(git grep -l "buildRiotAuthorizeUrl" -- '*.ts' '*.tsx' 2>/dev/null \
  | grep -v "^lib/riot/auth.ts$" \
  | grep -v "^lib/auth/callback.ts$" \
  | grep -v "^app/api/auth/start/" \
  | grep -v "^app/api/auth/callback/" \
  | grep -v "^app/api/auth/manual/" || true)
if [ -n "$callers" ]; then
  echo "FAIL: buildRiotAuthorizeUrl 가 삭제 대상 외부에서도 사용됨:"
  echo "$callers"
  exit 1
fi

# 2) /api/auth/start 참조가 테스트 및 UI 에 남아있지 않은지
refs=$(git grep -ln "/api/auth/start\|/api/auth/callback\|/api/auth/manual\|auth-helper.html" -- '*.ts' '*.tsx' 2>/dev/null \
  | grep -v "^app/api/auth/start/" \
  | grep -v "^app/api/auth/callback/" \
  | grep -v "^app/api/auth/manual/" \
  | grep -v "^public/" \
  | grep -v "^tests/" || true)
if [ -n "$refs" ]; then
  echo "FAIL: 레거시 경로 참조가 prod/test 코드에 남아있음:"
  echo "$refs"
  exit 1
fi

echo "OK: 프리플라이트 통과 — 삭제 진행 가능"
