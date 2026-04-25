# Spec: Riot Auth 재설계 (PW 프록시 + ssid reauth + Supabase 단일 vault)

- 작성일: 2026-04-24
- 작성자: maru (jeonsy423@gmail.com)
- 상태: DRAFT (user review 대기)
- 목적: **`/blueprint-all` 로 FR-R1~R7 각각을 plan 화할 수 있는 단일 소스 spec**
- 관련 PRD: [docs/PRD.md](../../PRD.md)
- 관련 ADR: [0001](../../adr/0001-unofficial-riot-auth.md)(개정), [0002](../../adr/0002-token-storage-hybrid.md)(개정), 0010(신규), 0011(신규)

---

## 1. 배경 & 문제 정의

현재 구현(`impl/0001-auth` ~ `impl/0015`) 은 Riot 의 "implicit grant redirect" (`response_type=token`) 를 전제로 `/api/auth/start` → Riot → `/api/auth/callback` 경로를 구축했다. 실제 가동 시 두 근본 결함이 드러났다:

1. **Riot 로그인 페이지는 3rd-party `redirect_uri` 로의 복귀를 Cloudflare / 지역 제한 / CAPTCHA 로 사실상 차단**한다. 공식 RSO 파트너가 아닌 도메인은 정상 경로로 못 돌아옴.
2. `response_type=token` 은 `access_token` 을 **URL fragment** 에 싣는데 이는 서버가 수신 불가. 이를 우회하려 `public/auth-helper.html` + `/api/auth/manual` (토큰 붙여넣기) 이 추가된 상태.

즉 **정상 동작하는 로그인 경로가 없고 개발자 수동 우회만 존재**. 본 spec 은 이를 OSS 레퍼런스(SkinPeek, ValorantStoreChecker, techchrism/valorant-api-docs 등)가 공통으로 쓰는 **직접 자격증명 프록시 + ssid 재인증** 패턴으로 전면 재설계한다.

---

## 2. 설계 결정 테이블

| # | 축 | 결정 | 근거 |
|---|---|---|---|
| A1 | PW 흐름 | **서버가 HTTPS 로 일시 수신 → Riot `/api/v1/authorization` 로 즉시 프록시 → 메모리 폐기**. 저장·로깅 금지. | CORS 로 브라우저 직접 호출 불가. 레퍼런스 OSS 공통 패턴. |
| B1 | MFA | **풀 지원** (이메일/앱 6자리 코드). `rememberDevice:true` 로 후속 재인증 최소화. | 본인 2FA 사용 중. 보안 권장. |
| C1 | 저장소 | **Supabase `user_tokens` 단일 vault** + 브라우저엔 불투명 `session_id` httpOnly cookie. | Phase 2 워커 요구 충족, cookie↔DB 이중 저장 부채 제거. |
| D1 | Region | **`kr` 하드코딩** | PRD § 2 Primary = KR. Phase 2 에서 PAS 확장 여지. |
| E1 | MFA 중간상태 | **암호화 `auth_pending` httpOnly cookie** (AES-GCM, 10분 TTL). 서버 stateless 유지. | Serverless 친화, Redis/DB 추가 불필요. |

---

## 3. ADR / PRD 변경 요약

| 문서 | 조치 | 내용 |
|---|---|---|
| ADR-0001 | 개정 | "PW 서버 절대 미경유" → "PW 서버 일시 경유 후 즉시 Riot 로 전달, 저장·로깅 금지". Alternatives 에 implicit-grant 기각 경위 추가. |
| ADR-0002 | 개정 | 하이브리드(cookie+vault) → **Supabase 단일 vault + session_id cookie**. Alternatives 갱신. |
| ADR-0010 | 신규 | mfa-pending-state-stateless-cookie (E1 결정 근거). |
| ADR-0011 | 신규 | riot-password-proxy-threat-model (§6 위협 모델). 포트폴리오 정직성 확보. |
| PRD § 6 | 수정 | Security 절을 A1/C1 에 맞춰 재작성. |
| PRD § 2 | 수정 | "본인 계정 시연·포트폴리오 배포" 명시 (ADR-0011 과 정합). |
| PRD § 5 FR-1 | 수정 | MFA 2-step 명시. |

---

## 4. 아키텍처

### 4-1. 모듈 경계

```
app/api/auth/
  login/route.ts          (신규) POST — 1차 (ID/PW → Riot)
  mfa/route.ts            (신규) POST — 2차 (MFA code → Riot)
  logout/route.ts         (수정) DELETE — session + DB row
  start/                  (삭제)
  callback/               (삭제)
  manual/                 (삭제)

app/(app)/login/page.tsx  (재작성) 2-step 상태머신 UI

lib/riot/
  auth-client.ts          (신규) Riot /api/v1/authorization 프록시
  cookie-jar.ts           (신규) tough-cookie 래퍼 (per-request)
  errors.ts               (확장) normalizeRiotError()
  auth.ts                 (축소) exchangeEntitlements/fetchPuuid 유지, URL builder 삭제
  fetcher.ts              (유지) DI 포트 (ADR-0006)

lib/session/
  store.ts                (신규) session_id ↔ user_tokens row 해석
  reauth.ts               (신규) ssid 로 access_token 재발급
  pending-jar.ts          (신규) MFA 중간 쿠키jar AES-GCM 암복호화
  crypto.ts               (확장) PENDING_ENC_KEY 분리

lib/supabase/
  user-tokens-repo.ts     (수정) 스키마 확장 (ssid_enc, session_id, tdid_enc, session_expires_at)

lib/middleware/
  rate-limit.ts           (신규) /api/auth/* 에 IP 레이트리밋

public/auth-helper.html   (삭제)
```

### 4-2. 경계 원칙

- `lib/riot/auth-client.ts` 는 Riot 과만 통신. 쿠키jar/HTTP만, 암호화·DB·세션 모름.
- `lib/session/*` 은 우리 쪽 세션. Riot 모름, DB/crypto만.
- Route handlers 는 둘을 오케스트레이션. 비즈니스 로직 없음.
- `lib/riot/storefront-server.ts` 는 `session.resolve()` 가 주는 토큰만 소비 — 기존 구조 최소 변경.

### 4-3. 로그인 flow (요약 시퀀스)

**정상 (2FA off):**
```
Browser -POST /api/auth/login {username,password}-> Server
Server -GET authorize?client_id=play-valorant-web-prod&...-> Riot  (jar 초기화, asid/clid/tdid 수신)
Server -PUT /api/v1/authorization {type:"auth",username,password,remember:true}-> Riot
Riot -> {type:"response", response.parameters.uri:"#access_token=..."} + Set-Cookie ssid
Server parse access_token
Server -GET /userinfo-> Riot -> {sub: PUUID}
Server -POST entitlements/api/token/v1-> Riot -> {entitlements_token}
Server upsert user_tokens by puuid, gen session_id
Server -> Set-Cookie session=<uuid>; 200 {ok:true, redirect:"/"}
```

**MFA (2FA on):**
```
1차 PUT 응답이 {type:"multifactor", email:"j***@..."}
Server encrypt(jar cookies) -> Set-Cookie auth_pending (10분)
Server -> 200 {status:"mfa_required", email_hint}
Browser MFA input -> POST /api/auth/mfa {code}
Server decrypt auth_pending -> jar 복원
Server -PUT /api/v1/authorization {type:"multifactor",code,rememberDevice:true}-> Riot
이후 userinfo/entitlements 동일 경로
Server clear auth_pending + Set-Cookie session
```

**재방문 (session cookie 있음):**
```
session.resolve(session_id):
  row 없음 -> null
  session_expires_at < now -> row 삭제 + null
  access_expires_at > now+60s -> 그대로 반환
  else -> reauthWithSsid(ssid_enc, tdid_enc):
    성공 -> UPDATE + 반환
    auth_failure -> row 삭제 + null
    5xx/timeout & access_token 아직 유효 -> 기존 반환 + 경고
```

### 4-4. DB 스키마

```sql
alter table user_tokens
  add column if not exists session_id uuid unique,
  add column if not exists session_expires_at timestamptz,
  add column if not exists ssid_enc text,
  add column if not exists tdid_enc text;

-- 기존 행 무효화 (이전 구현은 동작하지 않던 상태, 재로그인 강제)
delete from user_tokens;

-- NOT NULL 승격 (행 없는 상태에서 안전)
alter table user_tokens
  alter column session_id set not null,
  alter column session_expires_at set not null,
  alter column ssid_enc set not null;

create index if not exists user_tokens_session_id_idx on user_tokens (session_id);

-- RLS: service_role 전용
alter table user_tokens enable row level security;
-- 정책 미정의 = 기본 deny. service_role 은 RLS bypass.
```

**Rate limit 테이블 (C1 외 별도):**
```sql
create table if not exists rate_limit_buckets (
  bucket_key text primary key,       -- e.g. "login:1.2.3.4"
  count int not null,
  window_start timestamptz not null
);
```

### 4-5. Cookie 정의

| Cookie | 내용 | 속성 |
|---|---|---|
| `session` | session_id (UUIDv4, 불투명) | httpOnly, Secure, SameSite=Lax, Max-Age ≈ session_expires_at-now |
| `auth_pending` | AES-GCM(jar cookies + username + exp) | httpOnly, Secure, SameSite=Strict, Max-Age=600 |

### 4-6. 환경변수

| 키 | 용도 | 비고 |
|---|---|---|
| `TOKEN_ENC_KEY` | user_tokens 컬럼 암호화 | 32B base64 |
| `PENDING_ENC_KEY` | auth_pending cookie 전용 | 32B base64, TOKEN_ENC_KEY 와 분리 |
| `APP_ORIGIN` | CSRF Origin 검증 | 예: `https://valshop.vercel.app` |
| `SUPABASE_SERVICE_ROLE_KEY` | user_tokens RLS bypass | 기존 |
| `RIOT_CLIENT_VERSION` | Riot 헤더 | ADR-0005, 기존 |

**제거:** `RIOT_AUTH_REDIRECT_URI` (implicit grant 제거)

---

## 5. 에러 코드 (정규화)

```ts
type AuthErrorCode =
  | "invalid_credentials"    // Riot auth_failure
  | "mfa_required"           // 상태 분기 (에러 아님)
  | "mfa_invalid"            // multifactor_attempt_failed
  | "mfa_expired"            // auth_pending cookie 없음/만료
  | "rate_limited"           // Riot 429 / Cloudflare 1020 / 우리 서버 429
  | "riot_unavailable"       // 5xx / timeout
  | "session_expired"        // ssid reauth 실패
  | "unknown"
```

매핑은 `lib/riot/errors.ts` 의 `normalizeRiotError(raw)` 에 집중. 로그엔 원본+우리 코드, 응답엔 우리 코드만.

---

## 6. 보안 / 위협 모델 (ADR-0011 근거)

**PW 취급 불변식:**
- `const {username,password} = await req.json()` 범위 밖으로 **절대 전파 금지**. 구조화 로거 sanitizer 필수.
- `lib/logger.ts` 신규. `console.log` 금지 (eslint no-console error 레벨).
- 로그에서 `password` 문자열 필드 검출 시 `[REDACTED]` 치환.

**쿠키 / CSRF:**
- 모든 auth cookie Secure+HttpOnly. `session` Lax, `auth_pending` Strict.
- `/api/auth/login`, `/api/auth/mfa` 는 `Origin` 헤더 == `APP_ORIGIN` 검증. 불일치 403.

**CSP (강제):**
- `next.config.ts` `headers()` 에 `Content-Security-Policy: default-src 'self'; img-src 'self' https://media.valorant-api.com data:; style-src 'self' 'unsafe-inline'; connect-src 'self'`.

**Rate limit (우리 서버):**
- `/api/auth/login`: IP/분 5회
- `/api/auth/mfa`: IP/분 10회
- 초과 → 429 `{code:"rate_limited", retry_after:60}`
- 저장: `rate_limit_buckets` (Redis 대체, 비용 0 원칙)

**Rate limit (Riot 측):**
- 429 수신 시 재시도 금지 (우리 쪽 backoff X). 유저에게 즉시 표시.
- Phase 2 워커는 유저 간 200ms jitter + 순차 호출, 병렬 금지.

**정직한 위협:**
- `TOKEN_ENC_KEY` + `SUPABASE_SERVICE_ROLE_KEY` 동시 유출 시 전 유저 Riot 세션 탈취. 단일 failure point. 주의: Vercel env + Supabase key — 분리 provider.
- PW 메모리 덤프 공격은 Vercel serverless 특성상 비현실적. 수용.
- 세션 cookie 탈취(XSS): httpOnly + CSP 로 차단. React 기본 이스케이프 + dangerouslySetInnerHTML 금지.

---

## 7. Feature Requirements (각각 `/blueprint` 입력)

### FR-R1. DB 스키마 마이그레이션 + user-tokens-repo 확장

- **목적:** `user_tokens` 에 session_id / ssid_enc / tdid_enc / session_expires_at 컬럼 추가, 기존 행 삭제, `rate_limit_buckets` 테이블 생성.
- **인수조건:**
  - `supabase/migrations/*_auth_redesign.sql` 적용 후 `\d user_tokens` 가 본 spec § 4-4 스키마와 일치.
  - `lib/supabase/user-tokens-repo.ts` 에 `upsertTokens(puuid, tokens)`, `findBySessionId(id)`, `deleteBySessionId(id)`, `deleteByPuuid(puuid)` 노출.
  - 모든 함수는 service_role client 사용. anon 접근 테스트에서 모든 컬럼이 deny.
- **터치 파일:** `supabase/migrations/*_auth_redesign.sql` (신규), `lib/supabase/user-tokens-repo.ts` (수정), `lib/supabase/types.ts` (생성된 타입 반영).
- **테스트:**
  - 단위: repo 함수 4종 성공/없는 행 반환/중복 upsert (puuid 충돌 → 덮어쓰기).
  - RLS 통합(기존 wishlist 패턴): anon 클라이언트로 select → 권한 거부.
- **의존:** 없음. 최우선.

### FR-R2. lib/riot/auth-client + cookie-jar (Riot 프록시 레이어)

- **목적:** Riot `/api/v1/authorization`, `/userinfo`, entitlements, `authorize?prompt=none` 호출을 단일 책임 모듈로. 쿠키 jar 를 per-request 로 관리.
- **인수조건:**
  - `initAuthFlow(jar)` — GET authorize, jar 에 asid/clid/tdid 축적.
  - `submitCredentials(jar, {username,password})` → `{kind:"ok",accessToken} | {kind:"mfa",emailHint} | {kind:"invalid"} | {kind:"rate_limited"} | {kind:"upstream"}`.
  - `submitMfa(jar,code)` → 위와 유사 (mfa 분기 제외).
  - `reauthWithSsid(ssid,tdid?)` → `{kind:"ok",accessToken} | {kind:"expired"} | {kind:"upstream"}`.
  - `fetchPuuid(accessToken)`, `exchangeEntitlements(accessToken)` (기존 `auth.ts` 에서 이관).
  - 모든 외부 호출은 `createRiotFetcher()` DI (ADR-0006).
  - Timeout: 각 호출 3s (AbortController). 전체 login route 예산 p95 ≤ 3s.
- **터치 파일:** `lib/riot/auth-client.ts` (신규), `lib/riot/cookie-jar.ts` (신규), `lib/riot/auth.ts` (축소), `lib/riot/errors.ts` (확장: `normalizeRiotError`).
- **테스트:**
  - 단위 (mock fetcher): 각 함수별 happy/실패 분기 합쳐 ~15 case.
  - `normalizeRiotError` table-driven: Riot 응답 문자열 → 우리 enum.
- **의존:** 없음.

### FR-R3. lib/session (store + reauth + pending-jar + crypto 확장)

- **목적:** session_id 발급/해석/폐기. access_token 만료 시 ssid 로 투명 재발급. MFA 중간 jar 상태를 stateless cookie 로.
- **인수조건:**
  - `createSession(puuid, tokens): Promise<{sessionId, maxAge}>` — DB upsert + UUID 발급.
  - `resolve(sessionId): Promise<ResolvedSession | null>` — § 4-3 재방문 flow 전량 구현. 경합은 last-write-wins 수용.
  - `destroy(sessionId): Promise<void>` — DB row 삭제.
  - `encodePendingJar(jar, username): string` / `decodePendingJar(blob): {jar,username} | null` — AES-GCM + 10분 TTL 내장 (JWT-like exp 필드).
  - crypto.ts 에 `TOKEN_ENC_KEY` / `PENDING_ENC_KEY` 두 키 분리 로드. 잘못된 키로 복호화 시 null 반환.
- **터치 파일:** `lib/session/store.ts`, `lib/session/reauth.ts`, `lib/session/pending-jar.ts`, `lib/session/crypto.ts` (확장), `lib/session/types.ts` (`ResolvedSession`).
- **테스트:**
  - 단위: resolve 의 5 분기(miss/expired-session/fresh/reauth-ok/reauth-fail), pending-jar 왕복+만료+키불일치.
  - 통합: 실 Supabase 에서 createSession → resolve → destroy 한 사이클.
- **의존:** FR-R1 (DB), FR-R2 (reauth 가 auth-client 사용).

### FR-R4. Route handlers (/api/auth/login, /mfa, /logout) + 미들웨어

- **목적:** HTTP 진입점. auth-client + session 을 엮어 실제 동작.
- **인수조건:**
  - `POST /api/auth/login` body `{username,password}` → 200 `{ok:true}` | 200 `{status:"mfa_required",email_hint}` | 4xx `{code:AuthErrorCode}`.
  - `POST /api/auth/mfa` body `{code}` (auth_pending cookie 필요) → 200 `{ok:true}` | 4xx `{code}`.
  - `DELETE /api/auth/logout` → 200, session cookie clear, DB row 삭제.
  - 모든 엔드포인트 Origin 검증 + rate-limit 미들웨어 통과.
  - 응답/로그에 password 문자열 부재 (smoke check).
- **터치 파일:** `app/api/auth/login/route.ts`, `/mfa/route.ts`, `/logout/route.ts`, `lib/middleware/rate-limit.ts`, `lib/middleware/origin-check.ts`.
- **테스트:**
  - 통합 (MSW 로 Riot stub + 실 Supabase test project):
    - login 2FA-off happy → DB row + session cookie + PW 누수 없음.
    - login 2FA-on → auth_pending cookie 내용 암호화 검증 + 10분 TTL.
    - mfa happy → auth_pending 소비 + DB row.
    - Origin 불일치 → 403.
    - 6회 연속 → 429.
    - logout → DB 삭제 + cookie clear.
- **의존:** FR-R1, FR-R2, FR-R3.

### FR-R5. 로그인 UI (app/(app)/login 재작성)

- **목적:** 2-step 상태머신 UI (credential → mfa). 에러 코드별 문구. fan-made 고지 배너.
- **인수조건:**
  - 첫 step: username/password 입력. 제출 시 `/api/auth/login` POST.
  - mfa_required 응답 시 UI 가 MFA step 으로 전환, email_hint 표시.
  - 에러 코드별 inline 메시지(§ 5 enum 7종).
  - 상단 고정 배너: "VAL-Shop 은 라이엇 공식 서비스 아님 / 본인 계정 시연용 / 2FA 권장" (PRD § 2, ADR-0011).
  - 로그인 성공 → `window.location="/"`.
- **터치 파일:** `app/(app)/login/page.tsx` (재작성), `app/(app)/login/credential-form.tsx` (신규), `app/(app)/login/mfa-form.tsx` (신규), `app/(app)/login/notice-banner.tsx` (신규).
- **테스트:**
  - Playwright 스모크 1: 로그인 폼 → MSW로 Riot mfa 응답 stub → MFA 입력 → 대시보드 진입.
  - 단위(React): 각 form 컴포넌트 prop-driven 렌더.
- **의존:** FR-R4 (엔드포인트 계약 고정).

### FR-R6. 레거시 제거

- **목적:** 동작 안 하는 구경로 및 dev 우회 제거.
- **인수조건:**
  - 아래 파일 삭제: `app/api/auth/start/`, `app/api/auth/callback/`, `app/api/auth/manual/`, `public/auth-helper.html`.
  - `lib/riot/auth.ts` 의 `buildRiotAuthorizeUrl` 삭제, `exchangeAccessTokenForEntitlements`/`fetchPuuid` 는 `auth-client.ts` 로 이동(재export 금지).
  - `.env.example` 에서 `RIOT_AUTH_REDIRECT_URI` 제거, `PENDING_ENC_KEY` + `APP_ORIGIN` 추가.
  - `grep -rn auth-helper public/` = 0. `grep -rn buildRiotAuthorizeUrl` = 0.
- **터치 파일:** 위 + `.env.example`, 필요시 README.
- **테스트:** typecheck + lint 통과만. 상위 FR-R4/R5 테스트가 회귀 보증.
- **의존:** FR-R4, FR-R5 (새 경로 동작 확인 후).

### FR-R7. 보안 마감 (CSP + logger + rate-limit 통합)

- **목적:** § 6 보안 항목을 단일 완료점으로.
- **인수조건:**
  - `lib/logger.ts`: debug/info/warn/error. password, access_token, ssid, entitlements 키 자동 마스킹.
  - `next.config.ts` `headers()` 에 CSP header 추가(§ 6 policy).
  - `console.log` 전면 금지 (eslint `no-console: error`). 기존 auth 관련 `console.log` 는 logger 로 치환.
  - `/api/auth/*` 에 rate-limit 미들웨어 적용(FR-R4 에 이미 있음, 여기선 typecheck + 통합 검증).
- **터치 파일:** `lib/logger.ts`, `next.config.ts`, `.eslintrc*`, 기존 `console.log` 사용처.
- **테스트:**
  - 단위: logger 가 sensitive 필드 마스킹.
  - 통합: 로그인 통합 테스트에서 Vercel log 모사 출력에 password 부재(smoke assertion).
  - E2E: CSP 위반 콘솔 에러 0 (Playwright).
- **의존:** FR-R4.

---

## 8. `/blueprint-all` 권장 실행 순서 및 의존 그래프

```
FR-R1 ──┬─► FR-R3 ──┐
FR-R2 ──┴──────────►┴─► FR-R4 ──┬─► FR-R5 ──► FR-R6
                                └─► FR-R7
```

병렬 그룹:
1. **G1 (독립):** FR-R1, FR-R2
2. **G2 (G1 의존):** FR-R3
3. **G3 (G2 의존):** FR-R4
4. **G4 (G3 의존, 상호독립):** FR-R5, FR-R7
5. **G5 (G4 완료):** FR-R6

`/blueprint-all` 입력은 FR-R1~R7 을 순서대로 나열 + 각 plan 번호는 0018~0024 로 예약 (impl 시 번호 확정).

---

## 9. 알려진 제약 / 미래 작업

- **reauth 동시성 race**: 같은 session_id 로 두 요청이 동시에 `resolve()` 호출 → Riot 에 2회 reauth → ssid rotate 로 둘 중 하나 실패. MVP 수용(간단 retry). Phase 2 에서 Postgres advisory lock 검토.
- **`TOKEN_ENC_KEY` 수동 rotate 시** 전 유저 재로그인 강제(해독 불가 → null 반환 → 강제 /login). 자동 rotation out-of-scope.
- **Region PAS 자동감지** 미구현 (D1). 타 리전 유저 로그인 시 storefront 에러. UI에 region 미노출 = 본인 KR 계정 시연 전제.
- **Riot 차단 리스크**: 비공식 엔드포인트는 언제든 Riot 이 차단 가능 (ADR-0001 consequences). 차단 시 서비스 중단 공지 외 대응 불가.
- **Phase 2 워커**는 본 spec 범위 밖. 단 `user_tokens` 단일 vault 가 선결 조건이라 본 redesign 이 끝나면 기존 plan 0008 은 그대로 이어질 수 있음.

---

## 10. Non-goals (이번 재설계에서 명시적으로 안 함)

- 다중 세션 / 디바이스별 세션 분리 (1 puuid = 1 활성 session)
- 공식 RSO 이행
- Region 드롭다운 / 자동감지
- 이메일/이름 등 PUUID 외 PII 수집·저장
- PW 강도 검증 (Riot 이 함)
- Captcha bypass / Cloudflare 우회 (오히려 레퍼런스 코드가 걸린다면 본 설계 전면 재검토)

---

## 11. Amendment (2026-04-24 저녁) — α′ 정정

### 배경

초안 작성 후 techchrism valapidocs 와 4 개 OSS 레퍼런스(SkinPeek, staciax, Bbalduzz, ruzbyte) 의 **실제 auth 코드** 를 뜯어서 교차 검증한 결과, 본 spec 의 몇 가지 가정이 틀렸음을 확인하고 계약을 정정함. 큰 그림(A1~E1) 은 유지, 세부 스키마만 교정.

### 틀린 가정 & 정정

| 항목 | 초안 (틀림) | 실제 (정정) | 근거 |
|---|---|---|---|
| Preflight 메서드 | `GET authorize?...` | **`POST /api/v1/authorization`** JSON body | techchrism `auth-cookies` 엔드포인트 + staciax `auth.py` |
| 1차 요청 body | `{type:"auth", username, password, remember}` | **동일 (flat)** | staciax/Bbalduzz/SkinPeek 모두 flat. techchrism 최신 doc 의 `riot_identity:{captcha,...}` 중첩 스키마는 **웹 브라우저 로그인 페이지 경로 전용**이며, 데스크톱 클라이언트 사칭 경로는 여전히 flat 구 스키마로 동작. |
| Captcha 필요 여부 | 필수로 오인 | **불필요** (데스크톱 클라이언트 사칭 경로) | 4 개 OSS 봇 모두 captcha 필드 없이 동작 중 (2026-02 기준 staciax commit 활성) |
| 성공 응답 | `response.parameters.uri` fragment | **동일** | staciax 는 정규식 `access_token=(...).*id_token=(...).*expires_in=(\d+)` 로 파싱. techchrism 신규 `login_token` 스키마는 쓰이지 않음. |
| MFA 요청 body | `{type:"multifactor", code, rememberDevice}` | **동일 (flat)** | staciax/Bbalduzz. techchrism 의 `{multifactor:{otp,rememberDevice}}` 중첩은 신규 스키마. |
| PUUID 획득 | `GET /userinfo` 별도 호출 | **access_token JWT claim `sub` 파싱 (1 HTTP 호출 절약)** | SkinPeek/ruzbyte 공통. userinfo 는 region 정보 등 추가 필드 필요할 때만. |

### 신규 필수 요건: 데스크톱 클라이언트 사칭

**User-Agent (고정 문자열, 환경변수 `RIOT_CLIENT_USER_AGENT`):**
```
RiotClient/60.0.6.4770705.4749685 rso-auth (Windows;10;;Professional, x64)
```
(ADR-0005 의 `RIOT_CLIENT_VERSION` 과 구분. UA 는 로그인용, clientVersion 은 storefront 헤더용.)

**TLS ciphers (Node `https.Agent`):** staciax 의 `FORCED_CIPHERS` 그대로 차용. `minVersion: 'TLSv1.3'`. Cloudflare 의 JA3 fingerprinting 을 Riot 공식 데스크톱 클라이언트와 유사하게 통과시키는 것이 목적.

```ts
const FORCED_CIPHERS = [
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA256',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'ECDHE-ECDSA-AES128-SHA256',
  'ECDHE-ECDSA-AES128-SHA',
  'ECDHE-ECDSA-AES256-SHA',
  'ECDHE+AES128',
  'ECDHE+AES256',
  'ECDHE+3DES',
  'RSA+AES128',
  'RSA+AES256',
  'RSA+3DES',
].join(':');
```

**리스크:** Node.js 의 TLS stack 은 OpenSSL 기반이라 cipher list + TLSv1.3 강제까지는 확실히 되지만, JA3 는 cipher 외에 extensions 순서/GREASE 도 포함 — Node 에서 100% 동일 fingerprint 는 불가. 실전 검증(로그인 1회 시도) 으로 Cloudflare 통과 여부 즉시 판정. 실패 시 § 11 fallback 으로.

### Fallback (α″): TLS 사칭 실패 시

Vercel serverless 에서 cipher 제어만으로 Cloudflare 를 못 뚫는 경우가 확인되면, 배포 경로는 **A1″ (ssid 수동 붙여넣기)** 로 축소. 구현 영향:

- plan 0019 `submitCredentials`/`submitMfa` 는 코드 유지하되 **기본 비활성**, dev env 에서만 동작.
- plan 0022 UI 는 credential 폼 숨기고 "Riot Client 에서 ssid 추출해 붙여넣기" 안내 + ssid 입력 텍스트박스. README 에 devtools 가이드.
- PRD § 2 에 "본인 계정 시연 전용 배포" 명시. 포트폴리오 정직성 확보.
- 그 외 (session/reauth/storefront/wishlist) 는 ssid 가 확보된 시점부터 완전히 동일하게 동작.

α′ 실패 판정 기준 = **본인 계정으로 `/api/auth/login` 3회 시도 시 모두 Cloudflare challenge 반환**. 이 경우 즉시 α″ 로 rollback (plan 0022 텍스트 변경 + 엔드포인트 enable 플래그 off).

### 영향받는 plan 파일

- **plan 0019**: request/response 스키마 정정 (본 § 11 에 맞춰), `RIOT_CLIENT_USER_AGENT` + `FORCED_CIPHERS` 명시, JWT 파싱으로 puuid 획득(userinfo 호출 제거).
- **plan 0020**: 영향 없음. SessionPayload/store/reauth 동일.
- **plan 0021**: env 에 `RIOT_CLIENT_USER_AGENT` 추가 (기존 `RIOT_CLIENT_VERSION` 과 병존). 응답 스키마 변경 없음.
- **plan 0022**: 영향 없음 (서버 응답 계약 불변).
- **plan 0018/0023/0024**: 영향 없음.

### 검증 절차 (배포 전 필수)

1. 로컬 `npm test` 에 staciax 의 실제 응답 body sample 을 fixture 로 추가하여 파싱 검증.
2. 로컬에서 본인 계정 1회 로그인 smoke → Cloudflare 통과 확인.
3. Vercel preview deploy 후 동일 계정 재현 → serverless 환경에서도 TLS 사칭 유효 확인.
4. 3 중 실패 시 α″ 로 1h 내 rollback (feature flag `NEXT_PUBLIC_AUTH_MODE=manual-ssid`).
