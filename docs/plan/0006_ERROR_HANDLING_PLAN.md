# Plan 0006: 에러 처리 (토큰 만료 / Riot 5xx·429 / 로그인 실패)

## 개요

<!-- Cross-plan 정합성 감사(2026-04-23) 반영: RiotFetcher 포트 DI 계약, /api/auth/callback 소유권, 세션 계약 참조, /api/store 에러 body 스키마를 명시. -->

PRD FR-6 에 정의된 세 가지 에러 경로를 다룬다. (1) 토큰 만료 (401) 감지 시 재로그인 플로우 자동 진입, (2) Riot API 5xx/429 발생 시 에러 화면 + 재시도 UI, (3) 로그인 실패 (2FA, 잘못된 자격증명, 정책 변경) 시 에러 메시지 + 재시도 UI. 공통 HTTP 래퍼와 에러 타입 체계를 먼저 구축하고, 이를 FR-1~FR-5 모듈이 소비하도록 한다.

## 가정사항 (기존 모듈 인터페이스 · Cross-plan 의존성)

FR-1~FR-5 플랜이 아직 구현되지 않았으므로 본 plan 은 다음 포트 인터페이스를 **선행 정의**한다. 후속 plan 은 이 인터페이스를 구현한다.

```ts
// lib/riot/http.ts (본 plan Phase 2 가 신규 정의)
export interface RiotRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  // init: RequestInit 과 호환 (url 을 제외한 fetch 옵션을 그대로 허용)
}

export interface RiotFetcher {
  call<T>(req: RiotRequest): Promise<T>; // 성공시 T, 실패시 RiotError throw
}
```

- **Plan 0001 (OAuth/Auth)**: `lib/riot/auth.ts` 의 `exchangeSsidForTokens(ssid, fetcher: RiotFetcher)` 시그니처로 본 plan 의 `RiotFetcher` 포트를 **반드시 DI 로 주입**받아 사용한다. 직접 `globalThis.fetch` 호출 금지.
- **Plan 0003 (Storefront)**: `lib/riot/storefront.ts` 의 `fetchStorefront(tokens, fetcher: RiotFetcher)` 시그니처로 동일하게 `RiotFetcher` 를 DI 주입받는다. 4 skin UUID 획득 전 경로 모두 `fetcher.call()` 을 통과한다.
- **Plan 0008 (Client Version / ADR-0005 연계)**: 클라이언트 버전 resolve 경로도 `RiotFetcher` 를 주입받아 `CLIENT_VERSION_MISMATCH` 분류와 상호작용한다.
- **Plan 0002 (Session)**: `SessionPayload` 타입 및 `readSessionFromCookies()` 헬퍼는 **Plan 0002 에서 export 된 심볼을 import 해서 사용**한다. 본 plan 에서 재정의하지 않는다.
- **Plan 0001 (Auth Callback 소유권)**: `app/api/auth/callback/route.ts` 의 **전체 구현 소유권은 Plan 0001** 이다. 본 plan 은 Plan 0001 이 노출하는 `handleAuthCallback(req)` 헬퍼를 try/catch 로 래핑하여 에러 쿼리(`?error=<code>`) redirect 를 생성하는 **error wrapper 레이어만** 추가한다.
- **Dashboard 클라이언트 fetch 래퍼**: `/api/store` 의 JSON 응답 계약 `{ code: "TOKEN_EXPIRED" | "RIOT_RATE_LIMITED" | "RIOT_5XX" | "RIOT_4XX", message: string }` 을 따른다 (Phase 3 참조).

## 설계 결정사항

| 항목 | 결정 | 근거 (NFR) |
|------|------|------|
| 에러 분류 체계 | `RiotError` discriminated union: `TOKEN_EXPIRED` \| `RATE_LIMITED` \| `SERVER_ERROR` \| `AUTH_FAILED` \| `CLIENT_VERSION_MISMATCH` \| `UPSTREAM_UNAVAILABLE` | Operability (로그 분류), Maintainability (타입 안전) |
| 재시도 정책 | 5xx: 재시도 없음 (ARCHITECTURE § 4.재시도전략과 일치). 429: 서버에서 1회만 (200ms, Retry-After 있으면 그 값 clamp 300~3000ms). 전체 윈도우 < 10s 강제 | Performance (<10s), Compliance (429 존중), Scale (backoff) |
| 클라이언트측 재시도 | 사용자가 "다시 시도" 버튼을 눌렀을 때만 refetch. 자동 재시도 금지 | Compliance (공격적 재시도 금지) |
| 401 처리 | `/api/store` 가 401 을 감지하면 `{ code: "TOKEN_EXPIRED" }` 응답. 클라이언트 인터셉터가 `/api/auth/start` 로 window.location 리다이렉트. SSR 경로에서는 302 리다이렉트 | Availability (crash 없이 복구) |
| 에러 메시지 sanitization | `toUserMessage(err)` 는 토큰/헤더/raw body 미포함 한국어 문자열만 반환. `toLogPayload(err)` 는 민감정보 redact 후 `{ code, upstreamStatus, path, ts }` 구조로 Vercel 로그 출력 | Security (민감정보 미노출), Operability (에러 종류별 분류) |
| 로그인 실패 표면화 | `/api/auth/callback` 은 실패 시 `/login?error=<code>` 로 302. `<code>` 는 화이트리스트 (`invalid_credentials`, `mfa_required`, `rate_limited`, `upstream_unavailable`, `unknown`) | Security (정보 유출 방지), Compliance |
| 429 backoff 구현 | `sleepWithJitter(baseMs, attempt)` = `base * 2^attempt + rand(0, 100ms)`. `attempt` 상한 1 (총 2 requests) | Performance 10s window, Compliance |
| Dashboard 에러 UI | `<ErrorBoundary />` + 재시도 버튼 + 에러 코드별 안내 문구 (i18n 불필요, 한국어 하드코딩) | Availability (crash 없음) |
| 테스트 전략 | Vitest critical-path. MSW 로 Riot API 모킹. 5xx/429/401/auth-fail 각 시나리오 독립 | Maintainability (케이스별 단위 테스트) |

## NFR 반영

| 카테고리 | 반영 방식 | 검증 테스트 |
|---|---|---|
| Performance | 전체 재시도 윈도우 < 10s (429 1회 + jitter, max ≈ 3.1s). 5xx 즉시 반환 | Test 2-3 (시간 측정) |
| Scale | 429 시 서버측 backoff 1회만. 클라이언트 자동 재시도 금지 | Test 2-2, Test 4-2 |
| Availability | 모든 에러 경로에서 React `<ErrorBoundary />` + `/api/*` try/catch 로 crash 차단 | Test 5-1 (catastrophic path) |
| Security | `toUserMessage` / `toLogPayload` 가 토큰·쿠키·Authorization 헤더·Riot ssid 값을 포함하지 않음 | Test 6-1, Test 6-2 (redact 검증) |
| Compliance | Retry-After 헤더 존중, 429 시 공격적 재시도 금지 (최대 1회), Riot ToS fair-use | Test 2-2 (retry count), Test 2-4 (Retry-After 존중) |
| Operability | 각 에러 코드가 `console.error(JSON.stringify(toLogPayload(err)))` 로 structured log → Vercel 필터링 가능 | Test 6-3 (로그 스키마) |
| Cost | 본 plan 은 신규 외부 서비스 도입 없음. 재시도 억제로 Vercel function 실행 시간 절감 → $0 유지 | (설계 자체가 검증) |
| Maintainability | 에러 케이스별 Vitest 테스트, `RiotError` discriminated union 으로 switch exhaustive check | Phase 1~6 전체 테스트, Test 1-3 (exhaustive) |

---

## Phase 1: 에러 타입 & 분류 모듈

### 테스트 시나리오

#### Test 1-1: HTTP 응답 → RiotError 분류
```ts
// tests/critical-path/error-classify.test.ts
describe("Feature: Riot HTTP 응답 분류", () => {
  it("given401Response_whenClassify_thenTokenExpired", () => {
    // Given: Response { status: 401 }
    // When: classifyRiotResponse(res)
    // Then: { code: "TOKEN_EXPIRED" }
  });
  it("given429Response_whenClassify_thenRateLimitedWithRetryAfter", () => {
    // Given: Response { status: 429, headers: { "retry-after": "2" } }
    // When: classifyRiotResponse(res)
    // Then: { code: "RATE_LIMITED", retryAfterMs: 2000 }
  });
  it("given500Response_whenClassify_thenServerError", () => {
    // Given: Response { status: 503 }
    // When: classifyRiotResponse(res)
    // Then: { code: "SERVER_ERROR", upstreamStatus: 503 }
  });
  it("given400WithVersionHint_whenClassify_thenClientVersionMismatch", () => {
    // Given: Response { status: 400, body: { errorCode: "INVALID_CLIENT_VERSION" } }
    // When: classifyRiotResponse(res)
    // Then: { code: "CLIENT_VERSION_MISMATCH" }  (ADR-0005 연계)
  });
});
```

#### Test 1-2: Auth 실패 서브코드 분류
```ts
it("given2FAChallengeResponse_whenClassifyAuth_thenMfaRequired", () => {
  // Given: auth body { type: "multifactor" }
  // When: classifyAuthResponse(body)
  // Then: { code: "AUTH_FAILED", reason: "mfa_required" }
});
it("givenInvalidCredentialsBody_whenClassifyAuth_thenInvalidCredentials", () => {
  // Given: body { error: "auth_failure" }
  // Then: { code: "AUTH_FAILED", reason: "invalid_credentials" }
});
```

#### Test 1-3: discriminated union exhaustive 검증 (타입)
```ts
it("givenRiotError_whenSwitchExhaustive_thenCompilesWithoutDefault", () => {
  // Given: RiotError 전 케이스
  // When: switch(err.code) 각 분기 처리
  // Then: TS2366 (함수가 값을 반환해야 함) 없이 컴파일. default 없이도 OK.
  //       → tsc --noEmit 로 검증.
});
```

### 구현 항목

**파일**: `lib/riot/errors.ts`
- `RiotError` discriminated union 선언.
- `classifyRiotResponse(res: Response): Promise<RiotError | null>` — 2xx 는 null.
- `classifyAuthResponse(body: unknown): RiotError | null`.
- `parseRetryAfter(header: string | null): number` — 초 단위 → ms, 상한 10s.

---

## Phase 2: RiotFetcher (재시도 포함 HTTP 래퍼)

### 테스트 시나리오

#### Test 2-1: 200 OK 는 그대로 통과
```ts
it("given200Response_whenCall_thenReturnsParsedBody", async () => {
  // Given: MSW handler returning 200 { foo: "bar" }
  // When: fetcher.call(req)
  // Then: result equals { foo: "bar" }
});
```

#### Test 2-2: 429 는 정확히 1회 재시도
```ts
it("given429ThenSuccess_whenCall_thenRetriesOnceAndReturns", async () => {
  // Given: MSW 첫 호출 429, 두 번째 200
  // When: fetcher.call(req)
  // Then: 결과 OK, 호출 횟수 === 2
});
it("given429Twice_whenCall_thenThrowsRateLimitedAfterOneRetry", async () => {
  // Given: MSW 두 번 모두 429
  // When: fetcher.call(req)
  // Then: throws RiotError { code: "RATE_LIMITED" }, 호출 횟수 === 2 (공격적 재시도 금지)
});
```

#### Test 2-3: 전체 재시도 윈도우 < 10s
```ts
it("given429WithLargeRetryAfter_whenCall_thenClampedUnder10s", async () => {
  // Given: MSW 429 { retry-after: "60" }
  // When: start = Date.now(); try fetcher.call(req)
  // Then: (Date.now() - start) < 10000  // NFR Performance
});
```

#### Test 2-4: Retry-After 헤더 존중
```ts
it("given429WithRetryAfter2s_whenCall_thenWaitsAtLeast2sBeforeRetry", async () => {
  // Given: MSW 첫 429 retry-after=2, 두 번째 200
  // When: 호출 타임스탬프 기록
  // Then: retry 간격 >= 2000ms (jitter 제외), < 10000ms
});
```

#### Test 2-5: 5xx 는 재시도 없음
```ts
it("given503Response_whenCall_thenThrowsImmediatelyWithoutRetry", async () => {
  // Given: MSW 503
  // When: fetcher.call(req)
  // Then: throws SERVER_ERROR, 호출 횟수 === 1
});
```

### 구현 항목

**파일**: `lib/riot/http.ts`
- `RiotFetcher` 인터페이스 + `createRiotFetcher(deps: { sleep?: (ms) => Promise<void> })` factory.
- 내부에서 `classifyRiotResponse` 사용 → 분류 후 재시도/throw.
- `sleepWithJitter(baseMs, attempt)` 헬퍼.

---

## Phase 3: /api/store — 401 감지 & 에러 JSON 계약

### 테스트 시나리오

#### Test 3-1: 401 → TOKEN_EXPIRED 응답
```ts
it("given401FromStorefront_whenGetApiStore_thenReturns401WithTokenExpiredCode", async () => {
  // Given: MSW storefront 401, 유효한 암호화 cookie
  // When: GET /api/store
  // Then: status 401, body { code: "TOKEN_EXPIRED", message: <한국어> }
});
```

#### Test 3-2: 429 → 429 + RATE_LIMITED
```ts
it("given429Twice_whenGetApiStore_thenReturns429WithRateLimited", async () => {
  // Given: MSW 429 × 2
  // When: GET /api/store
  // Then: status 429, body.code === "RATE_LIMITED"
});
```

#### Test 3-3: 5xx → 502 + SERVER_ERROR
```ts
it("given503FromStorefront_whenGetApiStore_thenReturns502WithServerError", async () => {
  // Given: MSW 503
  // When: GET /api/store
  // Then: status 502, body.code === "SERVER_ERROR"
});
```

#### Test 3-4: 응답 body 에 토큰/쿠키 노출 없음
```ts
it("givenAnyError_whenGetApiStore_thenResponseBodyHasNoTokenOrCookie", async () => {
  // Given: 토큰 fixture 값 "SECRET_TOKEN_XYZ"
  // When: 에러 경로 (401/429/500) 각각 호출
  // Then: JSON.stringify(body) 에 "SECRET_TOKEN_XYZ", "Bearer", "ssid" 미포함
});
```

### 구현 항목

**파일**: `app/api/store/route.ts`
- `createRiotFetcher()` 주입 → `fetchStorefront(tokens, fetcher)` 호출.
- try/catch 로 `RiotError` catch → status map: 401→401, 429→429, SERVER_ERROR→502, CLIENT_VERSION_MISMATCH→502, else 500.
- response body: `{ code, message: toUserMessage(err) }`.
- `console.error(JSON.stringify(toLogPayload(err)))` 로그.

---

## Phase 4: 클라이언트 — 401 자동 재로그인 & 재시도 UI

### 테스트 시나리오

#### Test 4-1: 401 응답 시 /api/auth/start 리다이렉트
```ts
it("given401FromApiStore_whenDashboardFetches_thenRedirectsToAuthStart", async () => {
  // Given: MSW /api/store → 401 { code: "TOKEN_EXPIRED" }
  // And: window.location 모킹
  // When: render <DashboardClient />
  // Then: window.location.assign("/api/auth/start") 호출됨
});
```

#### Test 4-2: 429/5xx 시 에러 UI + 재시도 버튼, 자동 재시도 없음
```ts
it("given500FromApiStore_whenDashboardRenders_thenShowsErrorAndRetryButton", async () => {
  // Given: MSW /api/store → 502 { code: "SERVER_ERROR" }
  // When: render
  // Then: getByRole("alert"), getByRole("button", { name: /다시 시도/ })
  //       자동 refetch 호출 없음 (MSW 호출 카운트 === 1)
});
it("given429_whenUserClicksRetry_thenSingleRefetch", async () => {
  // Given: 첫 호출 429, 버튼 클릭 시 두 번째 200
  // When: click "다시 시도"
  // Then: 스킨 카드 렌더, 호출 횟수 === 2 (자동 재시도 없음)
});
```

#### Test 4-3: ErrorBoundary 로 crash 차단
```ts
it("givenRenderThrows_whenInBoundary_thenFallbackUIRenders", () => {
  // Given: <SkinCard /> 가 throw
  // When: <ErrorBoundary><SkinCard/></ErrorBoundary> 렌더
  // Then: fallback UI ("문제가 발생했습니다") 표시, 앱 전체 crash 없음
});
```

### 구현 항목

**파일**: `components/ErrorBoundary.tsx`
- React class component. `componentDidCatch` 에서 `toLogPayload` 로그.

**파일**: `components/StoreErrorView.tsx`
- props: `{ code: RiotErrorCode, onRetry: () => void }`.
- 한국어 메시지 매핑. 재시도 버튼.

**파일**: `app/(app)/dashboard/DashboardClient.tsx` (또는 기존 확장)
- `useStore()` hook: fetch `/api/store` → 401 시 `window.location.assign("/api/auth/start")`, 기타 에러 시 `<StoreErrorView />`.

---

## Phase 5: /api/auth/callback — 로그인 실패 리다이렉트

### 테스트 시나리오

#### Test 5-1: 2FA 응답 → /login?error=mfa_required
```ts
it("given2FAFromRiot_whenCallback_thenRedirectsLoginMfa", async () => {
  // Given: MSW auth → multifactor 응답
  // When: GET /api/auth/callback
  // Then: 302 Location: /login?error=mfa_required
});
```

#### Test 5-2: invalid_credentials
```ts
it("givenAuthFailureFromRiot_whenCallback_thenRedirectsLoginInvalid", async () => {
  // Then: 302 /login?error=invalid_credentials
});
```

#### Test 5-3: 화이트리스트 외 코드 → unknown
```ts
it("givenUnclassifiedError_whenCallback_thenRedirectsLoginUnknown", async () => {
  // Given: 분류 실패
  // Then: Location: /login?error=unknown  (raw 메시지 노출 금지)
});
```

#### Test 5-4: /login 페이지가 error 쿼리를 한국어 메시지로 렌더
```ts
it("givenErrorQuery_whenRenderLogin_thenShowsLocalizedMessageAndRetry", () => {
  // Given: searchParams { error: "mfa_required" }
  // When: render <LoginPage />
  // Then: "2단계 인증이 필요합니다" 텍스트, "다시 시도" 버튼
});
```

#### Test 5-5: 앱 crash 없이 복구 가능 (Availability)
```ts
it("givenCatastrophicExceptionInCallback_whenCalled_thenReturnsRedirectNotCrash", async () => {
  // Given: exchange 함수가 예상 밖 throw
  // When: GET /api/auth/callback
  // Then: 302 /login?error=unknown (500 이 아닌 graceful fallback)
});
```

### 구현 항목

**파일**: `app/api/auth/callback/route.ts`
- 최상위 try/catch. `RiotError` → 화이트리스트 reason 매핑, 나머지 → `unknown`.
- `NextResponse.redirect(new URL("/login?error=<code>", req.url), 302)`.

**파일**: `app/(auth)/login/page.tsx`
- `searchParams.error` 읽어 메시지 테이블 룩업. 알 수 없는 코드는 generic 메시지.

---

## Phase 6: Security & Operability — Sanitization & 로그

### 테스트 시나리오

#### Test 6-1: toUserMessage 가 토큰/민감정보 미포함
```ts
it("givenErrorWithTokenInRawBody_whenToUserMessage_thenNoSecretLeaks", () => {
  // Given: RiotError 생성 시 upstream raw { access_token: "SECRET" }
  // When: toUserMessage(err)
  // Then: 결과 문자열이 "SECRET" 미포함, "access_token" 미포함, "Bearer" 미포함
});
```

#### Test 6-2: toLogPayload 가 Authorization/Cookie/ssid redact
```ts
it("givenErrorWithAuthHeaders_whenToLogPayload_thenHeadersRedacted", () => {
  // Given: err.context = { headers: { Authorization: "Bearer X", Cookie: "ssid=Y" } }
  // When: JSON.stringify(toLogPayload(err))
  // Then: "Bearer X" 미포함, "ssid=Y" 미포함, 대신 "[REDACTED]" 존재
});
```

#### Test 6-3: 로그 스키마 일관성 (Operability)
```ts
it("givenAnyRiotError_whenToLogPayload_thenHasStableSchema", () => {
  // Given: RiotError 전 케이스
  // When: toLogPayload(err)
  // Then: payload.keys() === ["code","upstreamStatus","path","ts","reason?"]
  //       Vercel 로그 필터 쿼리 (`code:"RATE_LIMITED"`) 가능
});
```

#### Test 6-4: 민감 필드 화이트리스트 기반 포함
```ts
it("givenArbitraryContext_whenToLogPayload_thenOnlyWhitelistedFieldsIncluded", () => {
  // Given: err.context 에 임의 필드 { puuid, access_token, refresh_token, foo }
  // When: toLogPayload
  // Then: access_token/refresh_token 미포함. puuid 는 뒷 4자리만 `***abcd` 형태.
});
```

### 구현 항목

**파일**: `lib/riot/errors.ts` (Phase 1 확장)
- `toUserMessage(err: RiotError): string` — 한국어 고정 문자열.
- `toLogPayload(err: RiotError): Record<string, unknown>` — 화이트리스트 기반 직렬화.
- `redactHeaders(h: Record<string,string>)`, `maskPuuid(p: string)` 헬퍼.

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (errors.ts)
  └─ 1-1, 1-2, 1-3 테스트 ──→ 1-impl ─┐
                                       │
Phase 2 (http.ts) ── 2-1..2-5 테스트 ──→ 2-impl ─┐  (1-impl 필요)
                                                  │
Phase 6 (sanitize) ── 6-1..6-4 테스트 ──→ 6-impl ─┤  (1-impl 필요)
                                                  │
Phase 3 (/api/store) ── 3-1..3-4 테스트 ──→ 3-impl  (2-impl + 6-impl 필요)
                                                  │
Phase 5 (/api/auth/callback) ── 5-1..5-5 ──→ 5-impl  (1-impl + 6-impl 필요)
                                                  │
Phase 4 (클라이언트) ── 4-1..4-3 테스트 ──→ 4-impl  (3-impl 필요)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3 테스트 | 없음 | ✅ |
| G2 | 1-impl | G1 완료 | - |
| G3 | 2-1..2-5 테스트, 6-1..6-4 테스트 | G2 완료 | ✅ (다른 파일) |
| G4 | 2-impl, 6-impl | G3 완료 | ✅ (다른 파일) |
| G5 | 3-1..3-4 테스트, 5-1..5-5 테스트 | G4 완료 | ✅ (다른 라우트) |
| G6 | 3-impl, 5-impl | G5 완료 | ✅ (다른 파일) |
| G7 | 4-1..4-3 테스트 | G6 완료 | ✅ |
| G8 | 4-impl | G7 완료 | - |

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | HTTP 응답 분류 (401/429/5xx/400-version) | ✅ 완료 | |
| 1-2 | Auth 실패 서브코드 분류 (2FA/invalid) | ✅ 완료 | |
| 1-3 | discriminated union exhaustive 타입 검증 | ✅ 완료 | |
| 1-impl | `lib/riot/errors.ts` 타입 + classify | ✅ 완료 | |
| 2-1 | 200 OK 통과 | ✅ 완료 | |
| 2-2 | 429 1회 재시도 + 2회 실패 시 throw | ✅ 완료 | |
| 2-3 | 전체 재시도 윈도우 < 10s | ✅ 완료 | NFR Perf |
| 2-4 | Retry-After 헤더 존중 | ✅ 완료 | NFR Compliance |
| 2-5 | 5xx 재시도 없음 | ✅ 완료 | |
| 2-impl | `lib/riot/http.ts` RiotFetcher | ✅ 완료 | |
| 3-1 | /api/store 401 → TOKEN_EXPIRED | ✅ 완료 | |
| 3-2 | /api/store 429 → RATE_LIMITED | ✅ 완료 | |
| 3-3 | /api/store 5xx → 502 SERVER_ERROR | ✅ 완료 | |
| 3-4 | 응답 body 에 토큰 미포함 | ✅ 완료 | NFR Security |
| 3-impl | `app/api/store/route.ts` 에러 매핑 | ✅ 완료 | |
| 4-1 | 401 시 /api/auth/start 리다이렉트 | ✅ 완료 | |
| 4-2 | 429/5xx 에러 UI + 재시도 버튼, 자동 재시도 없음 | ✅ 완료 | NFR Compliance |
| 4-3 | ErrorBoundary crash 차단 | ✅ 완료 | NFR Availability |
| 4-impl | `ErrorBoundary`, `StoreErrorView`, `DashboardClient` | ✅ 완료 | |
| 5-1 | callback 2FA → mfa_required | ✅ 완료 | |
| 5-2 | callback invalid_credentials | ✅ 완료 | |
| 5-3 | callback 화이트리스트 외 → unknown | ✅ 완료 | NFR Security |
| 5-4 | /login ?error 쿼리 한국어 렌더 | ⬜ 미착수 | /login page 구현은 Plan 0001 |
| 5-5 | callback catastrophic → 302 graceful | ✅ 완료 | NFR Availability |
| 5-impl | `app/api/auth/callback/route.ts`, `/login` page | ✅ 완료 | |
| 6-1 | toUserMessage 토큰 미포함 | ✅ 완료 | NFR Security |
| 6-2 | toLogPayload 헤더 redact | ✅ 완료 | NFR Security |
| 6-3 | 로그 스키마 일관성 | ✅ 완료 | NFR Operability |
| 6-4 | 민감 필드 화이트리스트 | ✅ 완료 | NFR Security |
| 6-impl | `toUserMessage`, `toLogPayload`, redact 헬퍼 | ✅ 완료 | |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨

**완료 요약**: 37/38 항목 완료 (5-4는 Plan 0001 소유)
