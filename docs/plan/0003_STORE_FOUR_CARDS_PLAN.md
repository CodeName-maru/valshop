# Plan 3: 오늘의 상점 4개 카드 렌더 (FR-3)

## 개요

<!-- Cross-plan 정합성 감사(2026-04-23) 반영 -->

유저가 로그인된 세션으로 `/dashboard` 에 접속했을 때 Riot storefront 응답과 `valorant-api.com` 메타데이터를 매칭하여 오늘의 상점 4개 카드(스킨 이름, 가격 VP, 등급 티어 아이콘, 이미지)를 **3초 이내** 렌더한다. Store Proxy Route Handler + Meta Catalog ISR 캐시 + SkinCard 컴포넌트를 TDD 로 구현한다. 본 Plan 은 FR-3 과 AC-1/AC-4 (TTI ≤ 3s) 의 달성에 집중한다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 렌더 방식 | **Server Component + SSR** 로 `/dashboard` 초기 HTML 에 4개 카드 포함 | PRD NFR Performance TTI ≤ 3s (AC-1/AC-4). 클라이언트 페칭은 waterfall 로 3s 초과 리스크; SSR 은 FCP 이후 바로 카드 보임 |
| Store Proxy 엔드포인트 | `app/api/store/route.ts` Route Handler (GET) — SSR 내부에서 직접 `getTodayStore()` 함수 호출 (fetch 우회) + 외부 디버그/재시도용 HTTP 노출 | ARCHITECTURE §2, 내부 직접 호출로 HTTP round-trip 절감 → TTI 예산 확보 |
| 메타 카탈로그 캐시 | `fetch("...skins", { next: { revalidate: 86400 } })` + stale-while-revalidate | ADR-0003. 수 MB 카탈로그의 매-요청 fetch 는 TTI/비용 NFR 위배 |
| Client version 주입 | `lib/riot/version.ts` (ISR 3600s) 로 `X-Riot-ClientVersion` 자동 해결 | ADR-0005. 하드코딩 회피, 400 에러 방지 |
| Riot API 재시도 | 429 1회 지수 백오프(200ms), 5xx 는 즉시 에러 | ARCHITECTURE §4 재시도 전략, p95 ≤ 1s NFR |
| 이미지 최적화 | `next/image` 사용, `valorant-api` CDN 원본을 `remotePatterns` 에 등록, `priority` 4개 카드, `sizes` 지정 | NFR Performance — LCP/TTI 단축, 자동 WebP 변환 |
| 스타일링 | Tailwind + shadcn/ui `Card` 컴포넌트 복사 | ADR-0007 |
| 티어 아이콘 소스 | `valorant-api.com/v1/contenttiers` (ISR 86400s) UUID → 아이콘 URL 매핑 | ADR-0003 패턴 재사용, 카탈로그와 같은 캐시 정책 |
| Store 응답 파싱 단위 테스트 | `lib/riot/storefront.ts` 순수 함수로 분리, Vitest 로 커버 | PRD NFR Maintainability (상점 파싱 단위 테스트 필수) |
| 테스트 스택 | Vitest + @testing-library/react + next-test-api-route-handler + MSW, E2E 는 Playwright 스모크 | ADR-0006 |
| 실패 UI | storefront 401 → `/login` 리다이렉트, 429/5xx → "다시 시도" 버튼 오류 카드, valorant-api 실패 → placeholder 이미지 + stale cache | ARCHITECTURE §4, FR-6 |
| 가격 단위 표기 | `1775 VP` 형식, `Intl.NumberFormat("ko-KR")` 천단위 콤마 | UX 일관성 |

### 가정사항 (FR-1/FR-2/FR-6 인터페이스)

- **세션 조회 (Plan 0002 소유 단일 소스)**: `lib/session/guard.ts` 에서 `requireSession()`(세션 없으면 예외/리다이렉트) 과 `getSession()`(nullable) 을 export 한다. 본 Plan 은 이 두 함수를 consumer 로만 사용한다.
- **SessionPayload 타입**: `lib/session/types.ts` 에서 import 한 `SessionPayload = { puuid, accessToken, entitlementsJwt, expiresAt, region }` (camelCase) 를 기준으로 한다.
- httpOnly cookie 이름 `session` + AES-GCM 복호화는 FR-2 에서 구현 완료되어 있다고 가정.
- 세션 없으면 `/dashboard` 는 `/login` 으로 302.
- **`next.config.ts` 소유권은 Plan 0010 (인프라/설정) 이 가진다**. Plan 0010 이 `images.remotePatterns` 에 `valorant-api.com` 과 `media.valorant-api.com` 을 포함하도록 설정하며, 본 Plan 은 해당 설정이 이미 존재한다고 가정한다. 본 Plan 에서는 `next.config.ts` 를 직접 수정하지 않는다.
- **RiotFetcher 포트 (Plan 0006 소유)**: storefront 호출부(`lib/riot/storefront.ts`) 는 Plan 0006 에서 정의한 `RiotFetcher` 포트를 **DI 로 주입**받아 사용한다 (재시도/헤더/에러 매핑 등 교차 관심사는 포트 구현체가 담당). 본 Plan 은 포트 계약이 제공된다고 가정.

---

## Phase 1: 도메인 타입 & 순수 파싱 함수

### 테스트 시나리오

#### Test 1-1: storefront JSON → TodayStore 도메인 매핑
```ts
describe("Feature: Storefront 응답 파싱", () => {
  describe("Scenario: 정상 응답 4개 스킨", () => {
    it("given_storefrontJsonWithFourOffers_whenParse_thenReturnsTodayStoreWithFourEntries", () => {
      // Given: Riot storefront 샘플 JSON (SkinsPanelLayout.SingleItemStoreOffers 4개)
      // When: parseStorefront(json)
      // Then: { offers: [{ skinUuid, priceVp }, ...×4], rotationEndsAt: Date } 반환
    });
  });
});
```

#### Test 1-2: 로테이션 TTL epoch 변환
```ts
it("given_singleItemOffersRemainingDurationInSeconds_whenParse_thenRotationEndsAtIsNowPlusSeconds", () => {
  // Given: SingleItemOffersRemainingDurationInSeconds = 3600
  // When: parseStorefront(json, now)
  // Then: rotationEndsAt === now + 3600s (±1s)
});
```

#### Test 1-3: 필수 필드 누락 시 명시적 에러
```ts
it("given_malformedStorefrontJsonMissingOffers_whenParse_thenThrowsStorefrontParseError", () => {
  // Given: SkinsPanelLayout 필드 없는 JSON
  // When: parseStorefront(json)
  // Then: StorefrontParseError 예외
});
```

#### Test 1-4: 메타 매칭 (UUID → Skin 도메인)
```ts
it("given_fourSkinUuidsAndCatalog_whenMatchMeta_thenReturnsFourSkinDomainObjects", () => {
  // Given: offers 4개 + catalog Map<uuid, {displayName, displayIcon, contentTierUuid}>
  // When: matchSkinMeta(offers, catalog, tierCatalog)
  // Then: [{ uuid, name, priceVp, imageUrl, tierIconUrl }] ×4
});
```

#### Test 1-5: 카탈로그에 없는 UUID 처리 (신규 스킨)
```ts
it("given_skinUuidMissingFromCatalog_whenMatchMeta_thenReturnsPlaceholderEntry", () => {
  // Given: offers[0].skinUuid 가 catalog 에 없음
  // When: matchSkinMeta(offers, catalog, tierCatalog)
  // Then: 해당 entry 는 { name: "Unknown Skin", imageUrl: "/placeholder.png", tierIconUrl: null }
});
```

### 구현 항목

**파일**: `lib/domain/skin.ts`
- `type Skin = { uuid: string; name: string; priceVp: number; imageUrl: string; tierIconUrl: string | null }`
- `type TodayStore = { offers: Skin[]; rotationEndsAt: Date }`
- `type StorefrontOffer = { skinUuid: string; priceVp: number }`

**파일**: `lib/riot/storefront.ts`
- `parseStorefront(json: unknown, now?: Date): { offers: StorefrontOffer[]; rotationEndsAt: Date }`
- `class StorefrontParseError extends Error`
- 순수 함수, 네트워크 호출 없음

**파일**: `lib/valorant-api/match.ts`
- `matchSkinMeta(offers, skinCatalog, tierCatalog): Skin[]`
- 누락 UUID 는 placeholder 엔트리로 대체 (던지지 않음)

---

## Phase 2: 메타 카탈로그 & 버전 캐시 레이어

### 테스트 시나리오

#### Test 2-1: 스킨 카탈로그 fetch 는 ISR revalidate 86400 사용
```ts
it("given_valorantApiSkinsResponse_whenGetSkinCatalog_thenFetchCalledWithRevalidate86400", async () => {
  // Given: MSW 가 /v1/weapons/skins 를 목킹
  // When: getSkinCatalog()
  // Then: fetch 2번째 인자 === { next: { revalidate: 86400 } } + 반환값이 Map<uuid, meta>
});
```

#### Test 2-2: 카탈로그 응답 → Map 변환
```ts
it("given_skinCatalogArray_whenGetSkinCatalog_thenReturnsMapKeyedByUuid", async () => {
  // Given: [{ uuid: "a", displayName: "X", displayIcon: "...", contentTierUuid: "t" }]
  // When: getSkinCatalog()
  // Then: Map.get("a") === { displayName: "X", ... }
});
```

#### Test 2-3: tier 카탈로그 동일 패턴
```ts
it("given_tierCatalog_whenGetTierCatalog_thenReturnsMapWithRevalidate86400", async () => { /* ... */ });
```

#### Test 2-4: client version resolver ISR 3600
```ts
it("given_versionEndpoint_whenGetClientVersion_thenFetchCalledWithRevalidate3600", async () => {
  // Given: MSW /v1/version → { data: { riotClientVersion: "release-..." } }
  // When: getClientVersion()
  // Then: 문자열 반환 + fetch { next: { revalidate: 3600 } }
});
```

### 구현 항목

**파일**: `lib/valorant-api/catalog.ts`
- `getSkinCatalog(): Promise<Map<string, SkinMeta>>` — `fetch(url, { next: { revalidate: 86400 } })`
- `getTierCatalog(): Promise<Map<string, TierMeta>>` — 동일 패턴
- `type SkinMeta = { displayName: string; displayIcon: string; contentTierUuid: string }`

**파일**: `lib/riot/version.ts`
- `getClientVersion(): Promise<string>` — ISR 3600, `data.riotClientVersion` 추출

---

## Phase 3: Store Proxy (Riot storefront 호출)

### 테스트 시나리오

#### Test 3-1: 정상 경로 — 세션 → storefront → meta 매칭 → TodayStore
```ts
it("given_validSessionAndMockedRiotAndMeta_whenGetTodayStore_thenReturnsTodayStoreWithFourSkins", async () => {
  // Given: session { puuid, accessToken, entitlementsJwt }, MSW 가 pd.kr.a.pvp.net/store/v2/storefront/{puuid}, valorant-api 목킹
  // When: getTodayStore(session)
  // Then: offers.length === 4, 각 offer 의 name/priceVp/imageUrl/tierIconUrl 채워짐, rotationEndsAt Date
});
```

#### Test 3-2: 필수 헤더 주입
```ts
it("given_session_whenGetTodayStore_thenStorefrontCalledWithAllRequiredHeaders", async () => {
  // Given: session
  // When: getTodayStore(session)
  // Then: MSW intercept 가 확인한 요청 헤더에
  //   Authorization: Bearer <accessToken>
  //   X-Riot-Entitlements-JWT: <jwt>
  //   X-Riot-ClientVersion: <resolved>
  //   X-Riot-ClientPlatform: <base64 payload>
  //   모두 존재
});
```

#### Test 3-3: 401 → TokenExpiredError
```ts
it("given_expiredAccessToken_whenGetTodayStore_thenThrowsTokenExpiredError", async () => {
  // Given: MSW storefront → 401
  // When: getTodayStore(session)
  // Then: TokenExpiredError
});
```

#### Test 3-4: 429 → 1회 재시도 성공
```ts
it("given_first429ThenSuccess_whenGetTodayStore_thenReturnsStoreAfterSingleRetry", async () => {
  // Given: MSW 첫 호출 429, 두 번째 200
  // When: getTodayStore(session)
  // Then: 정상 TodayStore 반환, 재시도 1회 확인
});
```

#### Test 3-5: 5xx → RiotUpstreamError (재시도 없음)
```ts
it("given_storefront503_whenGetTodayStore_thenThrowsRiotUpstreamErrorWithoutRetry", async () => { /* ... */ });
```

#### Test 3-6: Route Handler GET /api/store 스모크
```ts
it("given_validSessionCookie_whenGetApiStore_thenReturns200WithTodayStoreJson", async () => {
  // next-test-api-route-handler 로 route handler in-process 호출
  // Then: body.offers.length === 4
});
```

#### Test 3-7: Route Handler 세션 없음 → 401
```ts
it("given_noSessionCookie_whenGetApiStore_thenReturns401", async () => { /* ... */ });
```

### 구현 항목

**파일**: `lib/riot/storefront.ts` (Phase 1 의 파싱 함수 옆)
- `async function getTodayStore(session: SessionPayload, deps: { fetcher: RiotFetcher }): Promise<TodayStore>`
- `RiotFetcher` 포트(Plan 0006) 를 DI 로 받으며, 포트 구현체가 헤더 주입/재시도/에러 매핑을 담당한다.
- 내부에서 `getClientVersion()`, `getSkinCatalog()`, `getTierCatalog()` 병렬(`Promise.all`) 호출 → `deps.fetcher.get(storefrontUrl, session)` → `parseStorefront` → `matchSkinMeta`
- 429 1회 재시도 (200ms) 및 5xx 즉시 예외 로직은 `RiotFetcher` 구현체(Plan 0006) 에 위임.
- 포트가 표준화한 에러 타입을 재수출: `TOKEN_EXPIRED`, `RIOT_5XX`, `RIOT_RATE_LIMITED` (Plan 0006 계약).
- `X-Riot-ClientPlatform` 은 상수 base64 payload (KR Windows PC) — 포트 구현체가 기본 헤더로 주입.

**파일**: `app/api/store/route.ts`
- `GET`: `getSession(cookies())` (from `lib/session/guard.ts`) → null 이면 Plan 0006 표준 에러 body `{ code: "UNAUTHENTICATED", message }` 로 401 → 아니면 `getTodayStore(session, { fetcher })` → `TodayStore` JSON 반환.
- 에러 응답 body 스키마: Plan 0006 표준 `{ code, message }`.
  - `TOKEN_EXPIRED` → 401
  - `RIOT_RATE_LIMITED` → 502 (5xx 대역 유지)
  - `RIOT_5XX` → 502 (upstream 장애 유지)
  - 기타 → 500 `{ code: "INTERNAL_ERROR", message }`
- `export const dynamic = "force-dynamic"` (세션 의존)

---

## Phase 4: SkinCard 컴포넌트 & Dashboard SSR

### 테스트 시나리오

#### Test 4-1: SkinCard 렌더 — 4개 필드 모두 표시
```ts
it("given_skinPropsWithAllFields_whenRenderSkinCard_thenDisplaysNamePriceVpTierIconAndImage", () => {
  // Given: { name: "Prime Vandal", priceVp: 1775, imageUrl: "...", tierIconUrl: "..." }
  // When: render(<SkinCard skin={...} />)
  // Then: getByText("Prime Vandal"), getByText("1,775 VP"), getByRole("img", { name: /Prime Vandal/ }),
  //       tier 아이콘 img 존재, data-testid="skin-card"
});
```

#### Test 4-2: priceVp 천단위 포맷
```ts
it("given_priceVp1775_whenRender_thenDisplaysCommaFormatted1_775_VP", () => { /* ... */ });
```

#### Test 4-3: tierIconUrl null → 아이콘 없이 카드 여전히 렌더
```ts
it("given_tierIconUrlNull_whenRender_thenCardRendersWithoutTierIcon", () => { /* ... */ });
```

#### Test 4-4: next/image `priority` 적용 (LCP 최적화 검증)
```ts
it("given_skinCard_whenRender_thenImgTagHasFetchpriorityHighOrNextImagePriorityAttribute", () => {
  // Then: <img fetchpriority="high"> (next/image priority 적용 결과)
});
```

#### Test 4-5: Dashboard SSR 통합 — 4 카드 HTML 포함
```ts
it("given_validSession_whenRenderDashboardServerComponent_thenHtmlContainsFourSkinCardDataTestid", async () => {
  // Given: getSession mock → valid, getTodayStore mock → 4 offers
  // When: await DashboardPage() 렌더 후 HTML 직렬화
  // Then: 4×data-testid="skin-card"
});
```

#### Test 4-6: Dashboard 세션 없음 → /login 리다이렉트
```ts
it("given_noSession_whenRenderDashboard_thenRedirectsToLogin", async () => {
  // Then: redirect("/login") 호출
});
```

#### Test 4-7: Dashboard storefront 에러 → 에러 카드 + 재시도 버튼
```ts
it("given_storefrontThrowsRiotUpstreamError_whenRenderDashboard_thenShowsErrorStateWithRetryButton", async () => { /* ... */ });
```

#### Test 4-8: Playwright E2E — 로그인 mock → /dashboard 4카드 보임 + Lighthouse TTI ≤ 3s
```ts
// tests/e2e/dashboard.spec.ts
test("given_authenticatedSession_whenVisitDashboard_thenFourCardsVisibleAndLighthouseTtiUnder3s", async ({ page }) => {
  // Given: MSW 가 Riot + valorant-api mock, session cookie 주입
  // When: page.goto('/dashboard')
  // Then:
  //   await expect(page.getByTestId('skin-card')).toHaveCount(4);
  //   Lighthouse Mobile 실행 (playwright-lighthouse) → Interactive ≤ 3000ms assert
});
```

### 구현 항목

**파일**: `components/SkinCard.tsx`
- Props: `{ skin: Skin; priority?: boolean }`
- shadcn/ui `Card` + `CardContent` 기반 (ADR-0007)
- `next/image` with `priority` (첫 4개), `sizes="(max-width: 640px) 50vw, 25vw"`, 고정 `width`/`height`
- 가격: `Intl.NumberFormat("ko-KR").format(priceVp) + " VP"`
- 티어 아이콘은 24×24 `next/image`
- `data-testid="skin-card"`

**파일**: `components/ui/card.tsx`
- shadcn/ui `Card` 컴포넌트 복사 (CLI: `npx shadcn@latest add card`)

**파일**: `app/(app)/dashboard/page.tsx`
- `export default async function DashboardPage()` — Server Component
- `const session = await requireSession()` (from `lib/session/guard.ts`) — 세션 없으면 내부적으로 `/login` 리다이렉트 (Plan 0002 계약). nullable 이 필요한 경로는 `getSession()` 사용.
- `try { const store = await getTodayStore(session, { fetcher }); } catch (e) { if (e.code === "TOKEN_EXPIRED") redirect("/login") }`
- 그리드: `grid grid-cols-2 gap-4 md:grid-cols-4` + 4×`<SkinCard priority />`
- 에러 시 `<StoreErrorState />` 컴포넌트 (재시도 버튼 = `window.location.reload()`)
- `export const dynamic = "force-dynamic"` (세션별 SSR)

**파일**: `components/StoreErrorState.tsx`
- 에러 메시지 + "다시 시도" 버튼 (client component, `"use client"`)

> **제외**: `next.config.ts` 는 Plan 0010 소유이므로 본 Plan 에서 수정하지 않는다. `images.remotePatterns` 에 `valorant-api.com` / `media.valorant-api.com` 포함은 Plan 0010 이 보장한다.

---

## NFR 반영

본 Plan 의 핵심 NFR 은 **Performance TTI ≤ 3s (PRD §6 / AC-1 / AC-4)**. 이를 다층적으로 달성한다.

### Performance (TTI ≤ 3s, API p95 ≤ 1s)

| 전략 | 구현 위치 | 기대 효과 |
|---|---|---|
| **SSR Server Component** | `app/(app)/dashboard/page.tsx` — `async function` 내부에서 storefront 호출 후 HTML 에 4카드 직접 포함 | 클라이언트 페칭 waterfall 제거, FCP=렌더 완료 근접 |
| **병렬 외부 호출** | `getTodayStore` 내 `Promise.all([getClientVersion, getSkinCatalog, getTierCatalog])` → 이후 storefront | 4회 직렬 → 2회 직렬, 체감 지연 -40% 예상 |
| **ISR 캐시** | skin catalog 86400s / tier catalog 86400s / version 3600s (ADR-0003, ADR-0005) | 수 MB 카탈로그 fetch 를 엣지 캐시 히트로 수 ms |
| **stale-while-revalidate** | Next.js `revalidate` 기본 동작 | 캐시 만료 순간에도 즉시 이전 응답 제공 |
| **Vercel Edge Network** | 배포 기본값, `dynamic = "force-dynamic"` 라도 정적 자산은 엣지 | KR 리전 latency 단축 |
| **next/image `priority`** | `SkinCard` 첫 4개 모두 `priority`, `sizes` 지정 | LCP 이미지 preload, WebP 자동 변환으로 이미지 바이트 -30~50% |
| **Tailwind JIT + shadcn/ui** (ADR-0007) | 런타임 CSS-in-JS 없음, 사용된 class 만 빌드 | CSS 번들 수 KB |
| **Route Handler 우회** | 서버 컴포넌트가 HTTP 대신 내부 함수 직접 호출 | in-process 호출로 한 왕복 제거 |
| **Riot 재시도 제한** | 429 1회만, 5xx 즉시 실패 | 테일 레이턴시 억제 → p95 ≤ 1s |

### 측정 (테스트 시나리오 연결)

- **Test 4-8 (Playwright + Lighthouse)**: `playwright-lighthouse` 로 Mobile slow-4G throttling 환경에서 `metrics.interactive ≤ 3000ms` assert. CI 없음(ARCHITECTURE §6) 이므로 로컬 `npm run test:e2e` 시 실행, 결과는 PR 설명에 첨부.
- **Chrome DevTools 수동 측정** (AC-4): 실제 `*.vercel.app` 배포 후 Lighthouse Mobile 실행하여 TTI ≤ 3s 확인.
- **단위 테스트 (Test 2-1, 2-3, 2-4)**: `fetch` 두 번째 인자의 `revalidate` 값을 assert 하여 캐시 설정이 실수로 빠지지 않음을 보장(성능 회귀 방지).

### Cost ($0/월)

- `valorant-api.com` 메타 ISR 캐싱 필수 (ADR-0003). 캐시 미스만 외부 트래픽 발생 → 무료 티어 여유.
- Vercel fetch 캐시 엔트리 한도(50MB/entry) 내: skins 카탈로그 ~수 MB, tiers 수 KB.

### Security (HTTPS only)

- 모든 외부 fetch 는 `https://` (리터럴 하드코딩, http fallback 금지).
- `session` cookie 는 httpOnly + SameSite=Lax + Secure (FR-2 가정).
- Route Handler 는 세션 없으면 즉시 401 반환, 토큰 값 로그 금지.

### Compliance (Riot ToS, fan-made 고지)

- 대시보드 페이지 하단에 `<Footer />` 렌더 (별 Phase 로 이미 존재 가정; 본 Plan 은 `layout.tsx` 가 Footer 를 포함한다고 가정).
- storefront 호출은 공식 승인이 아닌 비공식 경로(PRD §7) — 본 Plan 범위 내 추가 대응 없음.

### Operability (Vercel 로그)

- `getTodayStore` 내 catch 에서 `console.error` 로 Riot 응답 상태만 기록 (토큰 미포함).
- Route Handler 의 상태 코드 매핑으로 Vercel dashboard 에서 에러율 확인 가능.

### Maintainability (상점 파싱 단위 테스트 필수)

- `parseStorefront` 는 순수 함수로 분리되어 Test 1-1~1-3 이 직접 커버.
- `matchSkinMeta` 도 순수 함수 (Test 1-4~1-5).
- 외부 의존은 MSW 로 목킹 → critical path 테스트가 네트워크 없이 실행(ADR-0006).

### Scale (~50 concurrent)

- SSR 렌더는 Vercel Serverless 자동 스케일.
- ISR 캐시로 외부 API 호출 빈도가 동시 접속 수와 무관해짐.

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (도메인/파싱)
  ├─ 1-1, 1-2, 1-3 (parseStorefront) ──┐
  ├─ 1-4, 1-5 (matchSkinMeta) ─────────┤
  └─ 1-impl (lib/domain, lib/riot/storefront parse, lib/valorant-api/match)
                                        │
                                        ▼
Phase 2 (캐시 레이어) — Phase 1 의 타입 참조
  ├─ 2-1, 2-2 (skin catalog) ──┐
  ├─ 2-3 (tier catalog) ────────┤
  ├─ 2-4 (client version) ──────┤
  └─ 2-impl (lib/valorant-api/catalog, lib/riot/version)
                                 │
                                 ▼
Phase 3 (Store Proxy) — Phase 1 + Phase 2 필요
  ├─ 3-1 ~ 3-5 (getTodayStore) ─┐
  ├─ 3-6, 3-7 (route handler) ──┤
  └─ 3-impl (getTodayStore + app/api/store/route.ts)
                                 │
                                 ▼
Phase 4 (UI) — Phase 3 필요
  ├─ 4-1 ~ 4-4 (SkinCard) ──┐
  ├─ 4-5 ~ 4-7 (Dashboard) ─┤
  ├─ 4-8 (E2E + Lighthouse) ┤
  └─ 4-impl (components/SkinCard, components/ui/card,
             app/(app)/dashboard/page, components/StoreErrorState,
             next.config.ts)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3, 1-4, 1-5 테스트 작성 | 없음 | ✅ |
| G2 | 1-impl (storefront parse, match, domain types) | G1 완료 | - (같은 파일군) |
| G3 | 2-1, 2-2, 2-3, 2-4 테스트 작성 | G2 완료 | ✅ |
| G4 | 2-impl (catalog.ts, version.ts) | G3 완료 | ✅ (서로 다른 파일) |
| G5 | 3-1 ~ 3-7 테스트 작성 | G4 완료 | ✅ |
| G6 | 3-impl (getTodayStore 확장 + route handler) | G5 완료 | - (storefront.ts 단일 파일) |
| G7 | 4-1 ~ 4-4 SkinCard 테스트 | G6 완료 | ✅ |
| G8 | 4-5 ~ 4-7 Dashboard 테스트 | G6 완료 | ✅ |
| G9 | 4-impl (SkinCard, Dashboard, StoreErrorState, next.config, ui/card) | G7, G8 완료 | ✅ (파일 분리) |
| G10 | 4-8 Playwright E2E + Lighthouse | G9 완료 | - |

### 종속성 판단 기준

- **G2 순차**: `lib/riot/storefront.ts` 에 `parseStorefront` 와 Phase 3 `getTodayStore` 가 같은 파일에 공존 → 파일 충돌 방지 위해 Phase 단위 순차.
- **G4 병렬**: `catalog.ts` 와 `version.ts` 는 별 파일, 상호 참조 없음.
- **G9 병렬**: SkinCard/Dashboard/StoreErrorState/next.config/ui 카드 복사 각각 독립 파일.
- Phase 간 순차는 타입/함수 참조 의존 (`Skin` 타입 → `getTodayStore` → `<SkinCard>`).

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | parseStorefront 정상 파싱 테스트 | ⬜ 미착수 | |
| 1-2 | rotationEndsAt epoch 변환 테스트 | ⬜ 미착수 | |
| 1-3 | 필수 필드 누락 예외 테스트 | ⬜ 미착수 | |
| 1-4 | matchSkinMeta 정상 매핑 테스트 | ⬜ 미착수 | |
| 1-5 | matchSkinMeta 누락 UUID placeholder 테스트 | ⬜ 미착수 | |
| 1-impl | 도메인 타입 + parseStorefront + matchSkinMeta 구현 | ⬜ 미착수 | `lib/domain/skin.ts`, `lib/riot/storefront.ts`, `lib/valorant-api/match.ts` |
| 2-1 | skin catalog ISR 86400 검증 테스트 | ⬜ 미착수 | |
| 2-2 | skin catalog Map 변환 테스트 | ⬜ 미착수 | |
| 2-3 | tier catalog 테스트 | ⬜ 미착수 | |
| 2-4 | client version ISR 3600 테스트 | ⬜ 미착수 | |
| 2-impl | catalog.ts + version.ts 구현 | ⬜ 미착수 | |
| 3-1 | getTodayStore 정상 경로 테스트 | ⬜ 미착수 | |
| 3-2 | 필수 헤더 주입 테스트 | ⬜ 미착수 | |
| 3-3 | 401 TokenExpiredError 테스트 | ⬜ 미착수 | |
| 3-4 | 429 1회 재시도 성공 테스트 | ⬜ 미착수 | |
| 3-5 | 5xx 재시도 없음 테스트 | ⬜ 미착수 | |
| 3-6 | Route Handler 200 스모크 | ⬜ 미착수 | |
| 3-7 | Route Handler 세션 없음 401 | ⬜ 미착수 | |
| 3-impl | getTodayStore + `app/api/store/route.ts` 구현 | ⬜ 미착수 | |
| 4-1 | SkinCard 전체 필드 렌더 테스트 | ⬜ 미착수 | |
| 4-2 | priceVp 천단위 포맷 테스트 | ⬜ 미착수 | |
| 4-3 | tierIconUrl null 처리 테스트 | ⬜ 미착수 | |
| 4-4 | next/image priority 검증 테스트 | ⬜ 미착수 | NFR Performance |
| 4-5 | Dashboard SSR 4카드 HTML 테스트 | ⬜ 미착수 | |
| 4-6 | Dashboard 세션 없음 redirect 테스트 | ⬜ 미착수 | |
| 4-7 | Dashboard 에러 상태 테스트 | ⬜ 미착수 | |
| 4-8 | Playwright E2E + Lighthouse TTI ≤ 3s | ⬜ 미착수 | **AC-1/AC-4 직접 검증** |
| 4-impl | SkinCard, ui/card, Dashboard page, StoreErrorState, next.config 이미지 설정 | ⬜ 미착수 | |
| 4-config | `next.config.ts` `images.remotePatterns` 에 `media.valorant-api.com` 추가 | ⬜ 미착수 | |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
