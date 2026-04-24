# Plan 0024: FR-R7 보안 마감 (CSP + logger + rate-limit 통합)

## 개요
`docs/superpowers/specs/2026-04-24-auth-redesign-design.md` § 6 보안 항목과 § 7 FR-R7 을
단일 완료점으로 수렴. 구조화 logger(민감 필드 자동 마스킹), 엄격 CSP, `no-console` eslint rule,
그리고 plan 0021 의 rate-limit 미들웨어 통합 검증까지 배포 직전 보안 게이트를 모두 닫는다.

## 가정사항
- plan 0021 (auth rate-limit) 은 본 plan 구현 시작 시점에 미들웨어(`middleware.ts` 또는
  `app/api/auth/*/route.ts` 내부 guard) 로 `/api/auth/*` 경로에 이미 적용되어 있다.
  본 plan 은 해당 구현의 "적용 여부 통합 검증"만 담당한다.
- plan 0019 (normalizeRiotError) 은 응답 body sanitize, 본 plan 의 logger 는 로그 출력
  시점 sanitize. 역할이 겹치지 않음.
- Next.js 15 App Router 환경. `next.config.ts` 의 `headers()` async 함수를 사용.
- 프로젝트에 기존 `.eslintrc.json` 또는 `eslint.config.mjs` 중 하나가 존재. 실제 구현 시 현
  설정 파일을 채택하며, 둘 다 없으면 `eslint.config.mjs` 신규 생성.
- 로그 출력 타깃은 Vercel stdout (Serverless / Edge). 외부 SaaS 연동 없음.
- `LOG_LEVEL` 미설정 시 prod=`info`, dev=`debug` 기본값.
- CSP 는 meta 태그 아닌 HTTP 응답 헤더(`Content-Security-Policy`)로 고정. `nonce` 는
  FR-R7 범위 밖이므로 `'unsafe-inline'`(style) 허용을 현 단계에서 수용 (PRD § 6 수용 범위).

## 설계 결정사항

| 항목 | 결정 | 근거 |
|---|---|---|
| logger 형식 | JSON 한 줄 (`{level, msg, ts, ...ctx}`) | Vercel drain 파싱 용이, $0 비용 (NFR Cost) |
| sensitive 필드 스캔 | key 이름 대소문자 무시 포함 비교 (`password`, `access_token`, `ssid`, `entitlements`, `authorization`) | spec § 6; key-based 가 value-based 보다 false-positive 낮음 |
| redact 깊이 | 재귀 탐색, 순환 참조 감지 시 `[CIRCULAR]` 로 치환 | NFR Availability (logger 실패 금지) |
| CSP 배포 위치 | `next.config.ts` `headers()` 단일 소스 | NFR Maintainability; `img-src` 갱신 시 한 곳만 수정 |
| eslint rule scope | 전역 `no-console: error`. `lib/logger.ts` 내부는 `eslint-disable` 로 예외 | Regression 차단 (NFR Security/Maintainability) |
| rate-limit 통합 검증 방식 | 체크리스트 + 통합 테스트 1 건(동일 IP 로 401 이 아닌 429 반환 assert) | plan 0021 가 구현 소유; 본 plan 은 배포 gate |
| LOG_LEVEL 제어 | `process.env.LOG_LEVEL` > default(`info`/`debug`) | NFR Operability |
| PUUID 외 식별자 로그 | 금지. 단위 테스트에서 `puuid` 외 ID 키(`email`, `sub`, `gameName#tagLine`) 도 redact 대상 확장 | NFR Compliance (PIPA) |

---

## Phase 1: logger 구현 (lib/logger.ts)

### 테스트 시나리오

#### Test 1-1: given_password_field_when_info_then_redacted
```ts
// Given: ctx = { password: "hunter2", user: "alice" }
// When: logger.info("login attempt", ctx) 호출 후 stdout 캡처
// Then: 캡처된 JSON 의 password === "[REDACTED]", user === "alice"
```

#### Test 1-2: given_access_token_field_when_info_then_redacted
```ts
// Given: ctx = { access_token: "eyJhbGc..." }
// When: logger.info("token fetched", ctx)
// Then: access_token === "[REDACTED]"
```

#### Test 1-3: given_ssid_cookie_when_info_then_redacted
```ts
// Given: ctx = { cookies: { ssid: "abc.def.ghi" } }
// When: logger.info("riot session", ctx)
// Then: cookies.ssid === "[REDACTED]" (재귀 탐색)
```

#### Test 1-4: given_entitlements_jwt_when_info_then_redacted
```ts
// Given: ctx = { entitlements: "eyJhbGc..." }
// When: logger.info("entitlements", ctx)
// Then: entitlements === "[REDACTED]"
```

#### Test 1-5: given_authorization_header_when_info_then_redacted_case_insensitive
```ts
// Given: ctx = { headers: { Authorization: "Bearer xxx" } }
// When: logger.info("req", ctx)
// Then: headers.Authorization === "[REDACTED]" (대소문자 무시)
```

#### Test 1-6: given_email_field_when_info_then_redacted
```ts
// Given: ctx = { email: "jeonsy423@gmail.com" }
// When: logger.info("login", ctx)
// Then: email === "[REDACTED]" (PIPA 최소수집)
```

#### Test 1-7: given_nested_password_in_array_when_info_then_redacted
```ts
// Given: ctx = { attempts: [{ password: "p1" }, { password: "p2" }] }
// When: logger.info("batch", ctx)
// Then: attempts[0].password === attempts[1].password === "[REDACTED]"
```

#### Test 1-8: given_circular_reference_when_info_then_no_throw_and_marker
```ts
// Given: a = {}; a.self = a
// When: logger.info("circ", a)
// Then: 호출 throw 없음, 출력에 "[CIRCULAR]" 포함 (NFR Availability)
```

#### Test 1-9: given_log_level_warn_when_info_then_no_output
```ts
// Given: process.env.LOG_LEVEL = "warn"
// When: logger.info("x"); logger.warn("y")
// Then: stdout 에 "y" 만 출력 (NFR Operability)
```

#### Test 1-10: given_puuid_field_when_info_then_preserved
```ts
// Given: ctx = { puuid: "11111111-2222-3333-4444-555555555555" }
// When: logger.info("ok", ctx)
// Then: puuid 원본 유지 (허용 식별자, NFR Compliance)
```

### 구현 항목

**파일**: `lib/logger.ts` (신규)
- export `logger = { debug, info, warn, error }` 4 레벨.
- `SENSITIVE_KEYS = ['password', 'access_token', 'ssid', 'entitlements', 'authorization', 'email', 'sub']` (소문자 비교).
- `redact(value, seen = WeakSet)` 재귀: key 매칭 시 `[REDACTED]`, 순환 시 `[CIRCULAR]`.
- `write(level, msg, ctx)` = `console.log(JSON.stringify({ level, msg, ts, ...redact(ctx) }))` (logger 내부 한정, eslint-disable).
- `shouldLog(level)` = env LOG_LEVEL 과 현재 level 비교 (debug<info<warn<error).
- `try/catch` 로 `JSON.stringify` 실패 시 `{ level, msg, error: "LOG_SERIALIZE_FAIL" }` fallback.

---

## Phase 2: CSP 헤더 (next.config.ts)

### 테스트 시나리오

#### Test 2-1: given_prod_build_when_request_any_page_then_csp_header_present
```ts
// Given: next build + start
// When: GET /login → response headers
// Then: Content-Security-Policy === "default-src 'self'; img-src 'self' https://media.valorant-api.com data:; style-src 'self' 'unsafe-inline'; connect-src 'self'"
```

#### Test 2-2: E2E_given_login_page_load_when_playwright_visit_then_no_csp_violation
```ts
// Given: Playwright test, page.on('console') collector
// When: await page.goto('/login'); 폼 렌더까지 대기
// Then: CSP violation 유형 console.error === 0
```

#### Test 2-3: given_valorant_api_image_when_store_page_then_allowed
```ts
// Given: store 페이지가 https://media.valorant-api.com/... img 로드
// When: 페이지 렌더
// Then: 이미지 네트워크 상태 200 + CSP 차단 없음
```

### 구현 항목

**파일**: `next.config.ts` (수정 — `headers()` 블록 추가)
- `async headers()` 추가. 루트 경로 `'/:path*'` 에 다음 헤더 매핑:
  - `Content-Security-Policy`: `default-src 'self'; img-src 'self' https://media.valorant-api.com data:; style-src 'self' 'unsafe-inline'; connect-src 'self'`
- 기존 export 유지 (`satisfies NextConfig`).

---

## Phase 3: eslint no-console + 기존 console 치환

### 테스트 시나리오

#### Test 3-1: given_console_log_in_new_code_when_eslint_run_then_error
```ts
// Given: 임시 파일 `app/_probe.ts` 에 `console.log('x')`
// When: npx eslint app/_probe.ts
// Then: exit code !== 0, rule id === 'no-console' 에러 포함
```

#### Test 3-2: given_logger_internal_file_when_eslint_run_then_ok
```ts
// Given: lib/logger.ts 내부 console 사용 (eslint-disable-next-line no-console)
// When: npx eslint lib/logger.ts
// Then: exit code === 0
```

#### Test 3-3: given_full_repo_when_grep_console_log_then_only_whitelisted
```bash
# Given: rg 'console\.(log|error|warn|debug|info)' --type ts --type tsx
# When: 결과 필터 (lib/logger.ts, scripts/dev-*, *.test.ts 제외)
# Then: 0 hit (auth-관련 우선 치환 완료)
```

#### Test 3-4: integration_given_login_flow_when_run_then_no_password_in_captured_logs
```ts
// Given: login integration test (plan 0021) 의 log capture
// When: POST /api/auth/callback 시나리오 실행
// Then: captured.includes("hunter2") === false AND captured.includes("[REDACTED]") === true
```

### 구현 항목

**파일**: `eslint.config.mjs` 또는 `.eslintrc.json` (수정)
- `rules: { 'no-console': 'error' }` 전역 추가.
- `overrides` / `files` 패턴으로 `lib/logger.ts`, `scripts/**`, `**/*.test.ts` 예외.

**파일**: 기존 console 사용처 전반 (grep 기반 일괄)
- `rg 'console\.(log|error|warn|debug|info)' -g '!node_modules' -g '!*.test.*' -g '!scripts/**' -g '!lib/logger.ts'` 결과 전량을
  `import { logger } from '@/lib/logger'` + `logger.<level>` 로 치환.
- auth 관련(`app/api/auth/**`, `lib/riot/**`, `lib/session/**`) 우선.
- 로그 메시지에 민감 값이 문자열 보간으로 들어간 경우(`console.log('token=' + t)`) 는
  반드시 `logger.info('token fetched', { access_token: t })` 형태 context 객체로 전환
  (redact 적용 받게).

---

## Phase 4: rate-limit 통합 검증 (plan 0021 소유 기능)

### 테스트 시나리오

#### Test 4-1: integration_given_6_requests_same_ip_when_auth_start_then_429_on_6th
```ts
// Given: plan 0021 한도(가정: 5 req / 분 / IP). 동일 IP 헤더로 요청.
// When: POST /api/auth/start × 6
// Then: 1~5 = 200/401 중 하나, 6 번째 = 429 + Retry-After 헤더 존재
```

#### Test 4-2: given_rate_limit_429_when_logged_then_no_sensitive_field
```ts
// Given: 429 경로 진입, logger.warn 호출 지점 포함
// When: 로그 캡처
// Then: 캡처 JSON 에 password/access_token/ssid === 부재. ip === 해시 또는 마스킹 값.
```

#### Test 4-3: checklist_given_deploy_gate_when_ship_then_all_auth_routes_covered
```
# Given: 배포 직전 게이트
# When: 아래 체크리스트 전수 확인
# Then: 모두 ✅
#   - [ ] /api/auth/start 에 rate-limit 적용 (Test 4-1 통과)
#   - [ ] /api/auth/callback 에 rate-limit 적용
#   - [ ] /api/auth/manual 에 rate-limit 적용
#   - [ ] CSP 응답 헤더가 /login 에서 확인됨 (Test 2-1)
#   - [ ] E2E console error 0 (Test 2-2)
#   - [ ] `rg 'console\.' -g '!lib/logger.ts' -g '!scripts/**' -g '!*.test.*'` = 0 hit
```

### 구현 항목

**파일**: `docs/plan/0024_SECURITY_HARDENING_PLAN.md` 내 체크리스트 (본 plan 실행 시점 검증)
- 본 plan 은 rate-limit 구현 자체를 수정하지 않음. plan 0021 의 결과물을 import/호출하는
  `app/api/auth/*/route.ts` 에 대해 통합 테스트 3 건만 추가.
- 통합 테스트 위치: `app/api/auth/__tests__/rate-limit-integration.test.ts` (신규 테스트 파일,
  rate-limit 미들웨어 소유는 plan 0021, 본 plan 은 호출만).

---

## NFR 반영

| 카테고리 | 목표치 | 연결 테스트 | 구현 포인트 |
|---|---|---|---|
| Performance | logger cold path < 1ms | 벤치 N/A (목측) | Phase 1 `write` 는 동기 `console.log` 단일 call |
| Scale | N/A | — | 프로세스 로컬 |
| Availability | circular/serialize 실패가 요청 실패로 전이 금지 | Test 1-8 | Phase 1 try/catch + `[CIRCULAR]` marker |
| Security | ★ sensitive 마스킹 / CSP / no-console | Test 1-1 ~ 1-10, 2-1, 2-2, 3-1, 3-4 | Phase 1/2/3 전체 |
| Compliance | PIPA 최소수집 — PUUID 외 식별자 로그 금지 | Test 1-6, 1-10 | Phase 1 SENSITIVE_KEYS 에 email/sub 포함 |
| Operability | LOG_LEVEL env 제어, Vercel+로컬 모두 JSON 한 줄 | Test 1-9 | Phase 1 `shouldLog` |
| Cost | 외부 SaaS 0원 | — | stdout 고정 |
| Maintainability | eslint rule regression 차단 / CSP 단일 소스 | Test 3-1, 3-2, 2-1 | Phase 3 rule + Phase 2 단일 파일 |

---

## 작업 종속성

### 종속성 그래프
```
Phase 1 (logger) ─── 1-1~1-10 테스트 ──→ 1-impl (lib/logger.ts) ─┐
                                                                   ├─→ Phase 3 (console 치환은 logger export 필요)
Phase 2 (CSP) ─── 2-1,2-3 테스트 ──→ 2-impl (next.config.ts) ────┤
                                   └─→ 2-2 E2E (Playwright) ─────┤
Phase 3 (eslint+replace) ─── 3-1,3-2 테스트 ──→ 3-impl rule + grep-replace ─┐
                          └─ 3-3 전수 grep ─────────────────────────────────┤
                          └─ 3-4 (plan 0021 통합 테스트에 의존)────────────┤
                                                                            ▼
Phase 4 (rate-limit 통합 검증) ─── 4-1,4-2,4-3 체크리스트 (Phase 1,3 완료 필요)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|---|---|---|---|
| G1 | 1-1, 1-2, 1-3, 1-4, 1-5, 1-6, 1-7, 1-8, 1-9, 1-10 테스트 | 없음 | ✅ |
| G2 | 2-1, 2-3 테스트 / 3-1, 3-2 테스트 | 없음 (G1 과 독립) | ✅ (G1 과도 병렬) |
| G3 | 1-impl (lib/logger.ts) | G1 | - |
| G4 | 2-impl (next.config.ts) | G2 의 2-1,2-3 | - (G3 와 병렬 가능) |
| G5 | 3-impl (eslint rule + grep 치환) | G3 (logger 필요), G2 의 3-1/3-2 | - |
| G6 | 2-2 E2E (Playwright CSP violation) | G4 | - |
| G7 | 3-3 전수 grep 검증, 3-4 login 통합 로그 assertion | G5 | ✅ |
| G8 | 4-1, 4-2, 4-3 rate-limit 통합 검증 | G5, G7 (그리고 plan 0021 완료) | ✅ |

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|---|---|---|
| 1-1 | password redact | ⬜ 미착수 | |
| 1-2 | access_token redact | ⬜ 미착수 | |
| 1-3 | ssid 재귀 redact | ⬜ 미착수 | |
| 1-4 | entitlements redact | ⬜ 미착수 | |
| 1-5 | authorization 대소문자 무시 | ⬜ 미착수 | |
| 1-6 | email redact (PIPA) | ⬜ 미착수 | |
| 1-7 | 배열 내 중첩 redact | ⬜ 미착수 | |
| 1-8 | 순환 참조 안전 처리 | ⬜ 미착수 | |
| 1-9 | LOG_LEVEL env 필터 | ⬜ 미착수 | |
| 1-10 | puuid 원본 보존 | ⬜ 미착수 | |
| 1-impl | lib/logger.ts 구현 | ⬜ 미착수 | |
| 2-1 | CSP 헤더 정확성 | ⬜ 미착수 | |
| 2-2 | E2E CSP violation 0 | ⬜ 미착수 | Playwright, plan 0022 공유 |
| 2-3 | valorant-api 이미지 허용 | ⬜ 미착수 | |
| 2-impl | next.config.ts headers() | ⬜ 미착수 | |
| 3-1 | no-console 에러 감지 | ⬜ 미착수 | |
| 3-2 | logger 내부 예외 허용 | ⬜ 미착수 | |
| 3-3 | 전수 grep = 0 hit | ⬜ 미착수 | |
| 3-4 | 로그인 통합 password 0 assertion | ⬜ 미착수 | plan 0021 연동 |
| 3-impl | eslint rule + console 일괄 치환 | ⬜ 미착수 | auth 우선 |
| 4-1 | 429 경계 테스트 | ⬜ 미착수 | plan 0021 소유 기능 검증 |
| 4-2 | 429 로그 sensitive 부재 | ⬜ 미착수 | |
| 4-3 | 배포 직전 체크리스트 전수 ✅ | ⬜ 미착수 | ship gate |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
