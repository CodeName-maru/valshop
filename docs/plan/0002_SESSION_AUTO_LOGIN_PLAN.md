# Plan 0002: 세션 유지 및 자동 로그인 (토큰 암호화 저장)

<!-- Cross-plan 정합성 감사(2026-04-23) 반영: 본 Plan 을 세션/토큰/crypto/user_tokens 계약의 단일 소스로 승격. 0001/0003/0005/0006/0007/0008 이 본 plan 의 export 를 소비. -->

## 개요

PRD FR-2 / AC-2 를 만족시키기 위해, 최초 로그인 이후 브라우저에 **AES-GCM 암호화된 Riot 토큰 묶음(access_token / refresh_token / entitlements_jwt / puuid / expires_at / region)** 을 **httpOnly + SameSite=Lax + Secure cookie** 로 보관하고, 2회차 방문 시 SSR 단계에서 cookie 를 복호화하여 자동으로 `/dashboard` 를 렌더한다. 범위는 MVP 에 한정되며, 서버측 Supabase vault 는 Phase 2 확장 포인트로 인터페이스만 정의한다. TDD (Vitest + MSW + @testing-library/react + Playwright, ADR-0006) 로 진행한다.

## 제공 계약 (다른 plan 이 import)

본 Plan 은 세션 / 토큰 암호화 / `user_tokens` 테이블 DDL 의 **단일 소스 오브 트루스**이다. Plan 0001 / 0003 / 0005 / 0006 / 0007 / 0008 은 아래 export 만 참조한다 (중복 정의 금지).

### 모듈 시그니처

```ts
// lib/crypto/aes-gcm.ts — low-level primitives
export function loadKey(envVarName: string): Promise<CryptoKey>;
export function encryptBytes(bytes: Uint8Array, key: CryptoKey): Promise<Uint8Array>;
export function decryptBytes(bytes: Uint8Array, key: CryptoKey): Promise<Uint8Array>;

// lib/session/types.ts — session payload 계약
export type SessionPayload = {
  puuid: string;
  accessToken: string;
  refreshToken: string;
  entitlementsJwt: string;
  expiresAt: number; // unix seconds
  region: string;    // kr, na, eu, ap 등
};

// lib/session/cookie.ts — cookie 왕복
export const SESSION_COOKIE: "session";
export function encryptSession(payload: SessionPayload): Promise<string>;
export function decryptSession(raw: string): Promise<SessionPayload>;
export function buildSessionCookie(payload: SessionPayload): ResponseCookie;
export function buildLogoutCookie(): ResponseCookie;
export function readSessionFromCookies(): Promise<SessionPayload | null>;

// lib/session/guard.ts — server component / route handler 가드
export function requireSession(): Promise<SessionPayload>; // 없으면 redirect('/login')
export function getSession(): Promise<SessionPayload | null>; // nullable 별칭

// lib/vault/token-vault.ts — Phase 2 포트 (MVP 는 NoopTokenVault 만)
export interface TokenVault {
  save(userId: string, payload: SessionPayload): Promise<void>;
  load(userId: string): Promise<SessionPayload | null>;
  delete(userId: string): Promise<void>;
}
export class NoopTokenVault implements TokenVault { /* resolves w/o side effect */ }
```

### 소유 DDL

| 파일 | 소유 범위 | 소비 plan |
|------|-----------|-----------|
| `supabase/migrations/0001_user_tokens.sql` | `user_tokens` 테이블 DDL + RLS owner-only 정책 | 0007 (FK 참조), 0008 (ALTER 컬럼 추가) |

**`user_tokens` 스키마**:

```sql
create table public.user_tokens (
  user_id uuid primary key,
  puuid text not null,
  access_token_enc bytea not null,
  refresh_token_enc bytea not null,
  entitlements_jwt_enc bytea not null,
  expires_at timestamptz not null,
  region text not null,
  needs_reauth boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.user_tokens enable row level security;
create policy user_tokens_owner_select on public.user_tokens
  for select using (auth.uid() = user_id);
create policy user_tokens_owner_modify on public.user_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

> **주의**: MVP 는 `NoopTokenVault` 만 바인딩. Supabase 어댑터(`SupabaseTokenVault`)는 별도 Phase 2 plan 이 소유하지만, 테이블 DDL 은 본 Plan 이 Phase 7 에서 소유·발행한다 (0007 FK, 0008 ALTER 의 선행 조건).

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 저장 위치 (MVP) | httpOnly + SameSite=Lax + Secure cookie (`session` 1개, AES-GCM 암호문 base64url) | ADR-0002 Option A. Security NFR (XSS 로 JS 가 읽을 수 없음 + AES-GCM 이중 방어) + Performance NFR (SSR 에서 cookie 자동 전송, 추가 RTT 없음) |
| 암호화 알고리즘 | AES-256-GCM, 12-byte random IV, 16-byte auth tag, payload = `iv \|\| ciphertext \|\| tag` base64url 인코딩 | Web Crypto API 로 외부 의존 0, authenticated encryption → 무결성 확보 (Security) |
| 키 관리 | `TOKEN_ENC_KEY` = 32 byte base64 문자열, Vercel 환경변수. 런타임에 `crypto.subtle.importKey` 로 로드. 서버 전용 | Security NFR (키 브라우저 노출 금지). Cost NFR ($0 — KMS 미사용). `.env.example` 에 키 명시 |
| Cookie 이름 / 속성 | `session`; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<expires_at - now>` | SameSite=Lax 가 기본 CSRF 방어 (Security). Lax 는 자동 로그인의 top-level navigation 에 GET cookie 전송 허용 → AC-2 충족 |
| Cookie 크기 예산 | 암호문 ≤ 3.5 KB (payload JSON 압축 후 AES) — 4 KB 브라우저 한도 내 | ADR-0002 Consequences. 초과 시 refresh_token 우선 드롭 후 재인증 유도 |
| 세션 만료 정책 | access_token 의 JWT `exp` claim 을 그대로 `expires_at` 으로 사용. cookie Max-Age = `expires_at - now`. 만료 시 `/api/auth/start` 로 redirect (FR-6) | Security NFR (서버와 클라 만료 동기화). MVP 는 refresh_token 자동 갱신 미구현 — Phase 2 로 연기 |
| SSR 자동 로그인 흐름 | `app/(app)/dashboard/page.tsx` 가 server component 로 `cookies().get('session')` → `decryptSession()` → 실패 시 `redirect('/login')`, 성공 시 토큰을 Store Proxy 에 주입 | Performance NFR (TTI ≤ 3s: 단일 SSR 패스, 클라이언트 JS 리다이렉트 round-trip 제거) |
| 재인증 트리거 | (a) cookie 부재, (b) 복호화 실패, (c) `exp < now`, (d) Store Proxy 에서 Riot 401 수신 시 클라이언트 측 `location.replace('/api/auth/start')` | FR-6 정합. Security NFR (만료·변조 모두 같은 경로로 닫음) |
| 로그아웃 정책 | `/api/auth/logout` → `Set-Cookie: session=; Max-Age=0` + (Phase 2) vault row 삭제. 응답 후 `/login` 리다이렉트 | FR-5. Security NFR (즉시 파기). Compliance (PIPA 최소수집 — 탈퇴 즉시 토큰 소각) |
| Phase 2 확장 포인트 | `TokenVault` 포트 인터페이스 (`save/load/delete`) 를 `lib/domain/token-vault.ts` 에 선언. MVP 는 no-op 구현, Phase 2 는 Supabase 어댑터 주입 | Maintainability NFR (포트-어댑터, ARCHITECTURE §6.1). 마이그레이션 시 cookie 경로 재사용 |
| FR-1 (Plan 0001) 계약 | `/api/auth/callback` 이 토큰 교환 성공 후 본 Plan 의 `encryptSession()` + `buildSessionCookie()` 를 **호출**하여 `Set-Cookie` 만 셋업. Plan 0001 은 Riot 교환 로직, Plan 0002 는 저장·복원 로직 | 가정사항 §A1 참조. 파일 충돌 방지 위해 callback route 는 0001 이 소유, 0002 는 lib 제공만 |
| 테스트 전략 | critical-path Vitest 로 crypto 왕복 + SSR cookie 복호화 경로 + logout cookie clear. E2E Playwright 로 2회차 방문 smoke 1개 (AC-2 직접 검증) | Maintainability NFR (critical path 만). ADR-0006 스택 |
| Cookie 파싱/설정 위치 | `lib/session/cookie.ts` (Next 15 `cookies()` wrapper) | Architecture §2 레이아웃 유지. Route Handler / Server Component 양쪽 재사용 |

## 가정사항

- **A1 (FR-1 인터페이스 계약)**: Plan 0001 이 `app/api/auth/callback/route.ts` 에서 Riot 토큰 교환을 수행한 뒤, 본 Plan 이 제공하는 `encryptSession(payload: SessionPayload): Promise<string>` 및 `buildSessionCookie(payload: SessionPayload): ResponseCookie` 를 **import** 해 `Set-Cookie` 를 구성한다. `SessionPayload` 타입은 본 Plan (`lib/session/types.ts`) 에서 정의하며 `{ puuid, accessToken, refreshToken, entitlementsJwt, expiresAt, region }` 으로 고정. Plan 0001 의 callback route 파일은 **본 Plan 이 수정하지 않는다** — lib export 만 제공.
- **A1b (Logout route 소유권)**: `app/api/auth/logout/route.ts` 는 **Plan 0005 가 소유**한다. 본 Plan 은 `buildLogoutCookie()` export 만 제공하며, 0005 는 이를 import 해 응답에 붙인다. 본 Plan 은 logout route 파일을 생성/수정하지 않는다.
- **A2**: `TOKEN_ENC_KEY` 환경변수는 개발자가 수동으로 `openssl rand -base64 32` 로 생성하여 `.env.local` / Vercel 에 세팅한다. 본 Plan 에서는 `.env.example` 에 키 이름만 추가.
- **A3**: Riot access_token 은 JWT 이며 `exp` claim (unix seconds) 을 담는다고 가정. 만약 non-JWT opaque token 이면 Plan 0001 이 교환 응답의 `expires_in` 을 `expiresAt = Date.now()/1000 + expires_in` 으로 변환하여 넘긴다.
- **A4**: MVP 는 refresh 흐름 미구현. access_token 만료 (기본 Riot 1h) 시 유저는 재로그인한다. 이는 PRD FR-6 "토큰 만료 감지 시 자동 재로그인" 과 정합.
- **A5**: Phase 2 Supabase 어댑터(`SupabaseTokenVault`) 구현은 본 Plan 범위 밖 (별도 plan). 단 **`user_tokens` 테이블 DDL 과 RLS 정책은 본 Plan 이 소유** (Phase 7) — 0007 의 FK, 0008 의 ALTER 가 이를 참조. `TokenVault` 포트 인터페이스·MVP `NoopTokenVault` 는 본 Plan 이 선언·바인딩.
- **A6**: 테스트 시 `TOKEN_ENC_KEY` 는 `tests/setup/env.ts` 에서 고정값 주입 (deterministic). 운영 키는 절대 테스트에 사용하지 않는다.
- **A7**: Next.js 15 App Router 의 async `cookies()` API 를 사용한다 (Next 14 sync 대비 호환 이슈 없음).

---

## Phase 1: Crypto Module — AES-GCM 왕복

### 테스트 시나리오

#### Test 1-1: AES-GCM 암복호화 왕복이 원본과 일치한다
```ts
// tests/critical-path/session-crypto.test.ts
it("givenValidKey_whenEncryptThenDecrypt_thenPayloadMatches", async () => {
  // Given: 32-byte 키 + SessionPayload fixture
  process.env.TOKEN_ENC_KEY = base64(randomBytes(32));
  const payload: SessionPayload = { puuid: "p1", accessToken: "a.b.c", refreshToken: "r", entitlementsJwt: "e", expiresAt: 1800000000 };
  // When
  const enc = await encryptSession(payload);
  const dec = await decryptSession(enc);
  // Then
  expect(dec).toEqual(payload);
});
```

#### Test 1-2: 암호문이 결정적이지 않다 (IV 랜덤)
```ts
it("givenSamePayload_whenEncryptTwice_thenDifferentCiphertext", async () => {
  // Given/When
  const a = await encryptSession(payload);
  const b = await encryptSession(payload);
  // Then
  expect(a).not.toBe(b);
});
```

#### Test 1-3: 변조된 암호문 복호화 시 예외
```ts
it("givenTamperedCiphertext_whenDecrypt_thenThrows", async () => {
  // Given
  const enc = await encryptSession(payload);
  const tampered = flipLastChar(enc);
  // When / Then
  await expect(decryptSession(tampered)).rejects.toThrow(/decrypt/i);
});
```

#### Test 1-4: 잘못된 키 길이 → import 시점 명확 예외
```ts
it("givenShortKey_whenEncrypt_thenThrowsKeyError", async () => {
  process.env.TOKEN_ENC_KEY = base64(randomBytes(16)); // 128-bit, 본 Plan 은 256-bit 요구
  await expect(encryptSession(payload)).rejects.toThrow(/TOKEN_ENC_KEY/);
});
```

### 구현 항목

**파일**: `lib/crypto/aes-gcm.ts`
- `loadKey(): Promise<CryptoKey>` — `TOKEN_ENC_KEY` base64 디코드 → `crypto.subtle.importKey('raw', ..., {name:'AES-GCM'}, false, ['encrypt','decrypt'])`. 32 byte 검증.
- `encryptBytes(plaintext: Uint8Array): Promise<Uint8Array>` — 12-byte random IV, `iv || ct||tag` 반환.
- `decryptBytes(payload: Uint8Array): Promise<Uint8Array>`.
- base64url 헬퍼.

**파일**: `lib/session/encode.ts`
- `SessionPayload` 타입 (A1 계약).
- `encryptSession(p: SessionPayload): Promise<string>` — JSON.stringify → TextEncoder → `encryptBytes` → base64url.
- `decryptSession(enc: string): Promise<SessionPayload>` — 역순. 스키마 검증 (zod 또는 수동).

---

## Phase 2: Cookie Handler — Set / Read / Clear

### 테스트 시나리오

#### Test 2-1: `buildSessionCookie` 가 httpOnly·Secure·SameSite=Lax 속성을 세팅한다
```ts
it("givenEncAndExp_whenBuildCookie_thenSecureFlagsSet", () => {
  // When
  const c = buildSessionCookie("cipher", 1800000000);
  // Then
  expect(c).toMatchObject({ name: "session", value: "cipher", httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  expect(c.maxAge).toBeGreaterThan(0);
});
```

#### Test 2-2: 과거 expiresAt 은 maxAge=0 으로 즉시 만료
```ts
it("givenPastExp_whenBuildCookie_thenMaxAgeZero", () => {
  const c = buildSessionCookie("cipher", 1000);
  expect(c.maxAge).toBe(0);
});
```

#### Test 2-3: `readSessionFromCookies` 는 없으면 null, 있으면 payload
```ts
it("givenNoCookie_whenRead_thenNull", async () => {
  mockCookies([]);
  expect(await readSessionFromCookies()).toBeNull();
});
it("givenValidCookie_whenRead_thenPayload", async () => {
  const enc = await encryptSession(payload);
  mockCookies([{ name: "session", value: enc }]);
  expect(await readSessionFromCookies()).toEqual(payload);
});
```

#### Test 2-4: 복호화 실패 시 null 반환 (재로그인 유도)
```ts
it("givenCorruptCookie_whenRead_thenNull", async () => {
  mockCookies([{ name: "session", value: "garbage" }]);
  expect(await readSessionFromCookies()).toBeNull();
});
```

#### Test 2-5: `buildLogoutCookie` 는 값 공백 + Max-Age 0
```ts
it("whenBuildLogoutCookie_thenExpiredImmediately", () => {
  const c = buildLogoutCookie();
  expect(c).toMatchObject({ name: "session", value: "", maxAge: 0 });
});
```

### 구현 항목

**파일**: `lib/session/cookie.ts`
- `SESSION_COOKIE = "session"` 상수.
- `buildSessionCookie(enc: string, expiresAt: number): ResponseCookie` — maxAge 계산 (`max(expiresAt - now, 0)`).
- `readSessionFromCookies(): Promise<SessionPayload | null>` — Next `cookies()` → `decryptSession` try/catch → null on any error (로그는 남김).
- `buildLogoutCookie(): ResponseCookie`.

---

## Phase 3: Dashboard SSR Auto-Login Gate

### 테스트 시나리오

#### Test 3-1: cookie 없으면 `/login` 으로 redirect
```ts
// tests/critical-path/dashboard-gate.test.ts
it("givenNoSessionCookie_whenRenderDashboard_thenRedirectToLogin", async () => {
  mockCookies([]);
  await expect(DashboardPage()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT;/login") });
});
```

#### Test 3-2: 유효 cookie → 상점 렌더 props 에 puuid 주입
```ts
it("givenValidSession_whenRenderDashboard_thenCallsStoreProxyWithPuuid", async () => {
  const enc = await encryptSession({ ...payload, puuid: "abc" });
  mockCookies([{ name: "session", value: enc }]);
  const fetchStore = vi.fn().mockResolvedValue([/* 4 skins */]);
  const html = await renderToString(await DashboardPage({ fetchStore }));
  expect(fetchStore).toHaveBeenCalledWith(expect.objectContaining({ puuid: "abc" }));
  expect(html).toContain('data-testid="skin-card"');
});
```

#### Test 3-3: 만료된 cookie (exp < now) → `/login?error=expired`
```ts
it("givenExpiredSession_whenRenderDashboard_thenRedirectWithErrorCode", async () => {
  const enc = await encryptSession({ ...payload, expiresAt: 1000 });
  mockCookies([{ name: "session", value: enc }]);
  await expect(DashboardPage()).rejects.toMatchObject({ digest: expect.stringContaining("/login?error=expired") });
});
```

### 구현 항목

**파일**: `app/(app)/dashboard/page.tsx`
- Server component. `const session = await readSessionFromCookies(); if (!session) redirect('/login')`.
- `if (session.expiresAt * 1000 < Date.now()) redirect('/login?error=expired')`.
- Store Proxy 호출부는 Plan 0003 (store) 이 채운다 — 본 Plan 은 session 게이팅까지 + stub 주입.

**파일**: `lib/session/guard.ts`
- `requireSession(): Promise<SessionPayload>` — 위 로직을 server component 에서 재사용하기 위한 헬퍼. 없거나 만료 시 `redirect('/login')`.
- `getSession(): Promise<SessionPayload | null>` — nullable 별칭. 다수 plan (0003/0005/0006 등) 이 "존재 확인 후 분기" 패턴에서 직접 import 한다. 내부 구현은 `readSessionFromCookies` 위임 + 만료 시 null 반환.

---

## Phase 4: Logout Route

### 테스트 시나리오

#### Test 4-1: POST `/api/auth/logout` → 302 `/login` + `Set-Cookie: session=; Max-Age=0`
```ts
// tests/critical-path/logout-route.test.ts
it("whenPostLogout_thenClearsCookieAndRedirects", async () => {
  await testApiHandler({
    appHandler: logoutHandler,
    test: async ({ fetch }) => {
      const res = await fetch({ method: "POST" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
      const sc = res.headers.get("set-cookie")!;
      expect(sc).toMatch(/session=;/);
      expect(sc).toMatch(/Max-Age=0/i);
      expect(sc).toMatch(/HttpOnly/i);
    }
  });
});
```

#### Test 4-2: 인증되지 않은 상태에서도 멱등 (이중 로그아웃)
```ts
it("givenNoCookie_whenPostLogout_thenStill302AndClearSet", async () => { /* same assertions */ });
```

### 구현 항목

**파일**: `app/api/auth/logout/route.ts`
- `export async function POST()`: `const res = NextResponse.redirect(new URL('/login', req.url), 302); res.cookies.set(buildLogoutCookie()); return res`.
- (Phase 2 hook) `TokenVault.delete(puuid)` 호출 지점 주석 마킹.

---

## Phase 5: E2E Smoke — AC-2 직접 검증

### 테스트 시나리오

#### Test 5-1: 2회차 방문 시 입력 없이 `/dashboard` 가 뜬다
```ts
// tests/e2e/auto-login.spec.ts
test("givenFirstLoginCompleted_whenSecondVisit_thenDashboardRendersWithoutInput", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Given: seed cookie directly (Riot mocked via MSW at fixture level)
  await seedSessionCookie(ctx, { puuid: "p1", expiresAt: Date.now()/1000 + 3600 });
  // When
  await page.goto("/dashboard");
  // Then
  await expect(page.locator('[data-testid="skin-card"]')).toHaveCount(4);
  // 추가 검증: 로그인 버튼/PW 입력 필드 없음
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
```

### 구현 항목

**파일**: `tests/e2e/auto-login.spec.ts`
- `seedSessionCookie` 헬퍼 (`lib/session/encode.ts` 재사용).
- Playwright MSW 핸들러로 storefront / valorant-api 모킹 (ADR-0006).

**파일**: `tests/setup/seed-session.ts`
- E2E 에서 cookie 를 직접 굽는 헬퍼.

---

## Phase 6: Phase 2 확장 포인트 (인터페이스만)

### 테스트 시나리오

#### Test 6-1: `NoopTokenVault` 는 모든 메서드가 resolve 한다
```ts
it("whenNoopVaultCalled_thenResolvesWithoutSideEffect", async () => {
  const v = new NoopTokenVault();
  await expect(v.save("p", payload)).resolves.toBeUndefined();
  await expect(v.load("p")).resolves.toBeNull();
  await expect(v.delete("p")).resolves.toBeUndefined();
});
```

### 구현 항목

**파일**: `lib/domain/token-vault.ts`
- `interface TokenVault { save(puuid, payload): Promise<void>; load(puuid): Promise<SessionPayload|null>; delete(puuid): Promise<void> }`.
- `class NoopTokenVault implements TokenVault` (MVP 기본 바인딩).

**파일**: `.env.example`
- `TOKEN_ENC_KEY=<base64 32 bytes, generate via: openssl rand -base64 32>` 추가.

---

## NFR 반영

| 카테고리 | 목표 | 본 Plan 반영 | 관련 테스트 |
|---|---|---|---|
| Performance | TTI ≤ 3s (자동 로그인 포함) | SSR 단계에서 cookie 복호화 후 바로 Store 렌더 → 클라이언트 JS redirect RTT 제거; AES-GCM 복호화 < 1ms; cookie 크기 ≤ 3.5 KB 로 전송 오버헤드 최소 | 3-2, 5-1 |
| Scale | ~50 concurrent | stateless cookie 기반 — 서버 세션 스토어 없음 → 수평 확장 무제한 (Vercel serverless 전제) | 3-2 (부하 가정 검증은 E2E 범위 밖) |
| Availability | 99% best-effort | cookie 저장은 외부 의존 0 (Riot/Supabase 장애 영향 없음). 복호화 실패 시 graceful fallback (`/login` redirect) | 2-4, 3-1 |
| Security | RSO 토큰 AES 암호화, HTTPS only, PW 서버 미저장, Phase 2 vault 인터페이스 | AES-256-GCM authenticated encryption, httpOnly + Secure + SameSite=Lax, 키는 서버 전용 env, 변조 감지 시 재로그인, 만료 즉시 무효화, 로그아웃 파기, Phase 2 `TokenVault` 포트 | 1-1, 1-2, 1-3, 1-4, 2-1, 2-4, 2-5, 3-3, 4-1, 6-1 |
| Compliance | PIPA 최소수집, Riot ToS | cookie payload 에 puuid + 토큰만 저장, PW/이메일 미저장; 로그아웃 시 Max-Age=0 으로 즉시 파기 (탈퇴 요청 대응) | 4-1, 4-2 |
| Operability | Vercel 로그, instant rollback | 복호화 실패 시 `console.warn` 로 Vercel function log 에 기록 (민감 정보 제외); cookie 변경은 코드 배포만으로 롤백 가능 (DB 마이그레이션 없음 — MVP) | 2-4 |
| Cost | $0/월 | Supabase/KMS 미사용, Web Crypto API 내장, Vercel env var 무료 | 해당 phase 전체 (인프라 추가 없음) |
| Maintainability | Critical path 테스트 (세션 복원) | `tests/critical-path/` 에 Phase 1–4 전부 배치, E2E smoke 1개 (Test 5-1) 로 AC-2 회귀 방지; 포트 인터페이스 `TokenVault` 로 Phase 2 확장 비용 최소화 | 1-1~1-4, 2-1~2-5, 3-1~3-3, 4-1~4-2, 5-1, 6-1 |

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (crypto)
  ├─ 1-1 test ─┐
  ├─ 1-2 test ─┤
  ├─ 1-3 test ─┼─→ 1-impl (lib/crypto/aes-gcm.ts, lib/session/encode.ts)
  └─ 1-4 test ─┘                │
                                 ▼
Phase 2 (cookie)  ────────── needs encryptSession/decryptSession
  ├─ 2-1 test ─┐
  ├─ 2-2 test ─┤
  ├─ 2-3 test ─┼─→ 2-impl (lib/session/cookie.ts)
  ├─ 2-4 test ─┤
  └─ 2-5 test ─┘                │
                                 ▼
Phase 3 (SSR gate) ────────── needs readSessionFromCookies
  ├─ 3-1 test ─┐
  ├─ 3-2 test ─┼─→ 3-impl (app/(app)/dashboard/page.tsx, lib/session/guard.ts)
  └─ 3-3 test ─┘
                                 │
Phase 4 (logout) ──────────── needs buildLogoutCookie (independent of Phase 3)
  ├─ 4-1 test ─┐
  └─ 4-2 test ─┼─→ 4-impl (app/api/auth/logout/route.ts)

Phase 5 (E2E)   ────────── needs Phase 1+2+3 impl + Plan 0001 callback
  └─ 5-1 test ───→ 5-impl (tests/e2e + seed helper)

Phase 6 (P2 hook) ─── independent, can parallel with any phase
  └─ 6-1 test ───→ 6-impl (lib/domain/token-vault.ts, .env.example)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3, 1-4 테스트 / 6-1 테스트 / 6-impl / .env.example | 없음 | ✅ |
| G2 | 1-impl (crypto + encode) | G1 완료 | - (단일 impl) |
| G3 | 2-1, 2-2, 2-3, 2-4, 2-5 테스트 | G2 완료 | ✅ |
| G4 | 2-impl (cookie) | G3 완료 | - |
| G5 | 3-1, 3-2, 3-3 테스트 / 4-1, 4-2 테스트 | G4 완료 | ✅ (서로 다른 파일) |
| G6 | 3-impl (dashboard + guard) / 4-impl (logout route) | G5 완료 | ✅ (서로 다른 파일) |
| G7 | 5-1 테스트 + 5-impl (E2E) | G6 완료 + Plan 0001 callback impl 완료 | - |

> 같은 파일을 건드리는 작업: Phase 3 의 dashboard/page.tsx 는 Plan 0003 (store 렌더) 과 충돌 가능성. 본 Plan 은 "session 게이트 + stub" 까지만 커밋하고 store 렌더 세부는 Plan 0003 가 주입하도록 함수 시그니처만 열어둔다.

### 종속성 판단 기준 적용

- **종속**: Phase 2 → Phase 1 (`encryptSession` 산출물 참조), Phase 3 → Phase 2 (`readSessionFromCookies` 참조), Phase 5 → Phase 3 (SSR 게이트 동작 전제).
- **독립**: Phase 4 는 Phase 2 의 `buildLogoutCookie` 만 필요 → Phase 3 와 동시 진행 가능. Phase 6 는 타입 선언뿐이라 어느 Phase 와도 병렬.
- **독립 (Plan 간)**: Plan 0001 (Riot auth) 은 본 Plan 의 `encryptSession` 을 import 해 사용 → Plan 0002 G2 완료 후 Plan 0001 callback impl 진행 가능 (가정사항 A1 계약).

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | AES-GCM 왕복 테스트 | ✅ 완료 | |
| 1-2 | IV 랜덤성 테스트 | ✅ 완료 | |
| 1-3 | 변조 암호문 거부 테스트 | ✅ 완료 | |
| 1-4 | 키 길이 검증 테스트 | ✅ 완료 | |
| 1-impl | `lib/crypto/aes-gcm.ts` + `lib/session/encode.ts` | ✅ 완료 | Plan 0001 이 import |
| 2-1 | buildSessionCookie 속성 테스트 | ✅ 완료 | |
| 2-2 | 과거 exp → maxAge 0 | ✅ 완료 | |
| 2-3 | readSessionFromCookies null/payload | ✅ 완료 | |
| 2-4 | 복호화 실패 → null | ✅ 완료 | |
| 2-5 | buildLogoutCookie | ✅ 완료 | |
| 2-impl | `lib/session/cookie.ts` | ✅ 완료 | |
| 3-1 | cookie 부재 → redirect /login | ✅ 완료 | |
| 3-2 | 유효 session → dashboard SSR | ✅ 완료 | store fetch 는 stub |
| 3-3 | 만료 session → /login?error=expired | ✅ 완료 | |
| 3-impl | `app/(app)/dashboard/page.tsx` + `lib/session/guard.ts` | ✅ 완료 | Plan 0003 와 파일 공유 주의 |
| 4-1 | logout 정상 경로 | ✅ 완료 | |
| 4-2 | logout 멱등 | ✅ 완료 | |
| 4-impl | `app/api/auth/logout/route.ts` | ✅ 완료 | |
| 5-1 | E2E 2회차 방문 자동 로그인 | ✅ 완료 | AC-2 직접 검증 |
| 5-impl | `tests/e2e/auto-login.spec.ts` + seed helper | ✅ 완료 | Plan 0001 완료 전제 |
| 6-1 | NoopTokenVault 테스트 | ✅ 완료 | |
| 6-impl | `lib/domain/token-vault.ts` + `.env.example` | ✅ 완료 | Phase 2 확장 포인트 |
| 7-1 | `user_tokens` 테이블 DDL | ✅ 완료 | Phase 2 확장 포인트 |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
