# Plan 0021: Auth Route Handlers + 미들웨어 (FR-R4)

## 개요

Auth 재설계의 HTTP 진입점 3개 (`POST /api/auth/login`, `POST /api/auth/mfa`, `DELETE /api/auth/logout`) 를 plan 0019 의 `auth-client` 와 plan 0020 의 `session` 을 엮어 구현한다. 공통 미들웨어 2종 (Origin 검증, IP rate-limit) 을 신규 도입해 CSRF 이중 방어 + 비용 0 원칙(`rate_limit_buckets` 테이블) 의 서버 측 쓰로틀을 완성한다. PW 가 응답/로그에 절대 누수되지 않음을 smoke assertion 으로 보증한다.

단일 소스 spec: [docs/superpowers/specs/2026-04-24-auth-redesign-design.md](../superpowers/specs/2026-04-24-auth-redesign-design.md) § 4-3 / § 5 / § 6 / § 7 FR-R4.

## 가정사항 (Cross-plan 경계)

본 plan 은 아래 산출물을 **소비만** 한다. 구현·수정 금지.

### Plan 0018 (DB 스키마) 제공
- `user_tokens` 확장 컬럼: `session_id`, `session_expires_at`, `ssid_enc`, `tdid_enc` (NOT NULL).
- `rate_limit_buckets (bucket_key text pk, count int, window_start timestamptz)` 테이블.
- `lib/supabase/user-tokens-repo.ts` exports: `upsertTokens`, `findBySessionId`, `deleteBySessionId`, `deleteByPuuid`.

### Plan 0019 (auth-client) 제공
```ts
// lib/riot/auth-client.ts
export function initAuthFlow(jar: CookieJar): Promise<void>;
export function submitCredentials(jar: CookieJar, c: {username:string; password:string}):
  Promise<{kind:"ok"; accessToken:string} | {kind:"mfa"; emailHint:string} | {kind:"invalid"} | {kind:"rate_limited"} | {kind:"upstream"}>;
export function submitMfa(jar: CookieJar, code: string):
  Promise<{kind:"ok"; accessToken:string} | {kind:"invalid"} | {kind:"rate_limited"} | {kind:"upstream"}>;
export function fetchPuuid(accessToken: string): Promise<string>;
export function exchangeEntitlements(accessToken: string): Promise<string>;
// lib/riot/errors.ts
export type AuthErrorCode =
  | "invalid_credentials" | "mfa_required" | "mfa_invalid" | "mfa_expired"
  | "rate_limited" | "riot_unavailable" | "session_expired" | "unknown";
```

### Plan 0020 (session) 제공
```ts
// lib/session/store.ts
export function createSession(puuid: string, tokens: Tokens): Promise<{sessionId: string; maxAge: number}>;
export function destroy(sessionId: string): Promise<void>;
// lib/session/pending-jar.ts
export function encodePendingJar(jar: CookieJar, username: string): string;
export function decodePendingJar(blob: string): {jar: CookieJar; username: string} | null;
```

### Plan 0022 (UI) 소비
- 본 plan 의 **응답 JSON 스키마 = 계약**. 변경 시 plan 0022 동기 필요.
- 성공: `{ok: true}` / `{status: "mfa_required", email_hint: string}`.
- 에러: `{code: AuthErrorCode, retry_after?: number}`.

### Plan 0024 (logger) 소비
- `lib/logger.ts` 의 `logger.info/warn/error` 만 import. `console.log` 금지 (eslint no-console error).

### 본 plan 단독 소유
- `app/api/auth/login/route.ts` (신규)
- `app/api/auth/mfa/route.ts` (신규)
- `app/api/auth/logout/route.ts` (수정: 기존 Plan 0005 구현 전면 교체)
- `lib/middleware/rate-limit.ts` (신규)
- `lib/middleware/origin-check.ts` (신규)

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 미들웨어 합성 순서 | `originCheck → rateLimit → handler` (Origin 부적합은 무의미 호출이라 rate-limit 전에 컷) | spec § 6. rate-limit 은 비용 소모 호출 |
| Rate-limit 저장소 | Supabase `rate_limit_buckets` 테이블 (fixed window 1분). Redis 미사용 | spec § 6 Cost 0 원칙, C1 결정 |
| Rate-limit 키 | `bucket_key = "${path}:${clientIp}"`. IP 는 `x-forwarded-for` 첫 hop → fallback `127.0.0.1` | Vercel edge 환경 기본 패턴 |
| Rate-limit 윈도우 | login: 5회/분, mfa: 10회/분. 초과 시 `{code:"rate_limited", retry_after: <남은초>}` + HTTP 429 | spec § 6 |
| Origin 검증 | `req.headers.get("origin") === process.env.APP_ORIGIN`. 불일치 → 403 `{code:"unknown"}` (code 노출 최소화) | spec § 6 SameSite 이중 방어 |
| Login 2FA-off 응답 | `Set-Cookie: session=<id>; HttpOnly; Secure; SameSite=Lax; Max-Age=<maxAge>; Path=/` + body `{ok:true}` | spec § 4-5 |
| Login 2FA-on 응답 | `Set-Cookie: auth_pending=<enc>; HttpOnly; Secure; SameSite=Strict; Max-Age=600; Path=/` + body `{status:"mfa_required", email_hint}` | spec § 4-5 |
| MFA 성공 응답 | `auth_pending` 를 Max-Age=0 으로 clear + session cookie set + `{ok:true}` | spec § 4-3 MFA flow |
| Logout 응답 | `Set-Cookie: session=; Max-Age=0` + DB row 삭제 (`destroy(sessionId)`) + `{ok:true}`. session 없으면 200 멱등 | spec § 7 FR-R4 |
| Riot 5xx/timeout | 502 `{code:"riot_unavailable"}` — 재시도 유도 | spec § 6 NFR Availability |
| PW 누수 방지 | 진입점 `const {username,password} = await req.json()` 이후 password 는 `submitCredentials` 외로 전파 금지. 응답 body / 로그 / 에러 메시지 smoke assertion | ADR-0011 |
| 로거 | `lib/logger.ts` 경유. route 에서 `logger.info("auth.login.attempt", {path, code, ip})` — password/token 필드 절대 금지 | spec § 6 Operability |
| 테스트 전략 | MSW 로 Riot `/api/v1/authorization`, `/userinfo`, entitlements stub. 실 Supabase test project (RLS 우회 service_role) 로 DB 왕복. `next-test-api-route-handler` 로 route 호출 | ADR-0006 |

## NFR 반영

| 카테고리 | 반영 방식 | 연결 테스트 |
|---|---|---|
| **Performance** | login p95 ≤ 3s (Riot 3회 + DB 1회). mfa p95 ≤ 2s (Riot 1 + DB 1). auth-client AbortController 3s cap (plan 0019 제공) | Test 1-1, 2-1 (시간 측정 assertion) |
| **Scale** | ~50 동시 유저. route handler stateless (session 은 DB). rate-limit 이 폭주 방어 | Test 4-1 (429 버킷) |
| **Availability** | Riot 5xx/timeout → 502 `{code:"riot_unavailable"}`, client 재시도 유도 (plan 0022 UI). DB 장애 시 500 `{code:"unknown"}` graceful | Test 1-4 (riot 5xx), Test 1-5 (DB 장애) |
| **Security (핵심)** | ① Origin 검증 403. ② SameSite Lax/Strict. ③ Rate-limit 5/10/분. ④ password 응답/로그 부재 smoke assertion. ⑤ auth_pending AES-GCM 암호화 확인 | **Test 3-1, 3-2, 4-1, 5-1, 5-2** |
| **Compliance** | PW 서버 일시 경유 후 메모리 폐기 (ADR-0011). route 변수 스코프 밖 전파 없음 assertion | Test 5-1 |
| **Operability** | `lib/logger.ts` 경유 구조화 로그 (`auth.login.attempt`, `auth.login.error`, `auth.mfa.*`, `auth.logout.*`). `console.log` 금지 (eslint no-console error, plan 0024 소유) | Test 6-1 (로그 스키마) |
| **Cost** | `rate_limit_buckets` Supabase 테이블만 사용. Redis/외부 서비스 0 | 설계 자체 |
| **Maintainability** | 미들웨어 헬퍼 (`withOrigin`, `withRateLimit`) 재사용. route 별 통합 테스트로 회귀 보증 | 전체 Phase |

---

## Phase 1: Login route (`POST /api/auth/login`)

### 테스트 시나리오

#### Test 1-1: 2FA-off happy path
```ts
// tests/integration/auth-login.test.ts
it("given유효자격증명_when로그인POST_thenDB행과session쿠키발급_PW누수없음", async () => {
  // Given:
  //   - MSW: initAuthFlow 200, submitCredentials → {kind:"ok", accessToken}, userinfo/entitlements 200
  //   - 실 Supabase test project, user_tokens 빈 상태
  // When:
  //   - POST /api/auth/login body {"username":"user","password":"SECRET_PW_XYZ"}
  //   - headers {Origin: APP_ORIGIN}
  // Then:
  //   - status 200, body === {ok: true}
  //   - Set-Cookie: /session=[a-f0-9-]+; HttpOnly; Secure; SameSite=Lax/
  //   - SELECT * FROM user_tokens WHERE puuid=$1 → 1 row, session_id matches cookie
  //   - 응답 텍스트에 "SECRET_PW_XYZ" 미포함 (NFR Security)
  //   - 응답 완료 시각 - 요청 시작 ≤ 3000ms (NFR Performance)
});
```

#### Test 1-2: 2FA-on → auth_pending cookie 발급
```ts
it("given2FA응답_when로그인POST_thenauth_pending암호화쿠키와email_hint반환", async () => {
  // Given: MSW submitCredentials → {kind:"mfa", emailHint:"j***@..."}
  // When: POST /api/auth/login
  // Then:
  //   - 200, body === {status:"mfa_required", email_hint:"j***@..."}
  //   - Set-Cookie: /auth_pending=[^;]+; HttpOnly; Secure; SameSite=Strict; Max-Age=600/
  //   - auth_pending 값은 base64 AES-GCM ciphertext (decodePendingJar 로 복원 가능, 평문 username 문자열 검출 안 됨)
  //   - session cookie 미발급
  //   - DB user_tokens 변경 없음
});
```

#### Test 1-3: invalid_credentials → 401
```ts
it("given잘못된자격증명_when로그인POST_then401invalid_credentials", async () => {
  // Given: MSW submitCredentials → {kind:"invalid"}
  // When: POST /api/auth/login
  // Then: status 401, body === {code:"invalid_credentials"}, DB 무변화, 쿠키 없음
});
```

#### Test 1-4: Riot 5xx → 502 riot_unavailable
```ts
it("givenRiot5xx_when로그인POST_then502riot_unavailable", async () => {
  // Given: MSW submitCredentials → {kind:"upstream"}
  // When: POST /api/auth/login
  // Then: status 502, body === {code:"riot_unavailable"}
});
```

#### Test 1-5: DB 장애 graceful (Availability)
```ts
it("givenDBupsert실패_when로그인POST_then500unknown_앱crash없음", async () => {
  // Given: createSession 내부 supabase 에러 throw (mock)
  // When: POST /api/auth/login
  // Then: status 500, body === {code:"unknown"}, 서버 예외 stack 응답 body 미노출
});
```

### 구현 항목

**파일**: `app/api/auth/login/route.ts`
- `export async function POST(req: Request)`:
  1. `withOrigin(req)` → 403 early return 시 종결
  2. `withRateLimit(req, {path:"login", limit:5, windowSec:60})` → 429 early return 시 종결
  3. `const {username, password} = await req.json()` — 이후 password 는 이 스코프 밖 전파 금지
  4. `const jar = createJar()`; `await initAuthFlow(jar)`
  5. `const r = await submitCredentials(jar, {username, password})`
  6. switch (r.kind):
     - `"ok"`: `fetchPuuid` → `exchangeEntitlements` → `createSession(puuid, tokens)` → Set-Cookie session + `{ok:true}`
     - `"mfa"`: `encodePendingJar(jar, username)` → Set-Cookie auth_pending + `{status:"mfa_required", email_hint: r.emailHint}`
     - `"invalid"`: 401 `{code:"invalid_credentials"}`
     - `"rate_limited"`: 429 `{code:"rate_limited"}`
     - `"upstream"`: 502 `{code:"riot_unavailable"}`
  7. try/catch 래핑. unknown throw → 500 `{code:"unknown"}` + `logger.error("auth.login.unexpected", {err: err.message})`
- `export function GET/PUT/DELETE` → 405 (method guard)

---

## Phase 2: MFA route (`POST /api/auth/mfa`)

### 테스트 시나리오

#### Test 2-1: MFA happy path
```ts
it("given유효auth_pending과올바른코드_whenMFAPOST_thensession발급_DB행생성", async () => {
  // Given:
  //   - Phase 1 의 Test 1-2 끝난 상태에서 auth_pending cookie 보유
  //   - MSW submitMfa → {kind:"ok", accessToken}, userinfo/entitlements 200
  // When: POST /api/auth/mfa body {"code":"123456"}, Cookie: auth_pending=...
  // Then:
  //   - status 200, body === {ok:true}
  //   - Set-Cookie 두 개: session=<new>; Lax, auth_pending=; Max-Age=0 (clear)
  //   - DB user_tokens 1 row
  //   - 완료 시간 ≤ 2000ms (NFR Performance)
});
```

#### Test 2-2: auth_pending 없음 → mfa_expired
```ts
it("givenauth_pending쿠키없음_whenMFAPOST_then400mfa_expired", async () => {
  // When: POST /api/auth/mfa body {"code":"123456"}, Cookie 없음
  // Then: status 400, body === {code:"mfa_expired"}
});
```

#### Test 2-3: auth_pending 복호화 실패 (위조/만료) → mfa_expired
```ts
it("given위조auth_pending_whenMFAPOST_then400mfa_expired", async () => {
  // Given: auth_pending=garbage
  // When: POST /api/auth/mfa
  // Then: decodePendingJar → null → 400 {code:"mfa_expired"}
});
```

#### Test 2-4: 잘못된 code → mfa_invalid
```ts
it("given잘못된MFA코드_whenMFAPOST_then401mfa_invalid", async () => {
  // Given: MSW submitMfa → {kind:"invalid"}
  // When: POST /api/auth/mfa
  // Then: status 401, body === {code:"mfa_invalid"}
  //       auth_pending cookie 는 유지 (재시도 가능)
});
```

### 구현 항목

**파일**: `app/api/auth/mfa/route.ts`
- POST:
  1. Origin + rate-limit (limit=10, window=60s)
  2. `const {code} = await req.json()`
  3. `const blob = req.cookies.get("auth_pending")?.value` → 없으면 400 `{code:"mfa_expired"}`
  4. `const decoded = decodePendingJar(blob)` → null 이면 400 `{code:"mfa_expired"}`
  5. `await submitMfa(decoded.jar, code)` → switch:
     - `"ok"`: fetchPuuid/exchangeEntitlements/createSession → session set + auth_pending clear + `{ok:true}`
     - `"invalid"`: 401 `{code:"mfa_invalid"}`
     - `"rate_limited"`: 429 `{code:"rate_limited"}`
     - `"upstream"`: 502 `{code:"riot_unavailable"}`

---

## Phase 3: Logout route (`DELETE /api/auth/logout`)

### 테스트 시나리오

#### Test 3-1: 세션 보유 상태 logout
```ts
it("given유효session쿠키_whenDELETE_logout_thenDB삭제와쿠키clear", async () => {
  // Given: createSession 으로 row 생성 + session cookie
  // When: DELETE /api/auth/logout
  // Then:
  //   - status 200, body === {ok:true}
  //   - Set-Cookie: session=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/
  //   - SELECT count(*) FROM user_tokens WHERE session_id=$1 → 0
});
```

#### Test 3-2: 세션 없음 멱등
```ts
it("givensession쿠키없음_whenDELETE_logout_then200멱등_파기헤더유지", async () => {
  // When: DELETE /api/auth/logout (Cookie 없음)
  // Then: status 200, body === {ok:true}, Set-Cookie session=;Max-Age=0
});
```

### 구현 항목

**파일**: `app/api/auth/logout/route.ts` (기존 Plan 0005 구현 교체)
- `export async function DELETE(req: Request)`:
  1. Origin 검증 (rate-limit 은 logout 에 불필요 — 스펙에 명시 없음, 생략)
  2. `const sessionId = req.cookies.get("session")?.value`
  3. `if (sessionId) await destroy(sessionId)` — 실패는 catch/log (멱등 유지)
  4. Set-Cookie session=; Max-Age=0 + `{ok:true}`
- 기존 Plan 0005 의 POST / `token-store-registry` 경로는 **삭제**. spec § 4-1 의 DELETE 단일 진입점으로 정리.

---

## Phase 4: Rate-limit 미들웨어

### 테스트 시나리오

#### Test 4-1: 6회 연속 login → 6번째 429
```ts
it("given동일IP_when로그인6회연속_then6번째만429rate_limited", async () => {
  // Given: MSW submitCredentials 항상 {kind:"invalid"} (쉽게 실패)
  //        rate_limit_buckets 빈 상태
  // When: 같은 x-forwarded-for 로 6회 POST /api/auth/login
  // Then:
  //   - 1~5번: status 401 {code:"invalid_credentials"}
  //   - 6번째: status 429, body === {code:"rate_limited", retry_after: <int 1..60>}
  //   - rate_limit_buckets 에 bucket_key="login:1.2.3.4", count=6 row 존재
});
```

#### Test 4-2: window 초과 시 카운터 리셋
```ts
it("given분경계넘김_when로그인_then429해제", async () => {
  // Given: count=5, window_start=now-61s row 사전 주입
  // When: POST /api/auth/login (동일 IP)
  // Then: 요청 통과 (401/200 등 정상 응답), row 의 window_start reset, count=1
});
```

#### Test 4-3: 서로 다른 IP 는 독립
```ts
it("given다른IP_when각각로그인5회_then둘다통과", async () => {
  // Given: IP A 5회, IP B 5회
  // Then: 전부 통과, buckets 2개
});
```

### 구현 항목

**파일**: `lib/middleware/rate-limit.ts`
- `export async function withRateLimit(req: Request, opts: {path:string; limit:number; windowSec:number}): Promise<Response | null>`:
  - `ip = extractIp(req)` (`x-forwarded-for` 첫 hop → `x-real-ip` → `"127.0.0.1"`)
  - `bucketKey = \`${opts.path}:${ip}\``
  - Supabase service_role 로 `rate_limit_buckets` upsert:
    - 기존 row 조회 → window_start 이 `windowSec` 전이면 `count=1, window_start=now` UPSERT
    - 아니면 `count = count+1` UPDATE
  - `count > limit` → `retry_after = windowSec - (now - window_start)` (최소 1) 반환, Response 429 `{code:"rate_limited", retry_after}`
  - 통과 시 `null` 반환 (handler 계속)
- `extractIp(req)` helper export (테스트 용).

**참고**: 단순 fixed-window. TOCTOU race 수용 (동시 5~7개 넘칠 가능성 — spec § 9 "last-write-wins 수용" 정신).

---

## Phase 5: Origin 검증 미들웨어 + Security smoke

### 테스트 시나리오

#### Test 5-1: Origin 불일치 → 403 + PW 누수 없음
```ts
it("given다른Origin_when로그인POST_then403_응답로그에PW부재", async () => {
  // Given: APP_ORIGIN="https://valshop.vercel.app"
  //        captured logger output buffer
  // When: POST /api/auth/login headers {Origin:"https://evil.com"} body {"password":"SECRET_PW_SMOKE"}
  // Then:
  //   - status 403, body === {code:"unknown"}
  //   - 응답 텍스트에 "SECRET_PW_SMOKE" 미포함
  //   - 캡처된 logger 출력 전체 JSON 에 "SECRET_PW_SMOKE" 미포함
  //   - 캡처된 logger 출력에 "password" 키 미포함 (NFR Security)
});
```

#### Test 5-2: Origin 없음 → 403
```ts
it("givenOrigin헤더없음_when로그인POST_then403unknown", async () => {
  // Given: headers 에 Origin 없음 (same-origin fetch 외 환경)
  // When: POST /api/auth/login
  // Then: status 403, body === {code:"unknown"}
  // Note: 브라우저는 기본적으로 Origin 을 붙이므로 누락은 공격 의심으로 간주
});
```

### 구현 항목

**파일**: `lib/middleware/origin-check.ts`
- `export function withOrigin(req: Request): Response | null`:
  - `const origin = req.headers.get("origin")`
  - `origin === process.env.APP_ORIGIN` 이 아니면 `new Response(JSON.stringify({code:"unknown"}), {status:403})` 반환
  - 통과 시 null
- 환경변수 미설정 (undefined) 시에도 strict: 모든 요청 차단 (fail-closed).

---

## Phase 6: Operability (로거 통합 smoke)

### 테스트 시나리오

#### Test 6-1: 구조화 로그 스키마 검증
```ts
it("given로그인happy_when로그확인_thenauth_login_attempt와success이벤트", async () => {
  // Given: logger.info capture
  // When: 정상 로그인 1회
  // Then:
  //   - 최소 이벤트: "auth.login.attempt", "auth.login.success"
  //   - 각 payload 에 path/code/ip 키 존재, password/access_token/ssid 키 부재
  //   - console.log 호출 0회 (spyOn)
});
```

### 구현 항목

- Phase 1/2/3 route 구현에 `logger.info/warn/error` 삽입 지점:
  - `auth.login.attempt` / `.success` / `.error { code }`
  - `auth.mfa.attempt` / `.success` / `.error { code }`
  - `auth.logout.success`
- 본 plan 은 `lib/logger.ts` 를 **생성하지 않음** (plan 0024 소유). 테스트에서 `logger` 미구현 시 `vi.fn()` stub 으로 대체.

---

## 작업 종속성

### 종속성 그래프

```
Phase 4 (rate-limit) ──┐
                       ├─► Phase 1 (login) ──┐
Phase 5 (origin)    ──┘                       ├─► Phase 6 (logger smoke)
                                              │
                       ├─► Phase 2 (mfa)   ──┤
                       │                      │
                       └─► Phase 3 (logout)──┘
```

Phase 4/5 는 Phase 1~3 의 공통 의존. Phase 6 은 1~3 전부 완료 후 smoke.

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 4-1, 4-2, 4-3 테스트 + 5-1, 5-2 테스트 | plan 0018~0020 완료 | ✅ (다른 파일) |
| G2 | 4-impl (`rate-limit.ts`) + 5-impl (`origin-check.ts`) | G1 완료 | ✅ (다른 파일) |
| G3 | 1-1..1-5, 2-1..2-4, 3-1..3-2 테스트 스텁 | G2 완료 | ✅ (다른 route 파일) |
| G4 | 1-impl (`login/route.ts`), 2-impl (`mfa/route.ts`), 3-impl (`logout/route.ts`) | G3 완료 | ✅ (다른 파일, 공통 helper 만 참조) |
| G5 | 6-1 테스트 + 6-impl (로그 지점 삽입) | G4 완료 | - (1~3 route 파일 수정, 순차 안전) |

> 같은 파일을 수정하는 작업은 동일 그룹 또는 순차 그룹에 배치. G4 는 서로 다른 route 파일이라 병렬. G5 는 동일 route 파일 편집이라 G4 뒤 순차.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 4-1 | 테스트: 6회 연속 → 429 | ✅ 완료 | NFR Security |
| 4-2 | 테스트: window 리셋 | ✅ 완료 | |
| 4-3 | 테스트: IP 독립 | ✅ 완료 | |
| 4-impl | 구현: `lib/middleware/rate-limit.ts` | ✅ 완료 | |
| 5-1 | 테스트: Origin 불일치 403 + PW 누수 smoke | ✅ 완료 | NFR Security 핵심 |
| 5-2 | 테스트: Origin 없음 403 | ✅ 완료 | |
| 5-impl | 구현: `lib/middleware/origin-check.ts` | ✅ 완료 | fail-closed |
| 1-1 | 테스트: login 2FA-off happy + PW 누수 | ✅ 완료 | NFR Performance + Security |
| 1-2 | 테스트: login 2FA-on → auth_pending | ✅ 완료 | 암호화 검증 |
| 1-3 | 테스트: invalid_credentials | ✅ 완료 | |
| 1-4 | 테스트: Riot 5xx → 502 | ✅ 완료 | NFR Availability |
| 1-5 | 테스트: DB 장애 graceful | ✅ 완료 | NFR Availability |
| 1-impl | 구현: `app/api/auth/login/route.ts` | ✅ 완료 | |
| 2-1 | 테스트: MFA happy + ≤2s | ✅ 완료 | NFR Performance |
| 2-2 | 테스트: auth_pending 없음 → mfa_expired | ✅ 완료 | |
| 2-3 | 테스트: 위조 auth_pending → mfa_expired | ✅ 완료 | NFR Security |
| 2-4 | 테스트: 잘못된 code → mfa_invalid | ✅ 완료 | |
| 2-impl | 구현: `app/api/auth/mfa/route.ts` | ✅ 완료 | |
| 3-1 | 테스트: logout DB 삭제 + 쿠키 clear | ✅ 완료 | |
| 3-2 | 테스트: logout 멱등 | ✅ 완료 | |
| 3-impl | 구현: `app/api/auth/logout/route.ts` 교체 | ✅ 완료 | Plan 0005 POST 경로 삭제 |
| 6-1 | 테스트: 로그 스키마 + console.log 금지 | ✅ 완료 | NFR Operability |
| 6-impl | 구현: logger.info/warn/error 삽입 | ✅ 완료 | plan 0024 logger import |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨

**완료 요약**: 23/23 항목 완료 (100%)

---

## Amendment A (2026-04-24 저녁) — α′ env + AUTH_MODE 플래그

> spec § 11 amendment 반영. route handler 자체 로직은 변경 없음. 환경변수와 분기 플래그만 추가.

### A-1. 신규 env

| 키 | 용도 | 기본값/예시 |
|---|---|---|
| `RIOT_CLIENT_USER_AGENT` | auth-client 가 Riot 호출 시 사용. plan 0019 A-7 의 데스크톱 클라 사칭 문자열 | `RiotClient/60.0.6.4770705.4749685 rso-auth (Windows;10;;Professional, x64)` — 미설정 시 상수 기본값 |
| `AUTH_MODE` | `credentials` (기본, α′) / `manual-ssid` (α″ fallback) | `credentials` |

### A-2. AUTH_MODE 분기

- `AUTH_MODE === "manual-ssid"` 일 때:
  - `POST /api/auth/login` 과 `POST /api/auth/mfa` 는 410 `{code:"unknown"}` 반환 (엔드포인트 비활성).
  - 대신 신규 `POST /api/auth/ssid` 엔드포인트가 **활성**: body `{ssid, tdid?, region?}` 을 받아 plan 0019 의 `reauthWithSsid()` 로 바로 진입 → access/entitlements 발급 → `createSession` → session cookie 발급. 이건 개발 편의용 (본인 시연 배포 경로).
  - `/api/auth/ssid` 는 Origin 검증 + rate-limit 동일 적용. PW 경로와 달리 ssid 가 본인 인증의 유일한 입력.
- `AUTH_MODE === "credentials"` (기본) 일 때: 본 plan 의 기존 login/mfa 경로만 활성. `/api/auth/ssid` 는 404.

### A-3. 테스트 추가

- Feature: `AUTH_MODE=manual-ssid` 일 때 `/api/auth/login` 이 410 반환.
- Feature: `AUTH_MODE=manual-ssid` 일 때 `/api/auth/ssid` happy path 로 session 생성.
- Feature: `AUTH_MODE=credentials` (기본) 일 때 `/api/auth/ssid` 가 404.

### A-4. 응답 스키마

변경 없음. UI(plan 0022) 는 본 plan 의 응답 JSON 만 소비 → α′/α″ 전환 시 UI 는 로그인 버튼 라벨만 분기(“이메일/비밀번호 로그인” vs “ssid 직접 입력”). 이 분기는 plan 0022 Amendment 에서 처리 예정 (현재 `NEXT_PUBLIC_AUTH_MODE` 동일 env 를 UI 가 참조).
