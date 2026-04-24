# Plan 0023: FR-R6 레거시 Auth 제거

## 개요

Spec `2026-04-24-auth-redesign-design.md` § 4-1/§ 7 FR-R6 에 따라, 동작하지 않는 구 implicit-grant flow(`/api/auth/start`, `/api/auth/callback`) 와 dev 우회 경로(`/api/auth/manual`, `public/auth-helper.html`) 를 전면 제거하고, `lib/riot/auth.ts` 의 URL builder 를 삭제한 뒤 `.env.example` 을 새 redesign 에 맞춰 정리한다. 본 plan 은 auth redesign(0018~0022) 의 **최종 청소 단계** 로, 새 경로가 green 이 된 이후에만 실행한다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 삭제 범위 단위 | 디렉토리 통째 삭제 (`app/api/auth/start/`, `/callback/`, `/manual/`) + 정적 파일 1개 (`public/auth-helper.html`) | spec § 4-1 모듈 경계 표의 "(삭제)" 표기와 1:1. route 내부에 다른 파일이 섞여 있지 않음을 검증 후 `git rm -r` 로 일괄 처리. |
| `lib/riot/auth.ts` 처리 | `buildRiotAuthorizeUrl` **완전 삭제**. `exchangeAccessTokenForEntitlements`/`fetchPuuid` 는 plan 0019 에서 `lib/riot/auth-client.ts` 로 이미 이관 → **재export 하지 않음**. 남는 코드가 없으면 파일 자체 삭제. | spec § 4-1 "auth.ts (축소) exchangeEntitlements/fetchPuuid 유지, URL builder 삭제" + FR-R6 "재export 금지". dead alias 는 유지비용만 발생. **NFR: Maintainability** |
| `withTimeout` 헬퍼 처리 | 사용처가 0 이면 삭제, 있으면 `lib/riot/http-util.ts` 로 이동 (본 plan 범위에서 결정) | 기존 auth.ts 에 동거했던 유틸이 auth redesign 후에도 참조되는지 grep 후 결정. **NFR: Maintainability** |
| `.env.example` 키 변경 | `RIOT_AUTH_REDIRECT_URI` 제거. `PENDING_ENC_KEY`(32B base64, TOKEN_ENC_KEY 와 분리), `APP_ORIGIN`(예: `https://valshop.vercel.app`) 추가. 각 키 위에 주석으로 용도/생성법 명시 | spec § 4-6 환경변수 표. 신규 키의 의미를 README 없이도 파악 가능하게. **NFR: Operability** |
| `.env.example` 병합 충돌 대비 | plan 0018(TOKEN_ENC_KEY 기존), 0020(PENDING_ENC_KEY), 0021(APP_ORIGIN) 이 각각 건드릴 수 있음 → 본 plan 이 **최종 정합 보증자**. merge 후 diff 로 중복/누락 재검증 | spec § 8 실행 순서. 본 plan 은 G5(최종). **NFR: Operability** |
| 문서 deprecate 처리 | plan 0001, 0015 파일 **최상단에 DEPRECATED 배너** (`> DEPRECATED (replaced by plan 0018~0023 auth redesign)`) 추가. 파일 삭제 X (이력 보존). | 이력 추적 + 신규 기여자 혼란 방지. `docs/plan/` 외 수정 금지 규칙 ≠ `docs/plan/` 내부 파일 수정 금지. 본 plan 파일 생성뿐 아니라 동일 디렉토리 내 배너 삽입은 허용 범위. **NFR: Maintainability** |
| README 처리 | auth 섹션에 구 `RIOT_AUTH_REDIRECT_URI` / redirect URI 설정 설명이 있으면 제거하고 신규 키(PENDING_ENC_KEY, APP_ORIGIN) 설명으로 치환 | spec § 7 FR-R6 "필요시 README". **NFR: Operability** |
| 검증 방식 | grep 기반 불변식 4종 + `tsc --noEmit` + `eslint` | spec § 7 FR-R6 인수조건에 grep 기준 명시. 회귀는 plan 0021/0022 가 담당. **NFR: Maintainability** |
| 삭제 순서 | 1) grep 검증(프리플라이트) → 2) 파일 삭제 → 3) `.env.example` 정리 → 4) 문서 정리 → 5) grep 재검증 | 순서 역전 시 typecheck 깨진 채 커밋될 수 있음. **NFR: Availability** |

### 가정사항

- A1. **plan 0018~0022 가 모두 merge 된 상태에서 본 plan 이 실행된다**. 특히:
  - 0019 가 `exchangeAccessTokenForEntitlements`/`fetchPuuid` 를 `lib/riot/auth-client.ts` 로 이관 완료.
  - 0020 가 `lib/session/pending-jar.ts` + `PENDING_ENC_KEY` crypto 로드 완료.
  - 0021 가 `/api/auth/login`, `/mfa`, `/logout` route + origin-check(`APP_ORIGIN`) 완료.
  - 0022 가 새 경로 E2E smoke 통과.
- A2. 새 경로가 green 이 아닌 상태에서 본 plan 을 실행하면 프로덕션 로그인 불가(다운타임) → 실행 전 CI green + 수동 로그인 1회 확인 필수.
- A3. plan 0001, 0015 는 **파일 삭제 금지**(이력 보존). 배너만 삽입.
- A4. Vercel 환경변수에서 `RIOT_AUTH_REDIRECT_URI` 제거는 **본 PR merge 직후 수동 작업** (체크리스트에 명시, 자동화 범위 밖).
- A5. `lib/riot/auth.ts` 내 `withTimeout` 은 grep 결과 사용처 없으면 삭제, 있으면 `lib/riot/http-util.ts` 로 이동 후 import 경로 갱신 — 본 plan 실행 시점에 최종 결정.

## NFR 반영

| 카테고리 | 목표치/제약 | 반영 방식 | 근거 |
|---|---|---|---|
| Performance | N/A — 제거 작업 (오히려 cold start 개선 여지) | 측정 대상 아님 | spec § 9 |
| Scale | N/A | — | — |
| Availability | 제거 전 새 경로(0021/0022) green 확인 필수. 순서 위반 = 다운타임 | 가정사항 A1/A2 + Phase 1 프리플라이트 checklist | spec § 8 의존 그래프 |
| Security | 동작 안 하는 dev-only `/api/auth/manual` (토큰 평문 POST) 및 `public/auth-helper.html` 제거로 공격 표면 축소 | Phase 2 에서 디렉토리 통째 삭제 + grep 0 검증 | spec § 1 배경, § 6 위협 모델 |
| Compliance | 오용 가능한 dev 경로 잔류는 ADR-0011(threat model) 과 모순. production 배포 전 청결화 | 모든 삭제 대상 prod 코드베이스에서 제거 | spec § 6, ADR-0011 |
| Operability | `.env.example` = Vercel env 와 single source of truth. 구 키 제거 체크리스트를 PR description 에 첨부 | 설계 결정 테이블 "Vercel env 체크리스트" + README 갱신 | spec § 4-6 |
| Cost | N/A (파일 삭제만) | — | — |
| Maintainability | grep 4종 불변식으로 dead-code 부재 보증. 구 plan 문서에 DEPRECATED 배너로 신규 기여자 혼란 방지. | Phase 1 / Phase 3 grep 테스트 + plan 0001/0015 배너 | spec § 7 FR-R6 |

---

## Phase 1: 프리플라이트 검증 (삭제 전 불변식 확인)

삭제는 되돌리기 번거롭고(git revert 가능하지만 코드리뷰 재개) 타 plan 이 의존하고 있으면 CI 가 깨진다. 따라서 삭제 **전에** "삭제해도 아무도 안 쓰는가" 를 grep 으로 증명하는 것이 본 phase.

### 테스트 시나리오

#### Test 1-1: 신규 auth 경로가 이미 존재하는가 (가정사항 A1 증명)
```ts
// tests/critical-path/auth-redesign-presence.test.ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Feature: auth redesign 신규 경로 선행 존재 확인", () => {
  const root = resolve(__dirname, "../..");

  it("given_plan_0021_완료_when_route_존재_확인_then_login_mfa_logout_모두_존재", () => {
    // Given: plan 0021 merge 전제
    // When: 신규 route 파일 존재 확인
    // Then: 3개 모두 존재 (하나라도 없으면 본 plan 실행 금지)
    expect(existsSync(resolve(root, "app/api/auth/login/route.ts"))).toBe(true);
    expect(existsSync(resolve(root, "app/api/auth/mfa/route.ts"))).toBe(true);
    expect(existsSync(resolve(root, "app/api/auth/logout/route.ts"))).toBe(true);
  });

  it("given_plan_0019_완료_when_auth_client_존재_확인_then_fetchPuuid_exchangeEntitlements_이관_완료", async () => {
    // Given: plan 0019 merge 전제
    // When: auth-client.ts import
    // Then: 두 함수 export 존재
    const mod = await import("@/lib/riot/auth-client");
    expect(typeof mod.fetchPuuid).toBe("function");
    expect(typeof mod.exchangeEntitlements ?? typeof mod.exchangeAccessTokenForEntitlements).toBe(
      "function",
    );
  });
});
```

#### Test 1-2: 레거시 symbol 의 호출처가 전부 제거 가능한지 grep 프리플라이트
```sh
# scripts/preflight-0023.sh — Phase 1 구현 항목
# exit code 0 이면 삭제 진행 가능, 1 이면 중단.

set -euo pipefail

# 1) buildRiotAuthorizeUrl 호출처는 삭제 대상 디렉토리 안에서만 존재해야 함
callers=$(grep -rln "buildRiotAuthorizeUrl" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  --exclude-dir="app/api/auth/start" --exclude-dir="app/api/auth/callback" \
  --exclude-dir="app/api/auth/manual" \
  . | { grep -v "^./lib/riot/auth.ts$" || true; } \
    | { grep -v "^./docs/" || true; })
if [ -n "$callers" ]; then
  echo "FAIL: buildRiotAuthorizeUrl 가 삭제 대상 외부에서도 사용됨:"
  echo "$callers"
  exit 1
fi

# 2) /api/auth/start 참조가 테스트 및 UI 에 남아있지 않은지
refs=$(grep -rln "/api/auth/start\|/api/auth/callback\|/api/auth/manual\|auth-helper.html" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  --exclude-dir="app/api/auth/start" --exclude-dir="app/api/auth/callback" \
  --exclude-dir="app/api/auth/manual" \
  --exclude-dir="public" --exclude-dir="docs" \
  app/ lib/ tests/ 2>/dev/null || true)
if [ -n "$refs" ]; then
  echo "FAIL: 레거시 경로 참조가 prod/test 코드에 남아있음:"
  echo "$refs"
  exit 1
fi

echo "OK: 프리플라이트 통과 — 삭제 진행 가능"
```

#### Test 1-3: withTimeout 사용처 파악
```ts
// tests/critical-path/auth-dead-code-grep.test.ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("Feature: lib/riot/auth.ts 잔여 유틸 사용처 파악", () => {
  it("given_auth_ts_withTimeout_when_grep_then_외부_사용처_0_또는_http_util로_이관_가능", () => {
    // Given: 삭제 전 snapshot
    // When: withTimeout grep (auth.ts 자기 자신 제외)
    const out = execSync(
      `git grep -l "withTimeout" -- '*.ts' '*.tsx' | grep -v 'lib/riot/auth.ts' || true`,
      { encoding: "utf8" },
    ).trim();
    // Then: 결과에 따라 설계 결정사항 "withTimeout 처리" 분기 확정
    // (테스트 자체는 통과 — 결과를 plan 실행자가 눈으로 확인)
    expect(typeof out).toBe("string");
  });
});
```

### 구현 항목

**파일**: `scripts/preflight-0023.sh` (신규, 임시)
- 위 Test 1-2 스크립트 작성. CI 는 아니고 plan 실행자가 수동 실행하는 게이트.
- 로컬에서 `bash scripts/preflight-0023.sh` 로 실행, OK 나와야만 Phase 2 진행.

**파일**: `tests/critical-path/auth-redesign-presence.test.ts` (신규)
- Test 1-1 작성. `vitest run` 에서 green 이어야 Phase 2 진행.

**파일**: `tests/critical-path/auth-dead-code-grep.test.ts` (신규)
- Test 1-3 작성. 결과 출력값으로 설계 결정사항 A5(withTimeout 이동 vs 삭제) 확정.

---

## Phase 2: 파일/디렉토리 삭제 + 환경변수 정리

### 테스트 시나리오

#### Test 2-1: 삭제 후 디렉토리/파일 부재 확인
```ts
// tests/critical-path/legacy-auth-removed.test.ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Feature: 레거시 auth 경로 제거 확인", () => {
  const root = resolve(__dirname, "../..");

  it("given_plan_0023_적용_when_legacy_path_확인_then_모두_부재", () => {
    // Given: Phase 2 구현 완료
    // When: 존재 여부 확인
    // Then: 전부 false
    expect(existsSync(resolve(root, "app/api/auth/start"))).toBe(false);
    expect(existsSync(resolve(root, "app/api/auth/callback"))).toBe(false);
    expect(existsSync(resolve(root, "app/api/auth/manual"))).toBe(false);
    expect(existsSync(resolve(root, "public/auth-helper.html"))).toBe(false);
  });
});
```

#### Test 2-2: `buildRiotAuthorizeUrl` export 제거 확인
```ts
// tests/critical-path/auth-builder-removed.test.ts
import { describe, it, expect } from "vitest";

describe("Feature: buildRiotAuthorizeUrl export 제거", () => {
  it("given_auth_ts_or_auth_client_ts_when_import_then_buildRiotAuthorizeUrl_부재", async () => {
    // Given: plan 0023 적용 후
    // When: lib/riot/* import 시도
    // Then: 어떤 모듈에서도 해당 심볼이 export 되지 않음 (auth.ts 자체가 삭제됐을 수 있음)
    try {
      const authMod = (await import("@/lib/riot/auth")) as Record<string, unknown>;
      expect(authMod.buildRiotAuthorizeUrl).toBeUndefined();
    } catch (e) {
      // auth.ts 파일 자체 삭제된 경우 (설계 결정 "남는 코드 없으면 파일 삭제" 분기)
      expect((e as Error).message).toMatch(/Cannot find module/);
    }
    const clientMod = (await import("@/lib/riot/auth-client")) as Record<string, unknown>;
    expect(clientMod.buildRiotAuthorizeUrl).toBeUndefined();
  });
});
```

#### Test 2-3: `.env.example` 키 정합성 스냅샷
```ts
// tests/critical-path/env-example-keys.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Feature: .env.example 키 정합성", () => {
  const content = readFileSync(resolve(__dirname, "../../.env.example"), "utf8");

  it("given_env_example_when_파싱_then_RIOT_AUTH_REDIRECT_URI_부재", () => {
    // Given/When
    // Then: 제거 대상 키 부재
    expect(content).not.toMatch(/^RIOT_AUTH_REDIRECT_URI=/m);
  });

  it("given_env_example_when_파싱_then_PENDING_ENC_KEY_와_APP_ORIGIN_존재", () => {
    // Given/When
    // Then: 신규 키 존재 + 주석 동반
    expect(content).toMatch(/^PENDING_ENC_KEY=/m);
    expect(content).toMatch(/^APP_ORIGIN=/m);
    // 주석 동반 (키 바로 앞 줄에 # 로 시작하는 설명)
    expect(content).toMatch(/#[^\n]*PENDING_ENC_KEY[\s\S]*?^PENDING_ENC_KEY=/m);
    expect(content).toMatch(/#[^\n]*APP_ORIGIN[\s\S]*?^APP_ORIGIN=/m);
  });

  it("given_env_example_when_TOKEN_ENC_KEY_확인_then_여전히_존재", () => {
    // Given: 0018/0019 에서 추가된 키는 유지
    expect(content).toMatch(/^TOKEN_ENC_KEY=/m);
  });
});
```

#### Test 2-4: typecheck + lint 회귀
```sh
# CI 에서 실행되는 기존 검사들이 green 유지
pnpm typecheck
pnpm lint
pnpm vitest run
```

### 구현 항목

**삭제**: `app/api/auth/start/` (디렉토리 전체)
- `git rm -r app/api/auth/start`

**삭제**: `app/api/auth/callback/` (디렉토리 전체)
- `git rm -r app/api/auth/callback`

**삭제**: `app/api/auth/manual/` (디렉토리 전체)
- 현재 `git status` 상 untracked(`??`) 로 보이나, 존재하면 `rm -rf app/api/auth/manual` 후 staging 하지 않음으로 제거.

**삭제**: `public/auth-helper.html`
- `git rm public/auth-helper.html` (또는 untracked 면 `rm public/auth-helper.html`)

**파일**: `lib/riot/auth.ts`
- `buildRiotAuthorizeUrl` 함수 블록(현재 파일의 58~70 라인 부근) 완전 삭제.
- `exchangeAccessTokenForEntitlements`, `fetchPuuid` 는 plan 0019 에서 `lib/riot/auth-client.ts` 로 이관 완료 가정 → **재export 하지 않음**. 본 파일에서도 함수 본문 삭제.
- `withTimeout` 은 Test 1-3 결과에 따라:
  - 외부 사용처 0 → 함수 삭제.
  - 사용처 있음 → `lib/riot/http-util.ts` 신규 파일에 이동, import 경로 갱신.
- 결과적으로 `lib/riot/auth.ts` 내용이 비게 되면 파일 자체 `git rm lib/riot/auth.ts`.

**파일**: `.env.example`
- `RIOT_AUTH_REDIRECT_URI` 블록 (주석 3줄 + 키 1줄) 제거.
- `TOKEN_ENC_KEY` 블록 바로 아래에 다음 2개 키 추가:
  ```
  # AES-GCM encryption key for MFA pending cookie (server-side only)
  # Distinct from TOKEN_ENC_KEY — rotating one must not affect the other.
  # Generate with: openssl rand -base64 32
  PENDING_ENC_KEY=

  # Application origin for CSRF / Origin-header validation on /api/auth/*
  # Development: http://localhost:3000
  # Production: https://<your-domain>
  APP_ORIGIN=http://localhost:3000
  ```
- plan 0018/0020/0021 과 병합 충돌 시 본 plan 이 최종 정합 — 3개 키(`TOKEN_ENC_KEY`, `PENDING_ENC_KEY`, `APP_ORIGIN`)가 모두 존재하고 `RIOT_AUTH_REDIRECT_URI` 가 부재함을 보장.

**파일**: `tests/critical-path/legacy-auth-removed.test.ts` (신규)
- Test 2-1 작성. 삭제 회귀 방어.

**파일**: `tests/critical-path/auth-builder-removed.test.ts` (신규)
- Test 2-2 작성.

**파일**: `tests/critical-path/env-example-keys.test.ts` (신규)
- Test 2-3 작성.

---

## Phase 3: 문서 정리 및 최종 grep 불변식

### 테스트 시나리오

#### Test 3-1: spec 의 4개 grep 불변식 (FR-R6 인수조건)
```sh
# scripts/postflight-0023.sh — 본 plan 의 인수조건 자동 검증
set -euo pipefail

fail=0

run_grep() {
  local label=$1; shift
  local expected=$1; shift
  local result
  result=$(grep -rn "$@" --exclude-dir=node_modules --exclude-dir=.next \
    --exclude-dir=.git --exclude-dir=docs 2>/dev/null || true)
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
```

#### Test 3-2: 구 plan 문서 deprecate 배너 삽입 확인
```ts
// tests/critical-path/plan-deprecation-banner.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Feature: 구 auth plan DEPRECATED 배너", () => {
  const root = resolve(__dirname, "../..");

  it.each(["0001_RIOT_AUTH_LOGIN_PLAN.md", "0015_LOGIN_BUTTON_WIRING_PLAN.md"])(
    "given_구_plan_%s_when_최상단_확인_then_DEPRECATED_배너_존재",
    (name) => {
      // Given: Phase 3 적용 후
      const content = readFileSync(resolve(root, "docs/plan", name), "utf8");
      // When: 상단 5줄 추출
      const head = content.split("\n").slice(0, 8).join("\n");
      // Then: 배너 매칭
      expect(head).toMatch(/DEPRECATED.*plan\s*0018\s*[~\-–]\s*0023/i);
    },
  );
});
```

#### Test 3-3: README auth 섹션 정합성 (존재 시)
```sh
# README.md 에 "RIOT_AUTH_REDIRECT_URI" 또는 auth-helper 언급이 남아있지 않아야 함
! grep -E "RIOT_AUTH_REDIRECT_URI|auth-helper" README.md
```

### 구현 항목

**파일**: `docs/plan/0001_RIOT_AUTH_LOGIN_PLAN.md` (최상단 배너 삽입)
- 파일 본문 첫 줄(`# Plan ...`) 바로 위에 다음 블록 추가:
  ```markdown
  > **DEPRECATED (replaced by plan 0018~0023 auth redesign)**
  > 본 plan 은 Riot implicit-grant redirect 를 전제로 작성됐으나,
  > spec `docs/superpowers/specs/2026-04-24-auth-redesign-design.md` 에 따라
  > PW 프록시 + ssid reauth 패턴으로 전면 재설계됨. 이력 보존 목적으로만 유지.

  ```
- 파일 내용 기타 부분은 수정 금지 (이력 보존).

**파일**: `docs/plan/0015_LOGIN_BUTTON_WIRING_PLAN.md` (최상단 배너 삽입)
- 위와 동일한 배너 삽입. 본문 무수정.

**파일**: `README.md` (auth 섹션 — 존재 시)
- 구 `RIOT_AUTH_REDIRECT_URI` 설정 설명, `/api/auth/start` / `/api/auth/callback` flow 설명, `public/auth-helper.html` 사용법 언급을 **제거**.
- 신규 auth 섹션이 plan 0021 에서 추가되지 않았다면 다음 최소 내용으로 치환:
  - 필수 env: `TOKEN_ENC_KEY`, `PENDING_ENC_KEY`, `APP_ORIGIN`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RIOT_CLIENT_VERSION`.
  - 로그인 엔드포인트: `POST /api/auth/login`, `POST /api/auth/mfa`, `DELETE /api/auth/logout`.
  - 자세한 설계는 spec `2026-04-24-auth-redesign-design.md` 참조.

**파일**: `scripts/postflight-0023.sh` (신규, 임시)
- Test 3-1 스크립트 작성. PR 본문에 실행 결과(OK 4줄) 붙여넣기 의무.

**파일**: `tests/critical-path/plan-deprecation-banner.test.ts` (신규)
- Test 3-2 작성.

**Vercel env 수동 작업 체크리스트** (PR description 에 포함):
- [ ] Vercel project → Settings → Environment Variables 에서 `RIOT_AUTH_REDIRECT_URI` 삭제 (Production/Preview/Development 3개 환경 모두).
- [ ] `PENDING_ENC_KEY` 설정값 3개 환경 모두 주입 확인 (plan 0020 에서 주입 여부 선검증).
- [ ] `APP_ORIGIN` 설정값 3개 환경 모두 주입 확인 (plan 0021 에서 주입 여부 선검증).
- [ ] 변경 후 재배포 트리거 + 로그인 smoke 1회.

---

## 작업 종속성

### 종속성 그래프

```
(선행) plan 0018 ── plan 0019 ── plan 0020 ── plan 0021 ── plan 0022
                                                                   │
                                                                   ▼
Phase 1 (프리플라이트)
  1-1 redesign 존재 테스트 ──┐
  1-2 grep 프리플라이트 스크립트 ─┼─► Phase 1 Gate (OK 여야 Phase 2)
  1-3 withTimeout 사용처 파악 ──┘
                                       │
                                       ▼
Phase 2 (삭제 + env)
  2-impl-delete-dirs (start/callback/manual/auth-helper) ─┐
  2-impl-auth-ts (buildRiotAuthorizeUrl + 잔여 심볼 정리) ─┼─► typecheck/lint/vitest green
  2-impl-env-example (키 정리) ────────────────────────────┤
  2-1 / 2-2 / 2-3 회귀 테스트 ────────────────────────────┘
                                       │
                                       ▼
Phase 3 (문서 + 최종 grep)
  3-impl-plan-banner (0001, 0015)
  3-impl-readme
  3-impl-postflight-script
  3-1 / 3-2 grep + banner 테스트 ─► 최종 Gate (모두 green → merge 가능)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G0 (외부) | plan 0018~0022 merge | — | — (외부 의존) |
| G1 | 1-1, 1-3 테스트 파일 작성 | G0 완료 | ✅ (서로 다른 파일) |
| G1-gate | 1-2 프리플라이트 스크립트 실행 + 결과 확인 | G1 완료 | - |
| G2 | 2-impl-delete-dirs, 2-impl-env-example | G1-gate OK | ✅ (서로 다른 파일·디렉토리) |
| G2b | 2-impl-auth-ts | G1-gate OK + G1 의 Test 1-3 결과 반영 | - (동일 파일 단독 수정) |
| G3 | 2-1, 2-2, 2-3 테스트 작성 + `pnpm typecheck && pnpm lint && pnpm vitest run` | G2, G2b 완료 | ✅ (테스트 파일 서로 다름) |
| G4 | 3-impl-plan-banner (0001), 3-impl-plan-banner (0015), 3-impl-readme | G3 green | ✅ (서로 다른 파일) |
| G5 | 3-impl-postflight-script, 3-1 실행, 3-2 테스트 | G4 완료 | ✅ |
| G6 | Vercel env 수동 정리 체크리스트 | PR merge 직후 | - (수동) |

### 종속성 판단 기준

- **종속**: G1 의 1-2 스크립트가 green 이 아니면 Phase 2 로 넘어갈 수 없음 → 명시적 gate.
- **종속**: 2-impl-auth-ts 와 2-impl-delete-dirs 는 서로 독립된 파일 조작이지만, 두 작업 모두 완료되어야 typecheck 가 green → G3 는 둘 다 선행.
- **종속**: 3-impl-plan-banner 는 Phase 2 green 이후로 한정 (Phase 2 가 깨진 상태로 문서만 갱신하면 잘못된 "완료" 신호).
- **독립**: plan 0001 배너와 plan 0015 배너는 서로 다른 파일 → G4 내 병렬.
- **독립**: `.env.example` 과 `app/api/auth/start/` 삭제는 서로 다른 경로 → G2 내 병렬.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 0-ext | plan 0018~0022 merge 완료 확인 | ⬜ 미착수 | 외부 의존 (가정사항 A1) |
| 1-1 | Test 1-1 redesign-presence.test.ts 작성 | ⬜ 미착수 | |
| 1-2 | scripts/preflight-0023.sh 작성 + 실행 | ⬜ 미착수 | OK 출력되면 gate 통과 |
| 1-3 | Test 1-3 auth-dead-code-grep.test.ts 작성 + 결과 확인 | ⬜ 미착수 | withTimeout 이동 vs 삭제 결정 근거 |
| 2-1 | Test 2-1 legacy-auth-removed.test.ts 작성 | ⬜ 미착수 | |
| 2-2 | Test 2-2 auth-builder-removed.test.ts 작성 | ⬜ 미착수 | |
| 2-3 | Test 2-3 env-example-keys.test.ts 작성 | ⬜ 미착수 | |
| 2-impl-delete-dirs | app/api/auth/{start,callback,manual} + public/auth-helper.html 삭제 | ⬜ 미착수 | `git rm -r` |
| 2-impl-auth-ts | lib/riot/auth.ts 의 buildRiotAuthorizeUrl + 잔여 심볼 정리 (필요 시 파일 삭제) | ⬜ 미착수 | 1-3 결과로 withTimeout 분기 확정 |
| 2-impl-env-example | .env.example 에서 RIOT_AUTH_REDIRECT_URI 제거 + PENDING_ENC_KEY/APP_ORIGIN 추가 | ⬜ 미착수 | 주석 포함 |
| 2-gate | pnpm typecheck && pnpm lint && pnpm vitest run green | ⬜ 미착수 | |
| 3-1 | scripts/postflight-0023.sh 작성 + 실행 OK | ⬜ 미착수 | spec 의 4개 grep 불변식 자동 검증 |
| 3-2 | Test 3-2 plan-deprecation-banner.test.ts 작성 | ⬜ 미착수 | |
| 3-impl-plan-banner-0001 | docs/plan/0001 상단에 DEPRECATED 배너 삽입 | ⬜ 미착수 | 본문 무수정 |
| 3-impl-plan-banner-0015 | docs/plan/0015 상단에 DEPRECATED 배너 삽입 | ⬜ 미착수 | 본문 무수정 |
| 3-impl-readme | README.md 의 구 auth 설명 정리 (존재 시) | ⬜ 미착수 | grep 으로 잔존 여부 확인 후 조치 |
| 3-gate | postflight + 3-2 테스트 green | ⬜ 미착수 | merge gate |
| 6-ext | Vercel env 에서 RIOT_AUTH_REDIRECT_URI 삭제 | ⬜ 미착수 | PR merge 직후 수동 |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨

---

## Amendment A (2026-04-24 저녁) — α′ env 추가 반영

> spec § 11 amendment, plan 0019 A-7, plan 0021 A-1 반영.

`.env.example` 최종 정합 책임자(본 plan) 가 추가로 포함해야 하는 키:

- `RIOT_CLIENT_USER_AGENT` — 기본값 주석으로 `RiotClient/60.0.6.4770705.4749685 rso-auth (Windows;10;;Professional, x64)` 명시. 덮어쓸 필요 거의 없음.
- `AUTH_MODE` — `credentials` (기본) 또는 `manual-ssid` (fallback). 주석에 "α′ 실패 시 manual-ssid 로 전환, spec § 11 Fallback 참조".

grep 불변식 체크리스트에 추가:
- `grep -n RIOT_CLIENT_USER_AGENT .env.example` = 1
- `grep -n AUTH_MODE .env.example` = 1

FR-R6 의 기존 삭제 대상 목록은 불변.
