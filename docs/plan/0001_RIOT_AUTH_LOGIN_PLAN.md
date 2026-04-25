# Plan 0001: Riot 비공식 auth flow 로그인

## 개요

PRD FR-1 구현. 유저가 `auth.riotgames.com` 과 브라우저에서 직접 인증한 뒤, ssid cookie 를 앱 서버에 제출하면 서버가 Riot 에 재호출하여 `access_token` + `entitlements_token` + `PUUID` 를 취득한다. 비밀번호는 앱 서버를 절대 경유하지 않는다. 취득한 토큰은 AES-GCM 으로 암호화되어 httpOnly + SameSite=Lax + Secure cookie 로 세션 유지된다 (ADR-0002). 범위: 로그인 시작(`/api/auth/start`) → Riot 인증 → 콜백 수신(`/api/auth/callback`) → 토큰 교환 → 암호화 쿠키 설정 → `/dashboard` 리다이렉트. KR 리전 한정.

<!-- Cross-plan 정합성 감사(2026-04-23) 결과 반영: 세션/토큰/crypto 계약의 단일 소스는 Plan 0002. 본 Plan 은 소비자로 전환. -->


FR-2 (자동 로그인), FR-5 (로그아웃), FR-3~6 (상점 조회/에러) 은 별도 Plan 에서 다루며, 본 Plan 은 **로그인 성공 경로와 로그인 단계 에러 처리** 까지만 담는다 (토큰 만료 감지·재로그인 트리거는 인접 feature 에 위임, 단 본 plan 의 `/api/auth/start` 엔드포인트는 그 트리거가 쓰는 진입점을 겸한다).

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| Auth flow 종류 | Riot 비공식 ssid cookie 교환 (C-RSO 미사용) | ADR-0001, PRD § 7 C-RSO 제약. Compliance (fan-made 고지) |
| 리전 | `auth.riotgames.com` + `pd.kr.a.pvp.net` 고정, 리전 셀렉터 없음 | PRD § 7 제약 (KR 한정). Maintainability |
| 비밀번호 흐름 | 브라우저 → Riot 직통, 앱 서버 비경유 | Security (PW 서버 미저장), PRD FR-1 |
| 토큰 교환 위치 | 앱 서버 Route Handler (`/api/auth/callback`) 에서만 | Security (ssid cookie 는 서버가 받아 즉시 Riot 재요청, 클라이언트에 절대 노출 금지) |
| Riot 토큰 엔드포인트 | `POST auth.riotgames.com/api/v1/authorization` (쿠키 제출 → access_token), `POST entitlements.auth.riotgames.com/api/token/v1` (access_token → entitlements JWT), `GET auth.riotgames.com/userinfo` (PUUID) | ADR-0001. 커뮤니티 확립 경로 |
| 세션 저장 | AES-GCM 암호화 payload 를 단일 httpOnly + SameSite=Lax + Secure cookie (`session`) 로 | ADR-0002, Security (PW 서버 미저장/토큰 AES 암호화), HTTPS only |
| 암호화 알고리즘 | Web Crypto API `AES-GCM` 256-bit, IV 12바이트 랜덤, ciphertext 에 IV prepend | ADR-0002, Security, Cost (외부 의존 0) |
| 암호화 키 관리 | `TOKEN_ENC_KEY` Vercel Project Env (base64 32바이트), 서버 전용 | Security, Operability |
| CSRF 대책 | 로그인 시작 시 서버가 state 난수 발급 → 짧은 httpOnly cookie (`auth_state`, 10분 TTL) 로 저장, 콜백에서 일치 검증 | Security, Compliance |
| Client version 헤더 | MVP 본 Plan 범위 외(Store 에서 사용). 로그인 단계는 Riot auth 엔드포인트 자체가 clientVersion 불필요 | ADR-0005 범위 분리. Maintainability |
| 에러 UX | 콜백 실패 시 `/login?error=<code>` 302 + 로그인 페이지 배너 | PRD FR-6 부분 충족 (로그인 실패 시 메시지 + 재시도 UI). Performance (에러 페이지 자체도 SSR 고속) |
| 테스트 스택 | Vitest + MSW + next-test-api-route-handler, E2E 는 Playwright 스모크 1개 | ADR-0006, Maintainability (critical path 필수) |
| 네트워크 격리 | critical-path 테스트는 `fetch` 를 생성자 주입 또는 MSW 인터셉트로 대체, 실제 Riot 호출 금지 | ADR-0006 포트-어댑터, Maintainability |
| 로깅 | Vercel 기본 function log. 토큰/쿠키 값은 **절대 로그에 출력 금지**, 에러 코드만 | Operability, Security |
| 의존성 추가 | 신규 런타임 의존 0 (Next 내장 `fetch`, Web Crypto). 개발 의존: vitest, msw, @playwright/test, next-test-api-route-handler | Cost ($0 유지), Maintainability |

## 가정사항

- ADR-0001 에 명시된 비공식 auth flow 의 엔드포인트·payload 스키마가 본 Plan 작성 시점에 유효하다. 차단·스키마 변경은 Consequences 수용 리스크.
- `TOKEN_ENC_KEY` 는 로컬 `.env.local` 과 Vercel Project Env 에 수동 설정된다 (별도 KMS 없음).
- `auth.riotgames.com` 이 반환하는 ssid cookie 는 브라우저가 302 리다이렉트 체인에서 `Set-Cookie` 로 저장한 뒤, 콜백 URL 이 동일 오리진이 아니므로 **ssid 를 URL fragment 형태의 `access_token` 으로 받는 implicit grant 변형** 을 사용한다 (커뮤니티 표준 패턴). 본 Plan 에서는 "access token을 포함한 redirect URI → 콜백이 access_token 을 수신" 시나리오로 구현한다.
- 로그인 성공 후 리다이렉트 목적지는 고정 `/dashboard`. 딥링크 복귀는 범위 외.
- 다중 디바이스 동시 로그인·세션 무효화 (server-side revocation) 는 범위 외. 로그아웃은 cookie 삭제로만 수행 (FR-5 별도 Plan).
- `redirect_uri` 는 환경변수 `RIOT_AUTH_REDIRECT_URI` (운영: `https://<vercel-domain>/api/auth/callback`, 개발: `http://localhost:3000/api/auth/callback`) 로 주입된다. Riot 측 redirect_uri 허용은 커뮤니티 공개 클라이언트 (`riot-client`) 값을 사용하는 관례를 따른다.
- PIPA 관점에서 로그인 단계에서 수집/저장하는 PII 는 PUUID 뿐 (이름/이메일은 서버 미저장). 별도 동의 화면은 본 Plan 에서 다루지 않고 `/privacy` 페이지 (별도 Plan) 에 위임.
- **Cross-plan 계약 (2026-04-23 감사 반영):**
  - **Crypto 모듈 소유권**: `lib/crypto/aes-gcm.ts` 와 `encryptSession` / `decryptSession` 함수는 **Plan 0002 가 소유**. 본 Plan 은 소비자로 import 만 한다. 본 Plan 은 해당 파일을 생성/수정하지 않는다.
  - **SessionPayload 타입 소유권**: `SessionPayload = { puuid: string; accessToken: string; refreshToken: string; entitlementsJwt: string; expiresAt: number; region: string }` 은 **Plan 0002 의 `lib/session/types.ts`** 가 소유. 본 Plan 은 import 만 한다.
  - **Cookie 직렬화 소유권**: 세션 쿠키 빌더 `buildSessionCookie(payload)` 는 **Plan 0002 소유**. Max-Age 는 고정값이 아니라 `expiresAt - now` 기반 동적 계산. 본 Plan 은 호출만 한다.
  - **Callback 에러 래퍼**: `app/api/auth/callback/route.ts` 는 본 Plan 이 소유하되, 최상위 try/catch 래퍼(로그 마스킹·에러 코드 매핑 일부)는 **Plan 0006 이 주입**. 본 Plan 은 `handleAuthCallback(input): Promise<Response>` 헬퍼를 export 하여 0006 이 래핑 가능하도록 계약을 노출한다.
  - **Riot 외부 fetch**: `lib/riot/auth.ts` 의 외부 HTTP 호출은 **Plan 0006 의 `RiotFetcher` 포트** 를 DI 받는 형태로 변경. 기본값 `fetch` 직접 참조 금지, 호출부가 `RiotFetcher` 구현체를 전달.

## NFR 반영

| 카테고리 | 반영 내용 | 측정/테스트 |
|---|---|---|
| Performance | `/api/auth/callback` 은 Riot 에 최대 3회 직렬 호출 (authorization → entitlements → userinfo). 각 호출 타임아웃 3s, 전체 콜백 응답 p95 ≤ 1s 목표. 불필요한 fetch 제거, 응답은 302 (본문 없음) → TTI ≤ 3s 대시보드 도달 예산에 기여 | Test 2-4 (콜백 성공 시 302 + p95 측정은 Playwright 스모크에서 수동 관찰, 로컬 모킹 환경) |
| Scale | ~50 concurrent 수용. Route Handler 는 Vercel Serverless 인스턴스당 독립. 공유 상태는 `auth_state` cookie (클라이언트 보관) 로 서버 메모리 미점유. 성능 스트레스 테스트는 본 Plan 범위 외 (단일 유저 정합성만 검증) | Test 2-3 병렬 호출 독립성 검증 |
| Availability | 99% best-effort. Riot 5xx/타임아웃 시 `/login?error=upstream` 으로 302, 사용자 재시도 경로 확보. 자체 상태를 남기지 않아 장애 후 재시작 시 부작용 0 | Test 2-5 (Riot 5xx → 에러 리다이렉트), Test 2-6 (타임아웃) |
| Security | (a) PW 서버 미경유 — 브라우저 직통, (b) ssid/access_token 은 콜백 수신 즉시 Riot 토큰으로 교환 후 원본 폐기, (c) 최종 토큰은 AES-GCM 256 암호화, (d) cookie 는 httpOnly + SameSite=Lax + Secure, (e) state 난수 검증으로 CSRF 방지, (f) 로그에 토큰/쿠키 평문 금지 | Test 1-1~1-3 (AES 왕복·IV 유일성), Test 2-1 (state 불일치 거부), Test 2-2 (cookie 속성 검증), Test 2-7 (로그 평문 부재) |
| Compliance | Riot ToS "fan-made" 고지는 전역 Footer (별도 Plan). 본 Plan 은 **PW 서버 미저장/PIPA 최소수집** 으로 준수. 저장 PII = PUUID 만. PUUID 외 Riot 응답 필드는 즉시 파기 | Test 2-8 (userinfo 응답에서 PUUID 만 추출·저장, 나머지 필드 콜백 응답·로그 미반영) |
| Operability | Vercel function log 에 요청 ID·에러 코드만. 인스턴트 롤백은 Vercel 기본. `.env.example` 에 `TOKEN_ENC_KEY`, `RIOT_AUTH_REDIRECT_URI` 키명 공개 | 수동 점검 (plan 완료 후 `.env.example` 존재 확인) — Test 항목 아님 (인프라 설정) |
| Cost | 신규 런타임 의존 0, 외부 유료 서비스 0. Web Crypto·Next fetch 만 사용. Vercel Hobby 범위 내 | N/A — 측정 불필요, 의존 추가 금지로 달성 |
| Maintainability | Vitest critical-path 테스트로 auth 플로우 전체 커버 (Phase 1 crypto, Phase 2 callback). 포트-어댑터 패턴으로 `fetch`·cookie 모듈 주입 가능. README 에 로컬 실행·env 설정 섹션 추가 (별도 Plan 과 겸용) | Test 1-1~1-3, 2-1~2-8 전부가 critical path. `npm test` 로 1 클릭 실행 |

주: 본 Plan 은 로그인 경로 단일 요구사항이라 "Scale/Availability/Operability" 는 주로 구조적 준수 (무상태, fail-fast, 로그 최소) 로 달성되며, 정량 측정은 별도 대시보드/스모크 E2E 에서 통합 확인.

---

## Phase 1: Crypto Module (Plan 0002 소유 — 본 Plan 은 소비자)

> **Cross-plan 계약 (2026-04-23 감사 반영)**: `lib/crypto/aes-gcm.ts` 와 `encryptSession` / `decryptSession`, 그리고 `SessionPayload` 타입(`lib/session/types.ts`), 세션 쿠키 빌더(`buildSessionCookie`) 는 **Plan 0002 가 단일 소스로 소유** 한다. 본 Plan 은 테스트도 구현도 하지 않고 import 만 수행한다. 아래는 소비 계약 명세.

### 소비 계약

- `import { encryptSession, decryptSession } from "@/lib/crypto/aes-gcm"` — Plan 0002 가 export.
- `import type { SessionPayload } from "@/lib/session/types"` — `{ puuid, accessToken, refreshToken, entitlementsJwt, expiresAt, region }` (모두 camelCase, `expiresAt` 은 Unix epoch seconds).
- `import { buildSessionCookie } from "@/lib/session/cookie"` (Plan 0002 소유) — `expiresAt - now` 기반 동적 `Max-Age` 로 `Set-Cookie` 문자열을 조립.

### 검증 항목 (본 Plan 에서 수행)

- Phase 2 auth flow 테스트 내부에서 Plan 0002 의 실제 `encryptSession` / `decryptSession` 을 사용해 왕복 정합성을 간접 검증 (crypto 자체 단위 테스트는 Plan 0002 소유이므로 중복 금지).
- `.env.example` 에 `TOKEN_ENC_KEY` 키 추가는 Plan 0002 소관. 본 Plan 은 `RIOT_AUTH_REDIRECT_URI` 만 추가.

**파일**: `.env.example`
- `RIOT_AUTH_REDIRECT_URI=http://localhost:3000/api/auth/callback`

---

## Phase 2: Auth Route Handlers (`/api/auth/start`, `/api/auth/callback`)

### 테스트 시나리오

#### Test 2-1: state 불일치 시 콜백 거부
```ts
// tests/critical-path/auth.test.ts
import { testApiHandler } from "next-test-api-route-handler";
import * as callbackRoute from "@/app/api/auth/callback/route";

describe("Feature: Riot 로그인 콜백", () => {
  describe("Scenario: CSRF 방어 — state 불일치", () => {
    it("givenStateMismatch_whenCallback_thenRedirectsToLoginWithError", async () => {
      // Given: cookie 의 auth_state 와 query.state 가 다름
      await testApiHandler({
        appHandler: callbackRoute,
        test: async ({ fetch }) => {
          // When
          const res = await fetch({
            method: "GET",
            headers: { cookie: "auth_state=abc" },
            // Then
          }, "/api/auth/callback?state=zzz&access_token=dummy");
          expect(res.status).toBe(302);
          expect(res.headers.get("location")).toMatch(/\/login\?error=state_mismatch/);
        },
      });
    });
  });
});
```

#### Test 2-2: 성공 경로 — cookie 속성 검증
```ts
it("givenValidRiotResponses_whenCallback_thenSetsSecureHttpOnlySessionCookie", async () => {
  // Given: MSW 가 entitlements, userinfo 를 정상 응답, state/cookie 일치
  // When: /api/auth/callback?state=s1&access_token=at 호출 (cookie: auth_state=s1)
  // Then
  // - status 302, location = /dashboard
  // - Set-Cookie: session=<aes>; HttpOnly; Secure; SameSite=Lax; Path=/
  // - auth_state cookie 는 Max-Age=0 으로 만료
});
```

#### Test 2-3: 동시 여러 유저 콜백 독립 처리
```ts
it("givenTwoConcurrentCallbacks_whenBothSucceed_thenEachReceivesOwnSession", async () => {
  // Given: 두 유저의 access_token 과 state 쌍
  // When: Promise.all 로 병렬 호출
  // Then: 각 응답의 session cookie 가 서로 다른 PUUID 를 복호화했을 때 반환
});
```

#### Test 2-4: 성공 경로 — Riot 호출 순서 및 payload
```ts
it("givenAccessToken_whenCallback_thenCallsEntitlementsThenUserinfoInOrder", async () => {
  // Given: MSW spy 로 호출 순서 기록
  // When: callback 호출
  // Then: 첫째 entitlements endpoint 에 Authorization: Bearer at, 둘째 userinfo 에 동일 토큰
});
```

#### Test 2-5: Riot 5xx 처리
```ts
it("givenEntitlementsReturns500_whenCallback_thenRedirectsToLoginUpstreamError", async () => {
  // Given: MSW 가 entitlements 에 500
  // When / Then: 302 /login?error=upstream, session cookie 미설정
});
```

#### Test 2-6: 타임아웃 처리
```ts
it("givenRiotHangs_whenCallbackExceedsTimeout_thenRedirectsToLoginTimeout", async () => {
  // Given: MSW delay > 3s
  // When / Then: AbortController 로 3s 컷 → 302 /login?error=timeout
});
```

#### Test 2-7: 로그/응답에 토큰 평문 미노출
```ts
it("givenSuccessfulCallback_whenInspectLogsAndBody_thenNoRawTokenAppears", async () => {
  // Given: console.log / console.error 캡처
  // When: callback 성공 호출
  // Then: 캡처된 문자열에 access_token·entitlements·ssid 평문 미포함
});
```

#### Test 2-8: userinfo 응답에서 PUUID 만 보관
```ts
it("givenUserinfoWithExtraPII_whenCallback_thenStoresOnlyPuuidInSession", async () => {
  // Given: userinfo 가 { sub: "puuid-1", email: "x@y", country: "KR" } 반환
  // When: callback 호출 후 session cookie 복호화
  // Then: payload.puuid === "puuid-1" 이며 email/country 필드 부재
});
```

#### Test 2-9: `/api/auth/start` 는 302 로 Riot authorize URL + state cookie 설정
```ts
it("givenStartRequest_whenGet_thenRedirectsToRiotAuthorizeWithStateCookie", async () => {
  // Given: 요청
  // When: GET /api/auth/start
  // Then
  // - 302 location: https://auth.riotgames.com/authorize?...&state=<s>
  // - Set-Cookie: auth_state=<s>; HttpOnly; Secure; SameSite=Lax; Max-Age=600
});
```

### 구현 항목

**파일**: `lib/riot/auth.ts`
- 외부 HTTP 호출은 **Plan 0006 의 `RiotFetcher` 포트** 를 DI 받는다 (`import type { RiotFetcher } from "@/lib/riot/fetcher"`). `fetch` 글로벌 직접 참조 금지.
- `exchangeAccessTokenForEntitlements(accessToken: string, fetcher: RiotFetcher): Promise<string>` — `POST https://entitlements.auth.riotgames.com/api/token/v1`, `Authorization: Bearer <at>`, 응답에서 `entitlements_token` 추출
- `fetchPuuid(accessToken: string, fetcher: RiotFetcher): Promise<string>` — `GET https://auth.riotgames.com/userinfo`, `Authorization: Bearer <at>`, 응답에서 `sub` 만 반환
- `buildRiotAuthorizeUrl(state: string, redirectUri: string): string` — 커뮤니티 표준 query (client_id=play-valorant-web-prod, response_type=token, scope=account openid, state, redirect_uri)
- 공통 `withTimeout(promise, ms)` 유틸 (3s 컷) — Plan 0006 `RiotFetcher` 가 이미 타임아웃을 제공한다면 중복 방지를 위해 어댑터 계층에서만 적용
- 테스트에서는 `RiotFetcher` 의 테스트 더블을 주입 (포트-어댑터)

**파일**: `app/api/auth/start/route.ts`
- `GET`: 난수 state 32바이트 base64url 생성 → `Set-Cookie: auth_state=<s>; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/` → Riot authorize URL 로 302

**파일**: `app/api/auth/callback/route.ts`
- **소유권**: 본 Plan 이 route 파일을 소유. 단 **최상위 try/catch 래퍼(에러 정규화·로그 마스킹)는 Plan 0006 이 주입** — 본 Plan 은 `handleAuthCallback(input): Promise<Response>` 헬퍼를 export 하여 0006 이 래핑 가능하도록 계약을 명시한다. Route 의 `GET` export 는 내부적으로 `handleAuthCallback` 을 호출하고, Plan 0006 가 도입되면 0006 래퍼가 이 `GET` 을 대체하거나 헬퍼를 감싼다.
- `GET` (= `handleAuthCallback` 위임):
  1. query `state`, `access_token` (또는 fragment 로 오는 경우를 위한 보조 `GET /api/auth/callback/hash` 엔드포인트 — 아래 별도 항목) 수신
  2. cookie `auth_state` 와 state 비교. 불일치 → 302 `/login?error=state_mismatch`
  3. `exchangeAccessTokenForEntitlements(access_token, riotFetcher)` (3s 타임아웃, `RiotFetcher` DI)
  4. `fetchPuuid(access_token, riotFetcher)` (3s 타임아웃, `RiotFetcher` DI)
  5. 실패 시 에러 코드 매핑 (`upstream`, `timeout`, `invalid_token`) → `/login?error=<code>` 302
  6. 성공 시 `SessionPayload = { puuid, accessToken, refreshToken, entitlementsJwt, expiresAt, region }` (Plan 0002 타입) 구성 → `encryptSession(payload)` → `buildSessionCookie(payload)` 로 `Set-Cookie` 조립 (Max-Age = `expiresAt - now`, 고정값 금지)
  7. `auth_state` cookie 는 `Max-Age=0` 으로 만료
  8. 302 `/dashboard`
- 에러 처리 중 catch 블록에서 `console.error` 에 에러 타입만 기록, 토큰/쿠키 값 금지 (최종 로그 마스킹은 Plan 0006 래퍼가 강화)

**파일**: `app/api/auth/callback/hash/route.ts` (보조)
- Riot implicit grant 는 `#access_token=...` fragment 로 토큰을 반환. 브라우저 JS 스텁 페이지가 fragment 를 읽어 `POST /api/auth/callback/hash` 로 전송하는 최소 경로 제공. 본 Plan 에서 구현 포함 (아니면 로그인 동작 불가).
- `POST { state, access_token }` → 위 콜백 동일 로직 후 JSON `{ ok: true, redirect: "/dashboard" }` 응답 (클라이언트가 `window.location` 교체)
- state 검증·cookie 설정·토큰 교환 로직은 callback 핸들러와 공유 헬퍼 `handleAuthCallback(input): Promise<Response>` 로 추출

**파일**: `app/(auth)/login/page.tsx` (본 Plan 범위는 최소 스텁)
- "Riot 로 로그인" 버튼 → `window.location = "/api/auth/start"`
- URL fragment 감지 시 fetch `/api/auth/callback/hash` 호출 후 `window.location.replace(json.redirect)`
- `?error=<code>` query 감지 시 에러 배너 렌더
- 상세 디자인/스타일링은 별도 Plan 으로 위임, 본 Plan 은 동작 경로만

### Phase 2 테스트 하네스

**파일**: `tests/critical-path/_msw/riot-handlers.ts`
- MSW handlers: `POST entitlements.auth.riotgames.com/api/token/v1`, `GET auth.riotgames.com/userinfo` 기본 성공/실패/지연 3 종

**파일**: `vitest.config.ts`
- `tests/critical-path/**/*.test.ts` 포함, alias `@/*`, setup 파일에서 MSW server start/reset/close

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 ─┬─ 1-1 test ─┐
         ├─ 1-2 test ─┼──→ 1-impl (lib/crypto/aes-gcm.ts) ─┐
         └─ 1-3 test ─┘                                    │
                                                           ▼
Phase 2 ─┬─ 2-1 test ─┐                                    │
         ├─ 2-2 test ─┤                                    │
         ├─ 2-3 test ─┤    (needs crypto from Phase 1) ───┘
         ├─ 2-4 test ─┼──→ 2-impl-auth-lib (lib/riot/auth.ts)
         ├─ 2-5 test ─┤         │
         ├─ 2-6 test ─┤         ▼
         ├─ 2-7 test ─┼──→ 2-impl-routes (app/api/auth/start, callback, callback/hash)
         ├─ 2-8 test ─┤         │
         └─ 2-9 test ─┘         ▼
                         2-impl-login-page (app/(auth)/login/page.tsx 스텁)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3 테스트 스텁 작성 | 없음 | 예 |
| G2 | 1-impl (`lib/crypto/aes-gcm.ts`), env.example 추가 | G1 완료 (RED) | 아니오 (단일 파일 편집) |
| G3 | 2-1~2-9 테스트 스텁 작성 + MSW handlers 작성 | G2 완료 (crypto green) | 예 (파일 분리) |
| G4 | 2-impl-auth-lib (`lib/riot/auth.ts`) | G3 완료 (RED) | 아니오 |
| G5 | 2-impl-routes (`app/api/auth/start/route.ts`, `app/api/auth/callback/route.ts`, `app/api/auth/callback/hash/route.ts`) | G4 완료 | 동일 폴더·공유 헬퍼이므로 **순차 권장** |
| G6 | 2-impl-login-page (`app/(auth)/login/page.tsx` 스텁) | G5 완료 | - |

### 종속성 판단 기준 (이 Plan 내 적용)

- crypto 모듈은 callback 의 쿠키 생성에 직접 소비 → Phase 1 → Phase 2 순차.
- 2-impl-routes 3 파일은 `handleAuthCallback` 헬퍼를 공유 → 같은 헬퍼 편집 충돌 가능성 → 단일 에이전트 순차 처리 권장.
- 테스트 스텁 작성은 서로 독립 파일이라 병렬 가능.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | AES-GCM 왕복 테스트 | ⬜ 범위 외 | Plan 0002 소유 |
| 1-2 | IV 랜덤성 테스트 | ⬜ 범위 외 | Plan 0002 소유 |
| 1-3 | 잘못된 키 복호화 실패 테스트 | ⬜ 범위 외 | Plan 0002 소유 |
| 1-impl | `lib/crypto/aes-gcm.ts` 구현 | ⬜ 범위 외 | Plan 0002 소유 (스텁 존재) |
| 1-config | `.env.example` 키 추가 | ✅ 완료 | TOKEN_ENC_KEY, RIOT_AUTH_REDIRECT_URI |
| 2-1 | state 불일치 콜백 거부 테스트 | ✅ 완료 | auth.test.ts |
| 2-2 | 성공 경로 cookie 속성 테스트 | ✅ 완료 | HttpOnly/Secure/SameSite |
| 2-3 | 병렬 콜백 독립성 테스트 | ✅ 완료 | |
| 2-4 | Riot 호출 순서 테스트 | ✅ 완료 | entitlements → userinfo |
| 2-5 | Riot 5xx → upstream 에러 테스트 | ✅ 완료 | |
| 2-6 | 타임아웃 테스트 | ✅ 완료 | AbortController 3s |
| 2-7 | 로그 토큰 평문 부재 테스트 | ✅ 완료 | |
| 2-8 | PUUID 만 저장 테스트 | ✅ 완료 | PIPA 최소수집 |
| 2-9 | `/api/auth/start` 리다이렉트 테스트 | ✅ 완료 | state cookie |
| 2-msw | MSW Riot handlers | ✅ 완료 | tests/critical-path/_msw/ |
| 2-vitest | vitest.config.ts + setup | ✅ 완료 | alias, msw setup |
| 2-impl-auth-lib | `lib/riot/auth.ts` 구현 | ✅ 완료 | exchangeAccessTokenForEntitlements, fetchPuuid, buildRiotAuthorizeUrl, withTimeout |
| 2-impl-routes | `app/api/auth/{start,callback,callback/hash}/route.ts` | ✅ 완료 | 공유 handleAuthCallback 헬퍼 |
| 2-impl-login-page | `app/(auth)/login/page.tsx` 최소 스텁 | ✅ 완료 | 버튼 + fragment 파싱 + 에러 배너 |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨 | ⬜ 범위 외
