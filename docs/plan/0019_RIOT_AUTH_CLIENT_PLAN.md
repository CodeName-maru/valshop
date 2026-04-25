# Plan 0019: FR-R2 lib/riot/auth-client + cookie-jar (Riot 프록시 레이어)

## 개요

Auth 재설계(spec `2026-04-24-auth-redesign-design.md`) 의 **FR-R2** 구현. Riot 비공식 auth flow (`GET /authorize`, `PUT /api/v1/authorization`, `GET /userinfo`, `POST entitlements/api/token/v1`, `authorize?prompt=none` 재인증) 를 호출하는 **단일 책임 HTTP 어댑터** 를 `lib/riot/auth-client.ts` 에 구축하고, per-request 쿠키 jar (`lib/riot/cookie-jar.ts`) 로 Riot 의 asid/clid/tdid/ssid 쿠키를 요청 생명주기 동안만 관리한다. `lib/riot/errors.ts` 는 `normalizeRiotError(raw)` 함수를 추가하여 Riot 응답 문자열 → spec § 5 의 `AuthErrorCode` enum 으로 table-driven 매핑한다.

본 plan 은 DB / 암호화 / 세션 / HTTP 라우팅을 **전혀 건드리지 않는다** — 상위 plan(0020 세션, 0021 route handler) 가 본 모듈을 소비한다. 외부 호출은 ADR-0006 `RiotFetcher` 포트를 DI 받는다 (신규 포트 정의 금지).

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 모듈 책임 | `auth-client.ts` 는 Riot 과의 HTTP 만. DB/crypto/세션/쿠키 직렬화 무지. | Maintainability — spec § 4-2 경계 원칙 (Riot 모듈은 Riot 만) |
| 쿠키 jar 구현 | `tough-cookie` 래퍼. 외부에는 `CookieJar` 인터페이스 (`getHeader(url)`, `storeFromResponse(url, res)`, `serialize()/deserialize(blob)`) 만 노출 | Maintainability / Cost (경량 단일 의존), ADR-0006 (포트-어댑터) |
| 쿠키 jar 수명 | per-request 생성. 로그인 flow 1회 요청에서만 존재 → 메모리로만 보관 | Security (jar 가 ssid 원본 보유 → stateless) / Scale (stateless, 인스턴스 공유 X) |
| Riot 엔드포인트 지식 위치 | auth-client.ts 가 baseUrl / path / payload 스키마 소유. route/세션 쪽은 enum 결과만 소비 | Maintainability (엔드포인트 변경 시 1파일) |
| 외부 호출 DI | ADR-0006 `RiotFetcher` 포트 재사용. `fetch` 글로벌 직접 참조 금지. 테스트에선 mock fetcher 주입 | Operability / Maintainability (ADR-0006 재사용, 신규 포트 정의 금지) |
| Timeout | 각 호출 3s AbortController. `RiotFetcher.fetch` 호출부에서 signal 주입 | Performance (login p95 ≤ 3s 예산, spec § 7 FR-R2) |
| 재시도 | **금지**. 429/5xx/타임아웃 시 정규화된 enum 반환 후 상위에서 유저에게 즉시 노출 | Availability / Compliance — spec § 6 "재시도 금지 (Cloudflare 밴 방지)" |
| Riot 쿠키 jar 구현 | `tough-cookie` 신규 추가 (경량 20KB-class, zero-dep, Node 표준 RFC 6265) | Cost / Maintainability (spec § 7 FR-R2 "tough-cookie 만 추가") |
| 함수 반환 타입 | discriminated union (`{kind:"ok"|"mfa"|"invalid"|"rate_limited"|"upstream"|"expired"}`) — throw 없이 분기 | Maintainability (exhaustive switch), Security (에러 경로에서 의도치 않은 raw body leak 방지) |
| normalizeRiotError 위치 | `lib/riot/errors.ts` (기존) 에 병존. 기존 `RiotError` 는 storefront 에서 소비 중 → 이름 충돌 피해 신규 `AuthErrorCode` enum 별도 | Compatibility (기존 consumer 깨지 않음) |
| Riot 응답 민감 필드 | `normalizeRiotError` 가 raw body 에서 `access_token`, `id_token`, `ssid`, `password`, `authentication_code`, `set-cookie` 헤더 redact 후 로그 페이로드 구성 | Security (spec § 6 PW 취급 불변식) |
| `buildRiotAuthorizeUrl` | **삭제**. implicit grant 경로 폐기 (spec § 2, FR-R6). `initAuthFlow` 내부에서 `GET /authorize?client_id=...` 호출 시 URL 을 인라인 구성 | Compatibility (spec § 7 FR-R6 grep 검증) |
| `exchangeAccessTokenForEntitlements` / `fetchPuuid` | `lib/riot/auth.ts` 에서 **이관**. auth.ts 는 축소(사실상 빈 파일 또는 삭제 후보 — FR-R6 에서 최종 삭제) | Compatibility (spec § 7 FR-R2 터치 파일 명세) |
| `reauthWithSsid` 시그니처 | `reauthWithSsid(ssid: string, tdid?: string): Promise<{kind:"ok", accessToken: string} \| {kind:"expired"} \| {kind:"upstream"}>` — plan 0020 이 이 시그니처를 import | Maintainability (Cross-plan 계약, spec § 8 G2 의존) |
| `RIOT_CLIENT_VERSION` 헤더 | authorize/authorization/userinfo/entitlements 에는 **불필요** (ADR-0005 는 pd.* / glz.* 용). 본 모듈은 Riot auth 도메인만 호출 → 헤더 생략 | Performance / Compliance (ADR-0005 범위 분리) |
| 테스트 스택 | Vitest + mock `RiotFetcher` (MSW 불요 — 포트 레벨 mock 이면 충분) | ADR-0006, Maintainability (경량 단위 테스트) |
| normalizeRiotError 테스트 | table-driven (`it.each`) — Riot 응답 문자열 → enum | Maintainability (spec § 5 enum 매핑 단일 소스 보장) |

## 가정사항

- Riot 비공식 auth flow 의 request/response 스키마 (spec § 4-3) 가 plan 작성 시점에 유효. 차단·변경은 ADR-0001 개정안 상 수용 리스크.
- `tough-cookie` 는 `package.json` 에 런타임 의존으로 추가. `@types/tough-cookie` 는 개발 의존. 그 외 신규 의존 금지.
- 레퍼런스 (plan 파일 기록용 URL, 코드 복사 금지):
  - https://github.com/giorgi-o/SkinPeek (Riot auth flow 표준 패턴 — credential/mfa/reauth 3분기)
  - https://github.com/techchrism/valorant-api-docs (엔드포인트 payload 스키마 문서)
  - https://github.com/staciax/ValorantStoreChecker-discord-bot (`reauthWithSsid` 실제 동작 예시)
- `RiotFetcher.fetch(url, options)` 가 `RequestInit.signal` 을 그대로 전달한다고 가정 (기존 `httpRiotFetcher` 구현 확인 — 단순 passthrough). 만약 signal 무시 시 `withTimeout` 래퍼로 폴백.
- `authorize?prompt=none` (reauth 경로) 는 ssid cookie 만으로 302 redirect 의 `Location` 헤더에 `#access_token=...` fragment 를 실어 돌려준다 (커뮤니티 표준). `CookieJar` 에 ssid 를 주입한 뒤 `redirect: "manual"` 로 호출하여 `Location` 파싱.
- `PUT /api/v1/authorization` 응답은 성공 시 `{type:"response", response.parameters.uri:"<redirect>#access_token=..."}` 를 반환. fragment 에서 `access_token` 추출.
- MFA 분기는 `{type:"multifactor", multifactor:{email:"j***@...", methods:["email"]}}` 형태. `emailHint` 는 `multifactor.email` 문자열 그대로 전달.
- 로그인 실패 분기 매핑:
  - `{error:"auth_failure"}` → `invalid_credentials`
  - `{error:"rate_limited"}` / HTTP 429 / Cloudflare 1020 (body 내 "Cloudflare" 문자열 + status 403/503) → `rate_limited`
  - HTTP 5xx 또는 timeout (AbortError) → `upstream`
  - `{type:"multifactor_attempt_failed"}` → `mfa_invalid` (submitMfa 전용)
- `reauthWithSsid` 에서 Riot 이 ssid 만료 시 `{type:"auth"}` 또는 `{error:"auth_failure"}` 응답 → `expired` 로 매핑.
- **Cross-plan 계약:**
  - `reauthWithSsid` 시그니처는 plan 0020(`lib/session/reauth.ts`) 가 그대로 소비. 본 plan 이 단일 소스.
  - `AuthErrorCode` enum 정의는 spec § 5 를 그대로 구현 (7종: `invalid_credentials`, `mfa_required`, `mfa_invalid`, `mfa_expired`, `rate_limited`, `riot_unavailable`, `session_expired`, `unknown`). `mfa_expired` 는 auth-client 가 직접 생산하지 않음(pending-jar 소관, plan 0020). 본 plan 은 enum 타입만 export, 생산은 해당 범위.
  - `normalizeRiotError` 는 plan 0021(route handlers) 가 error response body 구성 시 사용.
  - `RiotFetcher` 포트는 ADR-0006 정의 재사용. 본 plan 에서 확장하지 않음.

## NFR 반영

| 카테고리 | 반영 내용 | 측정/테스트 시나리오 |
|---|---|---|
| Performance | 각 Riot 호출 3s timeout (AbortController). 직렬 호출 총 p95 ≤ 3s 목표. retry 금지로 지연 누적 없음. | Test 2-5 (timeout → upstream), Test 2-1/2-2/2-3 (happy path latency — mock instantaneous) |
| Scale | stateless. CookieJar 는 per-request 인스턴스 → 인스턴스 간 공유 불필요. Vercel Serverless 병렬 호출 안전. | Test 2-8 (두 CookieJar 독립성) |
| Availability | Riot 5xx/429/타임아웃 시 정규화된 enum (`rate_limited`/`upstream`/`session_expired`) 반환. **재시도 금지** → Cloudflare 밴 방지 (spec § 6). 상위 layer 에서 즉시 유저에게 표시. | Test 2-5, 2-6, 2-7 (각 실패 분기), Test 3-x (normalizeRiotError table) |
| Security | (a) 로그에 `password`/`access_token`/`ssid`/`id_token` 원본 출력 금지, (b) `normalizeRiotError` 가 raw body 에서 민감 필드 redact, (c) CookieJar 는 메모리로만 보관 (직렬화 시 plan 0020 이 AES-GCM 암호화 책임), (d) discriminated union 반환으로 에러 경로에서 의도치 않은 body leak 방지. | Test 2-10 (에러 응답에 raw body 미노출), Test 3-5 (sanitize — redact keys), Test 1-2 (CookieJar 직렬화 포맷 검증) |
| Compliance | Riot ToS 회색지대 — ADR-0001 개정안 (PW 일시 경유 수용) 준수. `buildRiotAuthorizeUrl` 삭제로 implicit grant 잔재 제거 (FR-R6 선반영). | Test 2-0 (grep `buildRiotAuthorizeUrl` = 0 은 FR-R6 에서 검증, 본 plan 은 미구현/export 부재만 typecheck 로 확인) |
| Operability | `RiotFetcher` DI 로 테스트/모니터링 주입 가능. `normalizeRiotError` 의 로그 페이로드에 `upstreamStatus`/`rawErrorKey` 기록 → Vercel function log 에서 분류 가능. | 수동 점검 — 구현 시 log payload 형태 review. Test 3-6 (로그 페이로드에 민감필드 부재). |
| Cost | `tough-cookie` 1개 (런타임) + `@types/tough-cookie` (dev). 기타 의존 0. Vercel Hobby 범위 유지. | N/A — 의존 추가 제한으로 달성, 측정 불필요. |
| Maintainability | 포트-어댑터 패턴. 순수 HTTP 어댑터로 DB/암호화/세션 무지 → 테스트 경량 (mock fetcher 1개). normalizeRiotError table-driven 으로 신규 에러 코드 추가 시 1줄 편집. | Test 2-1~2-10 (auth-client 분기), Test 1-1~1-3 (CookieJar), Test 3-1~3-7 (normalizeRiotError). `vitest --run lib/riot` 1 클릭. |

주: 본 plan 은 단일 HTTP 어댑터 범위라 Scale/Availability 는 주로 구조적 준수 (stateless, 재시도 금지, 결정적 enum 매핑) 로 달성.

---

## Phase 1: CookieJar (`lib/riot/cookie-jar.ts`)

### 테스트 시나리오

**파일**: `tests/unit/riot/cookie-jar.test.ts`

#### Test 1-1: 빈 jar 에 Set-Cookie 응답 저장 후 헤더 조회
```ts
it("givenEmptyJar_whenStoreSetCookieFromResponse_thenGetHeaderReturnsCookiesForSameDomain", async () => {
  // Given: 빈 CookieJar
  // When: Response { headers: { "set-cookie": "asid=abc; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly" } } 를 storeFromResponse 로 주입
  //        그 후 getHeader("https://auth.riotgames.com/authorize") 호출
  // Then: 반환 문자열이 "asid=abc" 를 포함
});
```

#### Test 1-2: 다중 Set-Cookie 누적 + 도메인 스코프 필터
```ts
it("givenJarWithRiotCookies_whenGetHeaderForDifferentDomain_thenReturnsOnlyMatchingCookies", async () => {
  // Given: jar 에 asid(auth.riotgames.com), clid(auth.riotgames.com), tdid(auth.riotgames.com), foreign(other.com) 저장
  // When: getHeader("https://auth.riotgames.com/userinfo")
  // Then: asid/clid/tdid 포함, foreign 미포함
});
```

#### Test 1-3: 만료된 쿠키 제외
```ts
it("givenExpiredCookieInJar_whenGetHeader_thenExcludesExpiredCookie", async () => {
  // Given: Set-Cookie 에 Expires=<과거> 포함된 쿠키 저장
  // When: getHeader 호출
  // Then: 해당 쿠키 부재
});
```

#### Test 1-4: serialize/deserialize 왕복 (plan 0020 pending-jar 소비 계약)
```ts
it("givenPopulatedJar_whenSerializeThenDeserialize_thenCookiesPreserved", async () => {
  // Given: asid/clid/tdid 가 저장된 jar
  // When: const blob = jar.serialize(); const restored = CookieJar.deserialize(blob);
  // Then: restored.getHeader(url) 이 원본과 동일 쿠키 문자열 반환
});
```

### 구현 항목

**파일**: `lib/riot/cookie-jar.ts` (신규)
- `tough-cookie` 의 `CookieJar` 를 내부에 보유하는 thin 래퍼 클래스 `RiotCookieJar`.
- 공개 메서드:
  - `async storeFromResponse(url: string, res: Response): Promise<void>` — `res.headers.getSetCookie()` (또는 Node 환경 호환 폴백) 반복하여 jar 에 저장.
  - `async getHeader(url: string): Promise<string>` — 해당 URL 에 매칭되는 쿠키 문자열 반환 (없으면 `""`).
  - `serialize(): string` — `tough-cookie` 의 `toJSON()` 결과를 JSON.stringify.
  - `static deserialize(blob: string): RiotCookieJar` — 역직렬화. 실패 시 빈 jar 반환.
- `package.json` 에 `tough-cookie` + `@types/tough-cookie` 추가.

---

## Phase 2: auth-client core (`lib/riot/auth-client.ts`)

### 테스트 시나리오

**파일**: `tests/unit/riot/auth-client.test.ts`

공통 setup: `createMockFetcher()` — `RiotFetcher` 인터페이스를 구현하는 vi.fn 기반 목. `queue(response)` 로 순차 응답 지정.

#### Test 2-1: `initAuthFlow` 이 authorize GET 호출 + jar 에 쿠키 축적
```ts
it("givenFreshJar_whenInitAuthFlow_thenCallsAuthorizeAndPopulatesJar", async () => {
  // Given: fresh RiotCookieJar, mock fetcher 가 Set-Cookie (asid/clid/tdid) 응답
  // When: await initAuthFlow(jar, fetcher)
  // Then:
  //   - fetcher.fetch 가 "https://auth.riotgames.com/authorize?client_id=play-valorant-web-prod&response_type=token&scope=account%20openid&..." GET 으로 호출됨
  //   - jar.getHeader(...) 가 asid/clid/tdid 포함
});
```

#### Test 2-2: `submitCredentials` happy path → `{kind:"ok", accessToken}`
```ts
it("givenValidCredentials_whenSubmitCredentials_thenReturnsOkWithAccessToken", async () => {
  // Given: jar 가 initAuthFlow 완료 상태, fetcher 가 {type:"response", response:{parameters:{uri:"https://redirect#access_token=at123&..."}}} 응답
  // When: await submitCredentials(jar, {username:"u",password:"p"}, fetcher)
  // Then: 결과 === {kind:"ok", accessToken:"at123"}
  //       fetcher 호출 URL = "https://auth.riotgames.com/api/v1/authorization", method=PUT
  //       request body 에 {type:"auth", username:"u", password:"p", remember:true, language:"en_US"} 포함
});
```

#### Test 2-3: `submitCredentials` MFA 분기 → `{kind:"mfa", emailHint}`
```ts
it("givenAccountRequiresMfa_whenSubmitCredentials_thenReturnsMfaBranchWithEmailHint", async () => {
  // Given: fetcher 가 {type:"multifactor", multifactor:{email:"j***@example.com"}} 응답
  // When / Then: 결과 === {kind:"mfa", emailHint:"j***@example.com"}
});
```

#### Test 2-4: `submitCredentials` invalid → `{kind:"invalid"}`
```ts
it("givenWrongPassword_whenSubmitCredentials_thenReturnsInvalid", async () => {
  // Given: fetcher 가 {error:"auth_failure"} 응답 (HTTP 200 body, Riot 특성)
  // When / Then: 결과 === {kind:"invalid"}
});
```

#### Test 2-5: `submitCredentials` 타임아웃 → `{kind:"upstream"}`
```ts
it("givenRiotHangs_whenSubmitCredentialsExceeds3s_thenReturnsUpstream", async () => {
  // Given: fetcher 가 AbortError 를 throw (signal 반응 시뮬레이션)
  // When / Then: 결과 === {kind:"upstream"}, fetcher.fetch 호출 시 options.signal 존재 확인
});
```

#### Test 2-6: `submitCredentials` 429 → `{kind:"rate_limited"}`
```ts
it("givenRiot429_whenSubmitCredentials_thenReturnsRateLimited", async () => {
  // Given: fetcher 가 Response(status=429, body="") 응답
  // When / Then: 결과 === {kind:"rate_limited"}
});
```

#### Test 2-7: `submitCredentials` 5xx → `{kind:"upstream"}`
```ts
it("givenRiot503_whenSubmitCredentials_thenReturnsUpstream", async () => {
  // Given: fetcher 가 Response(status=503) 응답
  // When / Then: 결과 === {kind:"upstream"}
});
```

#### Test 2-8: `submitMfa` happy path
```ts
it("givenValidMfaCode_whenSubmitMfa_thenReturnsOkWithAccessToken", async () => {
  // Given: jar 가 pending 상태 (credential 단계의 asid/clid/tdid 보유), fetcher 가 {type:"response", response:{parameters:{uri:"...#access_token=at456"}}} 응답
  // When: await submitMfa(jar, "123456", fetcher)
  // Then: 결과 === {kind:"ok", accessToken:"at456"}
  //       PUT body 에 {type:"multifactor", code:"123456", rememberDevice:true} 포함
});
```

#### Test 2-9: `submitMfa` 잘못된 코드 → `{kind:"invalid"}`
```ts
it("givenWrongMfaCode_whenSubmitMfa_thenReturnsInvalid", async () => {
  // Given: fetcher 가 {type:"multifactor_attempt_failed"} 또는 {error:"multifactor_attempt_failed"} 응답
  // When / Then: 결과 === {kind:"invalid"}  (Note: 상위 layer 에서 AuthErrorCode="mfa_invalid" 로 매핑)
});
```

#### Test 2-10: `reauthWithSsid` happy path
```ts
it("givenValidSsid_whenReauthWithSsid_thenReturnsOkWithAccessToken", async () => {
  // Given: fetcher 가 redirect: "manual" 응답으로 Response(status=303, headers:{Location:"https://redirect#access_token=at789"}) 반환
  // When: await reauthWithSsid("ssid-blob", "tdid-blob", fetcher)
  // Then: 결과 === {kind:"ok", accessToken:"at789"}
  //       호출 URL 이 "https://auth.riotgames.com/authorize?...&prompt=none&..." GET
  //       Cookie 헤더에 "ssid=ssid-blob" 포함, (tdid 제공 시) "tdid=tdid-blob" 포함
});
```

#### Test 2-11: `reauthWithSsid` 만료 → `{kind:"expired"}`
```ts
it("givenExpiredSsid_whenReauthWithSsid_thenReturnsExpired", async () => {
  // Given: fetcher 가 redirect 의 fragment 대신 {type:"auth"} (재로그인 요구) body 혹은 Location 에 access_token 없는 302 응답
  // When / Then: 결과 === {kind:"expired"}
});
```

#### Test 2-12: `reauthWithSsid` 5xx → `{kind:"upstream"}`
```ts
it("givenRiot5xx_whenReauthWithSsid_thenReturnsUpstream", async () => {
  // Given/When/Then: status=500 → upstream
});
```

#### Test 2-13: `fetchPuuid` 성공
```ts
it("givenAccessToken_whenFetchPuuid_thenReturnsSub", async () => {
  // Given: fetcher 가 {sub:"puuid-1", country:"KR", email:"x@y"} 응답
  // When: await fetchPuuid("at", fetcher)
  // Then: "puuid-1" 반환, email/country 반환값에 부재
});
```

#### Test 2-14: `exchangeEntitlements` 성공
```ts
it("givenAccessToken_whenExchangeEntitlements_thenReturnsJwt", async () => {
  // Given: fetcher 가 {entitlements_token:"ejw..."} 응답
  // When / Then: "ejw..." 반환
});
```

#### Test 2-15: 호출 시 3s AbortController signal 주입 확인 (공통)
```ts
it.each([
  ["initAuthFlow", (jar, f) => initAuthFlow(jar, f)],
  ["submitCredentials", (jar, f) => submitCredentials(jar, {username:"u",password:"p"}, f)],
  ["submitMfa", (jar, f) => submitMfa(jar, "111111", f)],
  ["reauthWithSsid", (_, f) => reauthWithSsid("s", undefined, f)],
])("given%sCall_whenInvoked_thenPassesAbortSignalWith3sTimeout", async (_name, invoke) => {
  // Given: spy fetcher 가 options.signal 을 캡처
  // When: invoke 호출
  // Then: signal 존재, timeout 이 3000ms 근사치
});
```

### 구현 항목

**파일**: `lib/riot/auth-client.ts` (신규)
- export 함수:
  - `initAuthFlow(jar: RiotCookieJar, fetcher: RiotFetcher): Promise<void>`
  - `submitCredentials(jar, {username, password}, fetcher): Promise<CredentialResult>`
    - `type CredentialResult = {kind:"ok", accessToken:string} | {kind:"mfa", emailHint:string} | {kind:"invalid"} | {kind:"rate_limited"} | {kind:"upstream"}`
  - `submitMfa(jar, code, fetcher): Promise<MfaResult>`
    - `type MfaResult = {kind:"ok", accessToken:string} | {kind:"invalid"} | {kind:"rate_limited"} | {kind:"upstream"}`
  - `reauthWithSsid(ssid: string, tdid: string | undefined, fetcher: RiotFetcher): Promise<ReauthResult>`
    - `type ReauthResult = {kind:"ok", accessToken:string} | {kind:"expired"} | {kind:"upstream"}`
  - `fetchPuuid(accessToken: string, fetcher: RiotFetcher): Promise<string>` — 기존 `lib/riot/auth.ts` 에서 이관
  - `exchangeEntitlements(accessToken: string, fetcher: RiotFetcher): Promise<string>` — 기존 `lib/riot/auth.ts` 에서 이관 (이름은 spec FR-R2 그대로 `exchangeEntitlements`)
- 내부 헬퍼:
  - `AUTHORIZE_QUERY` 상수 (client_id=play-valorant-web-prod, response_type=token, scope="account openid", redirect_uri="https://playvalorant.com/", nonce=1)
  - `extractAccessTokenFromUri(uri: string): string | null` — fragment 에서 `access_token` 파싱
  - `withAbortSignal(ms: number): {signal: AbortSignal, cleanup: () => void}` — 3s 타임아웃 생성
  - 각 함수는 `jar.getHeader(url)` 로 `Cookie` 헤더 구성 후 fetcher 호출, 응답에서 `jar.storeFromResponse(url, res)` 재저장.
- **`reauthWithSsid`**: 외부 상태 없는 stateless 함수 — 전용 jar 를 함수 내부에서 생성, ssid/tdid 수동 주입 후 `GET authorize?prompt=none` 호출 with `redirect: "manual"`.

**파일**: `lib/riot/auth.ts` (축소)
- `buildRiotAuthorizeUrl` **삭제** (spec FR-R6 선반영).
- `exchangeAccessTokenForEntitlements`, `fetchPuuid` 본문 삭제 — auth-client 로 이관. 재-export 금지 (spec FR-R6).
- 빈 파일 또는 최소 잔여 (e.g. withTimeout 유틸이 타 모듈에서 쓰이면 유지, 아니면 삭제 — FR-R6 에서 최종 삭제 판단). 본 plan 에선 `withTimeout` 은 auth-client 내부로 이관하고 auth.ts 는 `export {}` 로 남긴다.

---

## Phase 3: `normalizeRiotError` (`lib/riot/errors.ts` 확장)

### 테스트 시나리오

**파일**: `tests/unit/riot/errors.normalize.test.ts`

#### Test 3-1~3-4: table-driven Riot 응답 → AuthErrorCode
```ts
it.each([
  [{ error: "auth_failure" }, 200, "invalid_credentials"],
  [{ error: "rate_limited" }, 429, "rate_limited"],
  [{ type: "multifactor_attempt_failed" }, 200, "mfa_invalid"],
  [{ error: "auth_failure" }, 401, "session_expired"],  // ssid reauth 맥락
  [{}, 500, "riot_unavailable"],
  [{}, 503, "riot_unavailable"],
  ["<html>cloudflare 1020</html>", 403, "rate_limited"],
  [null, 0, "unknown"],  // timeout/AbortError → caller 가 {status:0} 로 전달
])("givenRawResponse_whenNormalize_thenMapsToExpectedAuthErrorCode", (body, status, expected) => {
  // Given: raw = {body, status, phase?: "credential"|"mfa"|"reauth"}
  // When: normalizeRiotError(raw)
  // Then: result.code === expected
});
```

#### Test 3-5: raw body 에서 민감 필드 redact 후 로그 페이로드 구성
```ts
it("givenBodyWithSensitiveFields_whenNormalize_thenLogPayloadRedactsTokens", () => {
  // Given: body = {access_token:"leak", id_token:"leak2", ssid:"leak3", password:"leak4", authentication_code:"leak5", nested:{ssid:"leak6"}, normal_field:"ok"}
  // When: const {code, logPayload} = normalizeRiotError({body, status:200});
  // Then:
  //   - logPayload 에 "leak"/"leak2".."leak6" 문자열 부재
  //   - logPayload.normal_field === "ok"
  //   - redactKey 들이 "[REDACTED]" 로 치환
});
```

#### Test 3-6: Set-Cookie 응답 헤더는 redact (Response 입력 시)
```ts
it("givenResponseWithSetCookie_whenNormalize_thenLogPayloadOmitsCookieValues", () => {
  // Given: raw = {response: Response with Set-Cookie: ssid=leak}
  // When / Then: logPayload.headers["set-cookie"] === "[REDACTED]"
});
```

#### Test 3-7: phase 힌트가 분기 해결에 쓰임
```ts
it("givenAuthFailureInReauthPhase_whenNormalize_thenMapsSessionExpired", () => {
  // Given: {body:{error:"auth_failure"}, status:200, phase:"reauth"}
  // When / Then: code === "session_expired"
});
it("givenAuthFailureInCredentialPhase_whenNormalize_thenMapsInvalidCredentials", () => {
  // Given: phase:"credential" → "invalid_credentials"
});
```

### 구현 항목

**파일**: `lib/riot/errors.ts` (확장)
- 신규 export:
  - `type AuthErrorCode = "invalid_credentials" | "mfa_required" | "mfa_invalid" | "mfa_expired" | "rate_limited" | "riot_unavailable" | "session_expired" | "unknown"` (spec § 5 단일 소스)
  - `interface NormalizedRiotError { code: AuthErrorCode; logPayload: Record<string, unknown> }`
  - `function normalizeRiotError(raw: { body?: unknown; status: number; phase?: "credential"|"mfa"|"reauth"; response?: Response }): NormalizedRiotError`
- 내부 헬퍼:
  - `REDACT_KEYS = ["access_token","id_token","ssid","password","authentication_code","refresh_token","entitlements_token","set-cookie"]`
  - `redactDeep(value: unknown): unknown` — 객체 재귀 redact. 문자열 값도 해당 key 경로일 때만 "[REDACTED]" 치환, 일반 문자열 내용은 유지.
  - 매핑 테이블은 함수 상단 상수로 선언 (Riot 문자열 → AuthErrorCode + phase 힌트).
- 기존 `RiotError`/`classifyRiotResponse`/`toUserMessage` 등은 **유지** (storefront 소비 중 — 회귀 방지).

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 ─┬─ 1-1 test ─┐
         ├─ 1-2 test ─┼──→ 1-impl (lib/riot/cookie-jar.ts + tough-cookie dep)
         ├─ 1-3 test ─┤
         └─ 1-4 test ─┘
                              │
                              ▼   (auth-client 가 CookieJar 소비)
Phase 2 ─┬─ 2-1 ~ 2-15 tests ────→ 2-impl-auth-client (lib/riot/auth-client.ts)
                                    │
                                    ▼
                            2-impl-auth-shrink (lib/riot/auth.ts 축소)

Phase 3 ─┬─ 3-1 ~ 3-7 tests ─────→ 3-impl-normalize (lib/riot/errors.ts 확장)
         (Phase 1/2 와 독립 — 파일 다름)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1 ~ 1-4 CookieJar 테스트 스텁, 3-1 ~ 3-7 normalize 테스트 스텁 | 없음 | 예 (파일 분리) |
| G2 | 1-impl (`lib/riot/cookie-jar.ts` + deps), 3-impl-normalize (`lib/riot/errors.ts`) | G1 완료 (RED) | 예 (파일 분리) |
| G3 | 2-1 ~ 2-15 auth-client 테스트 스텁 | G2 완료 (CookieJar GREEN 필요) | 예 (단일 테스트 파일이나 시나리오 독립) |
| G4 | 2-impl-auth-client (`lib/riot/auth-client.ts`) | G3 완료 (RED) | 아니오 (단일 파일) |
| G5 | 2-impl-auth-shrink (`lib/riot/auth.ts` 축소) | G4 완료 (auth-client 이관 선행 필요) | 아니오 |

### 종속성 판단 기준 (이 Plan 내 적용)
- CookieJar 는 auth-client 가 import → Phase 1 → Phase 2 순차.
- `errors.ts` 는 auth-client 가 **소비하지 않음** (내부 분기는 자체 문자열 매핑, `normalizeRiotError` 는 상위 route handler 용). → Phase 3 독립.
- `auth.ts` 축소는 auth-client 이관 완료 후여야 함 (re-export 충돌 방지).

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | CookieJar Set-Cookie 저장 테스트 | ✅ 완료 | |
| 1-2 | 도메인 스코프 필터 테스트 | ✅ 완료 | |
| 1-3 | 만료 쿠키 제외 테스트 | ✅ 완료 | |
| 1-4 | serialize/deserialize 왕복 테스트 | ✅ 완료 | plan 0020 소비 계약 |
| 1-impl | `lib/riot/cookie-jar.ts` + tough-cookie 의존 추가 | ✅ 완료 | |
| 2-1 | initAuthFlow authorize GET 테스트 | ✅ 완료 | |
| 2-2 | submitCredentials happy 테스트 | ✅ 완료 | |
| 2-3 | submitCredentials MFA 분기 테스트 | ✅ 완료 | |
| 2-4 | submitCredentials invalid 테스트 | ✅ 완료 | |
| 2-5 | submitCredentials timeout 테스트 | ✅ 완료 | |
| 2-6 | submitCredentials 429 테스트 | ✅ 완료 | |
| 2-7 | submitCredentials 5xx 테스트 | ✅ 완료 | |
| 2-8 | submitMfa happy 테스트 | ✅ 완료 | |
| 2-9 | submitMfa invalid 테스트 | ✅ 완료 | |
| 2-10 | reauthWithSsid happy 테스트 | ✅ 완료 | plan 0020 소비 |
| 2-11 | reauthWithSsid expired 테스트 | ✅ 완료 | |
| 2-12 | reauthWithSsid 5xx 테스트 | ✅ 완료 | |
| 2-13 | fetchPuuid 테스트 | ✅ 완료 | 이관 → jwt.ts |
| 2-14 | exchangeEntitlements 테스트 | ✅ 완료 | 이관 |
| 2-15 | 공통 AbortSignal 3s 주입 테스트 | ✅ 완료 | table-driven |
| 2-impl-auth-client | `lib/riot/auth-client.ts` 구현 | ✅ 완료 | |
| 2-impl-auth-shrink | `lib/riot/auth.ts` 축소 (buildRiotAuthorizeUrl 삭제, PUUID/entitlements 제거) | ✅ 완료 | FR-R6 선반영 |
| 3-1 | normalizeRiotError invalid_credentials 매핑 | ✅ 완료 | |
| 3-2 | normalizeRiotError rate_limited 매핑 | ✅ 완료 | |
| 3-3 | normalizeRiotError mfa_invalid 매핑 | ✅ 완료 | |
| 3-4 | normalizeRiotError riot_unavailable 매핑 | ✅ 완료 | |
| 3-5 | raw body 민감 필드 redact 테스트 | ✅ 완료 | |
| 3-6 | Set-Cookie redact 테스트 | ✅ 완료 | |
| 3-7 | phase 힌트 분기 테스트 | ✅ 완료 | session_expired vs invalid_credentials |
| 3-impl-normalize | `lib/riot/errors.ts` normalizeRiotError + AuthErrorCode export | ✅ 완료 | |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨

---

## Amendment A (2026-04-24 저녁) — α′ 계약 정정

> spec `docs/superpowers/specs/2026-04-24-auth-redesign-design.md` § 11 amendment 에 맞춰 본 plan 의 Riot 계약을 정정. 기존 Phase 구조는 유지하되 아래 항목이 **규범(spec § 11)** 이고 본문 초기 기술이 충돌하면 본 Amendment 가 우선.

### A-1. Preflight (POST, not GET)

```
POST https://auth.riotgames.com/api/v1/authorization
Content-Type: application/json
User-Agent: <RIOT_CLIENT_USER_AGENT>
Body:
{
  "client_id": "play-valorant-web-prod",
  "nonce": "1",
  "redirect_uri": "https://playvalorant.com/opt_in",
  "response_type": "token id_token",
  "scope": "account openid"
}
```
응답의 Set-Cookie 를 jar 에 축적. 다음 PUT 호출에 그대로 전달.

### A-2. Credential 제출 (flat body, no captcha)

```
PUT https://auth.riotgames.com/api/v1/authorization
Content-Type: application/json
User-Agent: <RIOT_CLIENT_USER_AGENT>
Cookie: <jar>
Body:
{
  "type": "auth",
  "username": "...",
  "password": "...",
  "remember": true,
  "language": "en_US"
}
```
**주의**: techchrism 최신 doc 의 `riot_identity:{captcha,username,password}` 중첩 스키마는 웹 브라우저 login 페이지용이며 **사용하지 않음**. 데스크톱 클라이언트 사칭 경로는 flat 구 스키마로 동작 (staciax/Bbalduzz/SkinPeek 2026-Q1 코드 기준).

### A-3. 성공 응답 파싱

```json
{
  "type": "response",
  "response": { "parameters": { "uri": "https://playvalorant.com/opt_in#access_token=eyJ...&scope=account+openid&id_token=eyJ...&token_type=Bearer&expires_in=3600" } },
  "country": "kor"
}
```
- `access_token` = uri fragment 에서 정규식 `access_token=([A-Za-z0-9._-]+)` 로 추출.
- `id_token` = 마찬가지.
- `puuid` = **access_token 을 JWT 로 디코드해 `sub` claim** (별도 `/userinfo` 호출 제거. 1 HTTP round-trip 절약).
- `expires_in` 은 로그 보고용 (우리는 session.access_expires_at 을 `now + 55min` 보수 계산).

### A-4. MFA 응답 & 재요청 (flat body)

```json
// 1차 PUT 응답 (MFA 필요)
{
  "type": "multifactor",
  "multifactor": { "method": "email", "email": "j***@gmail.com", "methods": ["email"] },
  "country": "kor"
}
```

재요청:
```
PUT https://auth.riotgames.com/api/v1/authorization
Body: { "type": "multifactor", "code": "<6자리>", "rememberDevice": true }
```
**주의**: techchrism 의 `{multifactor:{otp,rememberDevice}}` 중첩은 신규 스키마라 사용 안 함. staciax/Bbalduzz 코드 기준 flat 구조.

### A-5. Reauth (ssid)

```
GET https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid
Cookie: ssid=...; <tdid=...>
```
응답: 301/302, `Location` header 에 `#access_token=...&id_token=...&expires_in=...` fragment. 같은 방식으로 파싱. `redirect:"manual"` 로 fetch + `Location` 헤더 직접 읽기.

### A-6. TLS 사칭 (서버 전용)

`lib/riot/fetcher.ts` 에 신규 Node-only path 추가 — auth 요청 전용 `https.Agent`:

```ts
import https from 'node:https';
const FORCED_CIPHERS = [/* spec § 11 의 17 항목 */].join(':');
export const riotAuthAgent = new https.Agent({
  ciphers: FORCED_CIPHERS,
  minVersion: 'TLSv1.3',
  honorCipherOrder: true,
  keepAlive: true,
});
```
auth-client 의 모든 외부 호출은 `{agent: riotAuthAgent}` 를 `undici.fetch` 의 `dispatcher` 또는 Node 18 `fetch` 의 옵션으로 주입. storefront 경로는 영향 없음 (기본 agent 유지).

### A-7. 환경변수 추가

- `RIOT_CLIENT_USER_AGENT` — `RiotClient/60.0.6.4770705.4749685 rso-auth (Windows;10;;Professional, x64)` (기본값 하드코딩하되 env 로 덮어쓸 수 있게).
- 기존 `RIOT_CLIENT_VERSION` 은 storefront 경로 전용이므로 분리 유지.

### A-8. PUUID 취득 단순화

기존 Phase 2 에 있던 `fetchPuuid(accessToken)` 함수는 **삭제**. 대신 `lib/riot/jwt.ts` 신규 (무외부-의존 JWT decode — base64url → JSON.parse payload 만, 서명 검증 불필요):

```ts
export function extractPuuidFromAccessToken(accessToken: string): string {
  const payload = accessToken.split('.')[1];
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json).sub as string;
}
```
성공 응답 파싱 직후 호출. 테스트: 잘못된 형식 → throw. claim 누락 → throw.

### A-9. 파싱 테스트 fixture

staciax 리포의 실 응답 body 3 종(success / multifactor / auth_failure)을 `tests/fixtures/riot-auth/*.json` 에 복제 후 파싱기 검증. 실사용 스키마와 drift 방지.

### A-10. 실패 판정 & α″ fallback 연결

Cloudflare challenge / 1020 / Riot 429 가 **로컬 + preview 배포 모두에서 재현 시**, plan 0019 는 그대로 보존하고 **환경변수 `AUTH_MODE=manual-ssid`** 가 켜지면 `submitCredentials`/`submitMfa` 엔드포인트를 비활성. 이 플래그 제어 자체는 plan 0021 route handler 에서 처리.

### 테스트 영향

- 기존 Phase 2 의 `fetchPuuid` 테스트 케이스 삭제.
- 신규 `extractPuuidFromAccessToken` 단위 테스트 3 건 (happy / malformed / missing-sub).
- `normalizeRiotError` 테이블에 Cloudflare 1020 / Riot `{"type":"auth","error":"auth_failure"}` 케이스 추가.
- request body assertion 을 A-2/A-4 스키마로 정확 매칭.
