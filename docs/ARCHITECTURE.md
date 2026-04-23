# Architecture: VAL-Shop

- 작성일: 2026-04-23
- 상태: APPROVED
- PRD: [docs/PRD.md](PRD.md)

## 1. Overview

VAL-Shop 은 Next.js (App Router) 기반 단일 레포 풀스택 PWA 이다. 프런트엔드는 React 로 모바일 Chrome 우선 렌더링, 백엔드는 Next.js Route Handlers 가 Riot 비공식 API 를 프록시한다. Vercel Serverless 인프라에 올라가며, Phase 2 에서 Supabase (위시리스트 + 토큰 vault), Vercel Cron (주기 워커), Resend (이메일 알림) 이 추가된다.

이 문서는 MVP 와 Phase 2 의 구조를 동시에 다룬다. Phase 2 만 해당하는 요소는 (P2) 로 표기.

## 2. 컴포넌트

- **Web UI**: Next.js App Router 페이지. MVP 는 `/login`, `/dashboard`, `/privacy`. (P2) `/search`, `/skin/[id]`, `/wishlist`. 모바일 우선 레이아웃 + PWA manifest.
- **Auth Proxy**: `/api/auth/*` Route Handlers. Riot 비공식 auth flow (ssid cookie → access_token → entitlements_token → PUUID) 를 서버사이드에서 중개. 브라우저는 `auth.riotgames.com` 과 직접 통신하여 PW 는 서버를 거치지 않음.
- **Store Proxy**: `/api/store` Route Handler. `pd.kr.a.pvp.net/store/v2/storefront/{puuid}` 호출로 오늘의 상점 4개 스킨 UUID + 로테이션 종료 epoch 반환. `X-Riot-ClientVersion`, `X-Riot-ClientPlatform`, `X-Riot-Entitlements-JWT`, `Authorization: Bearer` 헤더 주입.
- **Meta Catalog Client**: `lib/valorant-api/catalog.ts`. `valorant-api.com/v1/weapons/skins` 를 Next.js ISR (`revalidate: 86400`) 로 캐시. 스킨 UUID → 이름·이미지·티어 매핑.
- **Client Version Resolver**: `lib/riot/version.ts`. `valorant-api.com/v1/version` 에서 최신 `riotClientVersion` 을 주기 fetch (ISR 1h) 해서 Store Proxy 헤더에 주입. 하드코딩 회피.
- **Crypto Module**: `lib/crypto/aes-gcm.ts`. Web Crypto API 로 토큰 AES-GCM 암호화/복호화. 키는 `TOKEN_ENC_KEY` 환경변수 (서버 전용).
- **Domain Model**: `lib/domain/`. 앱 도메인 타입 (`Skin`, `TodayStore`, `WishlistItem` 등) 을 TypeScript `interface` / `type` 으로 선언. Spring 의 `domain/`·`@Value` object 대응. DB 테이블에 묶이지 않은 순수 타입.
- **Token Vault (P2)**: Supabase `user_tokens` 테이블. `pgcrypto` + RLS (user_id 본인만 select/update). MVP 는 httpOnly cookie 한정; Phase 2 에서 워커가 접근할 수 있도록 서버 DB 로 확장.
- **Wishlist Store (P2)**: Supabase `wishlist` 테이블. (`user_id`, `skin_uuid`) PK, RLS 본인만.
- **Notification Worker (P2)**: `/api/cron/check-wishlist` Vercel Cron 엔드포인트. 1시간마다 실행; 전체 유저 순회 → token vault 에서 토큰 decrypt → storefront 호출 → wishlist 매칭 → Email Dispatcher 호출.
- **Email Dispatcher (P2)**: `lib/email/dispatch.ts`. `resend` SDK 로 이메일 발송. 수신 주소는 Supabase Auth 의 `users.email` 사용 → 별도 구독 테이블 없음.

의존성 방향 (단방향, 순환 없음):
```
Web UI → Auth Proxy / Store Proxy
Auth Proxy → Crypto, (P2) Token Vault
Store Proxy → Crypto, Client Version Resolver, Meta Catalog
Notification Worker (P2) → Token Vault, Store Proxy internals, Wishlist Store, Email Dispatcher
```

## 3. 폴더 구조

```
valshop/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (app)/
│   │   ├── dashboard/page.tsx
│   │   ├── wishlist/page.tsx          # P2
│   │   ├── search/page.tsx            # P2
│   │   └── skin/[id]/page.tsx         # P2
│   ├── privacy/page.tsx
│   ├── api/
│   │   ├── auth/
│   │   │   ├── start/route.ts
│   │   │   ├── callback/route.ts
│   │   │   └── logout/route.ts
│   │   ├── store/route.ts
│   │   ├── wishlist/route.ts          # P2
│   │   └── cron/check-wishlist/route.ts   # P2
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── SkinCard.tsx
│   ├── Countdown.tsx
│   └── Footer.tsx
├── lib/
│   ├── riot/
│   │   ├── auth.ts
│   │   ├── storefront.ts
│   │   └── version.ts
│   ├── valorant-api/
│   │   └── catalog.ts
│   ├── crypto/
│   │   └── aes-gcm.ts
│   ├── domain/
│   │   ├── skin.ts                    # Skin, TodayStore
│   │   └── wishlist.ts                # WishlistItem (P2)
│   ├── supabase/                      # P2
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── types.ts                   # DB row types (@Entity 대응)
│   └── email/                         # P2
│       ├── dispatch.ts                # Resend 클라이언트 래퍼
│       └── templates.ts               # 이메일 본문 빌더
├── supabase/                          # P2 — Flyway migrations 대응
│   └── migrations/
│       ├── 0001_user_tokens.sql
│       └── 0002_wishlist.sql
├── public/
│   ├── manifest.webmanifest
│   └── icons/
├── tests/
│   ├── critical-path/                 # Vitest unit/integration
│   │   ├── auth.test.ts
│   │   ├── store.test.ts
│   │   └── crypto.test.ts
│   ├── e2e/                           # Playwright smoke
│   │   └── dashboard.spec.ts
│   ├── integration/                   # P2: Supabase local 필요 (critical path 아님)
│   │   └── wishlist-supabase.test.ts
│   └── features/                      # P2: Gherkin .feature + playwright-bdd
│       └── .gitkeep
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   └── adr/
├── .env.local                         # gitignored
├── .env.example
├── next.config.ts
├── vercel.json                        # P2: cron schedule
├── package.json
└── tsconfig.json
```

**핵심 파일**: `app/api/auth/callback/route.ts` (auth flow 종점), `app/api/store/route.ts` (상점 조회 entry), `lib/riot/auth.ts` (Riot 토큰 교환 핵심), `lib/crypto/aes-gcm.ts` (토큰 암호화).

**빌드 산출물**: `.next/` (Vercel 이 관리, gitignored).
**Secret 관리**: `.env.local` 로컬 개발, Vercel Project Env Variables 운영. `.env.example` 로 key 목록만 공개.

## 4. 데이터 흐름

### MVP: 로그인 → 대시보드

```
Browser             Next.js (Vercel)          Riot              valorant-api.com
  |                       |                     |                     |
  | GET /login            |                     |                     |
  |---------------------->|                     |                     |
  | click "Riot Login"    |                     |                     |
  |---------------------->| /api/auth/start     |                     |
  |                       | 302 auth.riotgames.com?...                |
  |<---(302)--------------|                     |                     |
  | GET auth.riotgames.com                      |                     |
  |------------------------------------------>  |                     |
  | user inputs PW (never hits our server)      |                     |
  |                                             |                     |
  | 302 back with ssid cookie                   |                     |
  |<------------------------------------------  |                     |
  | GET /api/auth/callback                      |                     |
  |---------------------->| ssid → access_token exchange              |
  |                       |-------------------->|                     |
  |                       |<-- access_token ----|                     |
  |                       | entitlements exchange                     |
  |                       |-------------------->|                     |
  |                       |<-- entitlements_tk--|                     |
  |                       | userinfo → PUUID                          |
  |                       |-------------------->|                     |
  |                       |<-- PUUID -----------|                     |
  |                       | AES-GCM encrypt tokens                    |
  |                       | Set-Cookie: session=<enc>; HttpOnly;      |
  |                       |             SameSite=Lax; Secure          |
  |<---(302 /dashboard)---|                     |                     |
  | GET /dashboard (SSR)  |                     |                     |
  |---------------------->| read cookie → decrypt                     |
  |                       | resolve clientVersion (ISR cached)        |
  |                       |------------------------------------------>|
  |                       |<---- clientVersion ------------------------|
  |                       | GET storefront?puuid=...                  |
  |                       |-------------------->|                     |
  |                       |<-- 4 skin UUIDs + ttl                     |
  |                       | fetch meta (ISR cached)                   |
  |                       |------------------------------------------>|
  |                       |<---- skin metadata -----------------------|
  |<---HTML (4 cards + countdown)-------------  |                     |
```

### Phase 2: 워커 → 푸시

```
Vercel Cron (hourly)
  |
  |--> /api/cron/check-wishlist
        for each user in user_tokens:
          decrypt tokens
          call storefront (reuse Store Proxy lib)
          diff with wishlist
          if match:
            lookup user.email (Supabase auth)
            resend.emails.send({ to, subject, html })
          (on 401) mark user for re-auth
```

### 실패 경로

- **ssid 만료 / 로그인 실패**: `/api/auth/callback` 에서 에러 감지 → `/login?error=<code>` 리다이렉트 + 재시도 UI.
- **storefront 401**: 토큰 만료. 클라이언트가 감지하면 `/api/auth/start` 로 자동 리다이렉트 (FR-6).
- **storefront 429 / 5xx**: 클라이언트에 에러 JSON → 대시보드가 에러 화면 + "다시 시도" 버튼.
- **valorant-api 실패**: Next.js ISR stale cache 제공; 초기 캐시도 없으면 `SkinCard` 가 placeholder 이미지 + "메타 불러오기 실패" 표기.
- **worker 전체 실패 (P2)**: Vercel Cron 재시도 없음 → 다음 hour 에 재실행. 로그로만 확인.

### 트랜잭션 경계

토큰 vault + wishlist 쓰기는 단일 Supabase row 단위라 DB 트랜잭션 불필요. auth callback 은 멱등성 (같은 ssid 로 재호출 시 토큰 덮어쓰기).

### 재시도 전략

- Riot API: 서버사이드에서 429 시 1회 재시도 (exponential 200ms). 5xx 는 재시도 없이 에러 반환.
- valorant-api: 실패 시 재시도 없이 stale cache.

### 비동기 지점

- Vercel Cron (1h 간격 pull-based)
- Web Push (브라우저 벤더에 fire-and-forget)

## 5. 외부 통합

| 시스템 | 용도 | 신뢰성 가정 | Rate Limit / Quota | Fallback |
|---|---|---|---|---|
| `auth.riotgames.com` | 로그인 | 높음; 비공식 경로 차단 리스크 | 명시적 제한 없음, 남용 금지 | 에러 화면 + 정책 변경 안내 |
| `pd.kr.a.pvp.net` | 상점 조회 | 라이엇 본 서비스, 99%+ | clientVersion 헤더 틀리면 400 | 재시도 1회 후 에러 |
| `valorant-api.com` | 스킨 메타 + clientVersion | 커뮤니티, ~99% | 없음 (CDN) | ISR stale cache / placeholder |
| Supabase (P2) | DB + vault | 무료 99.9% | 무료 500MB DB, 5만 MAU | 위시리스트 비활성, 대시보드만 동작 |
| Resend (P2) | 이메일 알림 | 99.9% SLA (무료), 3000/월 | 100/일 soft limit | 실패 로깅 + 다음 cron 재시도 |
| Vercel Cron (P2) | 워커 트리거 | Vercel | Hobby: 일 제한, 최소 간격 1h | 누락 hour 는 그냥 skip |

## 5.1. DB 스키마 (Phase 2)

Supabase Postgres. 모든 테이블 RLS 활성화, `auth.uid() = user_id` 로 본인 행만 접근.

```sql
-- supabase/migrations/0001_user_tokens.sql
create table user_tokens (
  user_id uuid primary key default gen_random_uuid(),
  puuid text unique not null,
  access_token_enc bytea not null,         -- AES-GCM ciphertext
  refresh_token_enc bytea not null,
  entitlements_jwt_enc bytea not null,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table user_tokens enable row level security;
create policy "own row" on user_tokens for all using (auth.uid() = user_id);

-- supabase/migrations/0002_wishlist.sql
create table wishlist (
  user_id uuid references user_tokens(user_id) on delete cascade,
  skin_uuid text not null,
  created_at timestamptz default now(),
  primary key (user_id, skin_uuid)
);
alter table wishlist enable row level security;
create policy "own rows" on wishlist for all using (auth.uid() = user_id);
```

이메일 알림은 Supabase Auth 의 `users.email` 을 그대로 사용하므로 구독 테이블 불필요 (ADR-0008).

MVP 에는 위 테이블 **모두 미생성**. httpOnly cookie 에 AES-GCM 암호화된 토큰만 저장.

## 6. NFR 대응표

| PRD NFR | 실현 방법 | 관련 ADR |
|---|---|---|
| Performance: TTI≤3s, p95 API≤1s | Next.js App Router SSR, Vercel Edge Network, valorant-api ISR 24h, Store Proxy 단일 round-trip | ADR-0003 |
| Scale: ~50 concurrent, ~1000 wishlist | Vercel Serverless 자동 스케일, Supabase free tier 내 여유 | — |
| Availability: 99% best-effort | Vercel 기본 SLA 상속. 외부 의존 실패 시 에러 화면. 자체 장애 복구 없음 | — |
| Security: 토큰 AES + PW 미저장 + vault | Web Crypto AES-GCM, httpOnly + SameSite=Lax + Secure cookie, Supabase pgcrypto + RLS (P2), PW 는 항상 브라우저↔Riot 직통 | ADR-0001, ADR-0002 |
| Compliance: Riot ToS + 'fan-made' + PIPA 최소수준 | 전 페이지 `Footer` 에 고지, `/privacy` 에 수집 항목 명시 (PUUID, 위시리스트만), 로그아웃 시 토큰 즉시 파기 | ADR-0001 |
| Operability: Vercel 로그 + git push | Vercel 기본 function logs, Vercel instant rollback. 별도 Sentry 없음 | — |
| Cost: $0 / 월 | Vercel Hobby + Supabase Free. Cron 은 Hobby 1h 간격으로 타협 (5min→1h 완화) | ADR-0004 |
| Maintainability: critical path tests + README | Vitest, `tests/critical-path/` 에 auth flow + storefront 파싱만. README 에 env 세팅 + 배포 가이드 | — |

## 6.1. 테스트 전략 (BDD)

Spring 의 JUnit + Cucumber-JVM 조합에 대응. 2단계로 도입한다.

**MVP (경량 BDD)**: Vitest + @testing-library/react + Playwright. Gherkin `.feature` 파일은 쓰지 않고, **Given/When/Then 을 테스트 네이밍 + 주석 컨벤션**으로 반영.

```ts
// tests/critical-path/auth.test.ts
describe("Feature: Riot 로그인 세션 유지", () => {
  describe("Scenario: 최초 로그인 후 재방문", () => {
    it("Given 암호화 토큰 cookie, When /dashboard 접속, Then 상점 SSR 된다", async () => {
      // Given
      const cookie = await encryptToken(validTokenFixture);
      // When
      const res = await fetchDashboard({ cookie });
      // Then
      expect(res.status).toBe(200);
      expect(res.html).toContain('data-testid="skin-card"');
    });
  });
});
```

**Phase 2 (풀 BDD)**: `playwright-bdd` 로 Gherkin `.feature` 파일 + step definitions 도입. 시나리오 자체가 실행 가능한 문서 역할.

```gherkin
# tests/features/wishlist-push.feature
Feature: 위시리스트 푸시 알림
  Scenario: 찜한 스킨이 상점에 뜨면 1시간 이내 푸시 수신
    Given 유저가 스킨 X 를 위시리스트에 추가했다
    And 상점이 X 를 포함하도록 모킹됐다
    When Cron 워커가 실행된다
    Then 해당 유저에게 Web Push 가 디스패치된다
```

### 커버 대상 (Critical Path)

| # | 대상 | 도구 | 단계 |
|---|---|---|---|
| 1 | Auth callback (ssid → 토큰 교환 → 암호화 → cookie set) | Vitest (integration, Riot API mock) | MVP |
| 2 | Store route (cookie decrypt → storefront → 4 UUID 반환) | Vitest (integration, Riot API mock) | MVP |
| 3 | Crypto module (AES-GCM 왕복) | Vitest (unit) | MVP |
| 4 | Dashboard E2E (로그인 상태 → 4 카드 + 카운트다운) | Playwright (smoke) | MVP |
| 5 | Wishlist CRUD | Vitest (integration, Supabase local) | P2 |
| 6 | Cron worker → push dispatch | playwright-bdd + Supabase mock | P2 |

### Spring 대응표

| 이 프로젝트 | Spring |
|---|---|
| Vitest `describe/it` | JUnit 5 `@Nested` / `@Test` |
| `@testing-library/react` | `MockMvc` + Thymeleaf view test |
| `next-test-api-route-handler` | `@WebMvcTest` + MockMvc |
| Playwright | Selenium / `@SpringBootTest` + TestRestTemplate |
| playwright-bdd (P2) | Cucumber-JVM `@Given`/`@When`/`@Then` |
| Riot API mock (`msw`) | `@MockBean` + Mockito `when().thenReturn()` |
| Supabase local (P2) | Testcontainers Postgres |

### 테스트 피라미드 & 의존성 규칙

```
                       ┌─────────────┐
                       │   E2E (1)   │  Playwright, 스모크 1개
                       ├─────────────┤
                       │Component (3)│  Vitest + MSW, HTTP handler in-process
                       ├─────────────┤
                       │  Unit (N)   │  Vitest only, 순수 함수
                       └─────────────┘
```

**Critical path 테스트 규칙 (`tests/critical-path/`)**: 네트워크 호출·실제 DB 커넥션 **금지**. 외부 의존은 반드시 **생성자·함수 인자로 주입** (`WishlistRepo`, `Fetcher`, `PushDispatcher` 등 포트 인터페이스). MSW 는 HTTP 경계 가로챔이므로 인-프로세스로 간주하여 허용.

**포트-어댑터 패턴** (Spring 의 `@Repository` interface + JPA 구현체 + Mock 구현체 분리와 동일):

```ts
// lib/domain/wishlist.ts
export interface WishlistRepo {
  add(userId: string, skinUuid: string): Promise<void>;
  listFor(userId: string): Promise<string[]>;
}
export function matchStoreAgainstWishlist(store: string[], wish: string[]): string[] {
  return store.filter(s => wish.includes(s));
}

// lib/supabase/wishlist-repo.ts  ← 운영 어댑터
export function createSupabaseWishlistRepo(sb: SupabaseClient): WishlistRepo { ... }

// tests 안 in-memory fake
const fakeRepo: WishlistRepo = { listFor: async () => ["A"], ... };
```

**Integration 테스트 (`tests/integration/`)**: Supabase local 등 실제 인프라 필요. critical path 아님. 선택 실행.

### 실행

- `npm test` → `tests/critical-path/` 만 (네트워크·DB 없음, 빠름)
- `npm run test:e2e` → Playwright
- `npm run test:integration` → Supabase local 띄운 후 수동 실행
- `npm run test:all` → 전부

CI 는 없음 (§ 6 Operability 에 일치 — git push 배포만). 로컬 pre-commit 으로 critical 테스트만 돌림 (husky 옵션, 여력 시).

## 7. 주요 결정 (ADR 링크)

- ADR-0001: unofficial-riot-auth
- ADR-0002: token-storage-hybrid
- ADR-0003: meta-catalog-isr-caching
- ADR-0004: push-worker-vercel-cron-hourly
- ADR-0005: client-version-auto-resolve
- ADR-0006: test-stack-choice
- ADR-0007: styling-framework
- ADR-0008: notification-channel-email

## 8. 미해결 질문

- Not-target 정의 (PRD § 9 에서 상속) — TBD.
