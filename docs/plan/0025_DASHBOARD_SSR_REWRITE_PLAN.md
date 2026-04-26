# Plan 0025: Dashboard SSR 재작성

## 개요
`app/(app)/dashboard/page.tsx` 를 async **server component** 로 재작성하여 ARCHITECTURE.md 의 "GET /dashboard (SSR)" 방침과 정합시킨다. 현재는 client component 가 마운트 후 `/api/store` 를 fetch 해서 HTML 첫 페인트가 "로딩 중..." 만 포함, `tests/critical-path/dashboard-ssr.test.tsx` 6 케이스가 모두 실패. SSR 화 후 서버에서 세션·스토어프론트를 호출하고, 4 개의 SkinCard 와 에러 상태가 SSR HTML 에 박혀 나오도록 만든다.

## 배경 — 왜 지금 CSR 인가

원래 `dashboard/page.tsx` 는 async server component (`requireSession` + `getTodayStore` + `<SkinCard>` 4개 SSR + `redirect("/login")`) 였음. commit **`1f7fa0ec` "impl(0006): Phase 4-5 클라이언트/로그인 에러 처리 완료"** 에서 SSR 경로를 통째로 삭제하고 `DashboardClient` (CSR) 로 교체. 이유는 Phase 4 의 "ErrorBoundary + 재시도 버튼 + 401 자동 재로그인" UI 를 클라이언트에서 구현하기 위함.

이 변경은 **ADR 없이, Plan 0006 의 설계 테이블 (L42 "SSR 경로에서는 302 리다이렉트") 과 ARCHITECTURE.md ("GET /dashboard (SSR)") 양쪽과 어긋난 채** 머지됨. dashboard-ssr 테스트 6 케이스는 같이 삭제되지 않고 orphan 으로 남아 모두 실패 상태. 본 plan 은 SSR 로 복원하면서 Phase 4 가 의도한 UX (`StoreErrorState` + 재시도 + 401 자동 재로그인) 를 SSR 호환 방식으로 보존:
- 401 / TOKEN_EXPIRED → server-side `redirect("/login...")` (Plan 0006 L42 설계)
- 429 / 5xx → SSR `<StoreErrorState>` + 작은 client island `<RetryButton>` (`router.refresh()`)

즉 SSR 로 돌아가는 것이 **ARCHITECTURE + Plan 0006 원래 설계** 로의 회귀이며, CSR 전환이 사후적 이탈이었다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 렌더링 모드 | server component (async) | `docs/ARCHITECTURE.md` 의 "GET /dashboard (SSR)" + Performance NFR (TTI ≤ 3s) 언급. CSR 은 추가 round-trip → TTI 악화 |
| 세션 누락 처리 | `redirect("/login")` (Next.js redirect) | 401 자동 재로그인 (Plan 0006) 의 server-side 등가물. 클라이언트 깜빡임 없음 |
| 토큰 만료 (`TOKEN_EXPIRED`) 처리 | `redirect("/login?reason=expired")` | 동일. 사용자에게 만료 사유 표면화 |
| 일시적 에러 (`RIOT_RATE_LIMITED`, `RIOT_5XX`, `UPSTREAM_UNAVAILABLE`) | 페이지 안에 `StoreErrorState` 렌더 + 재시도 버튼 (client island) | 재로그인 불필요. 사용자가 재시도 버튼으로 페이지 새로고침 |
| 재시도 버튼 | `"use client"` 작은 island (예: `RetryButton.tsx`) — `router.refresh()` 호출 | 서버 컴포넌트 재실행으로 fresh fetch. 별도 `/api/store` 라우트 호출 없이 동일 SSR 경로 재사용 |
| 기존 CSR 코드 (`DashboardClient.tsx`) | 제거. 401 자동 재로그인 로직은 SSR redirect 로 대체 | 단일 책임 + Plan 0006 의 client-side fallback 은 SSR redirect 와 중복 |
| 기존 `/api/store` route | 유지 (현재 PWA / 카운트다운 동작 검토 필요시 사용 가능) | 쓰지 않더라도 외부 영향 없음. 단 사용처가 `DashboardClient` 만이라면 후속 cleanup 가능 |
| 테스트 파일 | `tests/critical-path/dashboard-ssr.test.tsx` 그대로 사용. redirect 검증 케이스만 mock 보강 | 테스트가 이미 SSR 가정으로 작성됨 (mocks: `requireSession`, `getTodayStore`, `renderToString(await DashboardPage())`) |
| `next/navigation` `redirect` mock | `tests/helpers/next-navigation-mock.ts` 의 redirect throw `NEXT_REDIRECT` 활용 | Plan 0025 의 PR-5 (#35) 에서 이미 헬퍼 존재. dashboard-ssr 테스트에 적용 |

---

## Phase 1: SSR happy path — 4 카드 렌더

### 테스트 시나리오

#### Test 1-1: 유효 세션 + 4 offers → SkinCard 4 개 SSR
```ts
it("given_validSession_whenRenderDashboardServerComponent_thenHtmlContainsFourSkinCardDataTestid", async () => {
  // Given: requireSession 성공, getTodayStore 4 offers 반환
  vi.mocked(requireSession).mockResolvedValue(mockSession);
  vi.mocked(getTodayStore).mockResolvedValue(mockStore);
  // When: await DashboardPage() → renderToString
  const html = renderToString(await DashboardPage());
  // Then: data-testid="skin-card" 4개
  expect(html.match(/data-testid="skin-card"/g)).toHaveLength(4);
});
```

#### Test 1-2: SSR HTML 에 모든 스킨 이름 포함
```ts
it("given_validSession_whenRenderDashboard_thenContainsAllSkinNames", async () => {
  // Given/When 동일
  const html = renderToString(await DashboardPage());
  // Then
  expect(html).toContain("Prime Vandal");
  expect(html).toContain("Reaver Vandal");
  expect(html).toContain("Elderflame Vandal");
  expect(html).toContain("Prelude to Chaos Vandal");
});
```

### 구현 항목 (1-impl)

**파일**: `app/(app)/dashboard/page.tsx`
- `"use client"` 제거 (이미 server)
- `export default async function DashboardPage()` 으로 변경
- `await requireSession()` 호출 (try/catch 없이 에러 throw 허용)
- `await getTodayStore(session)` 호출
- 응답의 `offers` 를 `<SkinCard>` 4 개로 매핑
- 기존 header (Countdown, LogoutButton) 유지

**파일**: `app/(app)/dashboard/DashboardClient.tsx`
- 삭제 (또는 `RetryButton` 만 남기는 형태로 축소 — Phase 2 에서 결정)

---

## Phase 2: 에러 분기 — redirect 와 StoreErrorState

### 테스트 시나리오

#### Test 2-1: 세션 없음 → /login redirect
```ts
it("given_noSession_whenRenderDashboard_thenRedirectsToLogin", async () => {
  // Given: requireSession 이 UNAUTHENTICATED throw
  vi.mocked(requireSession).mockRejectedValue(new Error("UNAUTHENTICATED"));
  // When/Then: redirect 호출 → NEXT_REDIRECT throw
  await expect(DashboardPage()).rejects.toThrow(/NEXT_REDIRECT|UNAUTHENTICATED/);
});
```
> 기존 테스트는 "에러 상태 표시" 를 검증하지만, ARCHITECTURE 와 정합시키기 위해 redirect 로 변경. 테스트 어설션도 같이 업데이트.

#### Test 2-2: TOKEN_EXPIRED → /login?reason=expired redirect
```ts
it("given_tokenExpiredError_whenRenderDashboard_thenRedirectsToLogin", async () => {
  vi.mocked(requireSession).mockResolvedValue(mockSession);
  vi.mocked(getTodayStore).mockRejectedValue(new RiotApiError("TOKEN_EXPIRED", "Token expired"));
  await expect(DashboardPage()).rejects.toThrow(/NEXT_REDIRECT/);
});
```

#### Test 2-3: RIOT_5XX → 에러 카드 + 재시도 버튼 SSR
```ts
it("given_storefrontThrowsRiotUpstreamError_whenRenderDashboard_thenShowsErrorStateWithRetryButton", async () => {
  vi.mocked(requireSession).mockResolvedValue(mockSession);
  vi.mocked(getTodayStore).mockRejectedValue(new RiotApiError("RIOT_5XX", "Riot server error"));
  const html = renderToString(await DashboardPage());
  expect(html).toContain("상점 정보를 불러올 수 없습니다");
  expect(html).toMatch(/data-testid="retry-button"|재시도/);
});
```

#### Test 2-4: RIOT_RATE_LIMITED → 에러 카드
```ts
it("given_storefrontThrowsRateLimitedError_whenRenderDashboard_thenShowsErrorState", async () => {
  vi.mocked(requireSession).mockResolvedValue(mockSession);
  vi.mocked(getTodayStore).mockRejectedValue(new RiotApiError("RIOT_RATE_LIMITED", "Rate limited"));
  const html = renderToString(await DashboardPage());
  expect(html).toContain("상점 정보를 불러올 수 없습니다");
});
```

### 구현 항목

#### 2-impl-redirect
**파일**: `app/(app)/dashboard/page.tsx`
- `requireSession()` 의 `UNAUTHENTICATED` catch → `redirect("/login")`
- `getTodayStore()` 의 `RiotApiError("TOKEN_EXPIRED")` catch → `redirect("/login?reason=expired")`
- `next/navigation` 의 `redirect` import

#### 2-impl-error-state
**파일**: `app/(app)/dashboard/page.tsx`
- `RiotApiError("RIOT_RATE_LIMITED" | "RIOT_5XX" | "UPSTREAM_UNAVAILABLE")` catch → `<StoreErrorState />` 렌더 (또는 기존 `StoreErrorView` 재사용)
- 그 외 알 수 없는 에러 → `throw` 그대로 두어 ErrorBoundary 가 잡도록

#### 2-impl-retry-button
**파일**: `app/(app)/dashboard/RetryButton.tsx` (신규)
- `"use client"` 작은 island
- onClick: `useRouter().refresh()` 호출
- `data-testid="retry-button"` 부여
- `StoreErrorState` 또는 page.tsx 의 에러 분기에서 직접 사용

---

## Phase 3: CSR 잔재 정리

### 테스트 시나리오

#### Test 3-1: `/api/store` 라우트는 그대로 동작 (회귀 방지)
- 기존 `tests/critical-path/api-store.test.ts` 가 이미 검증 — 신규 테스트 불필요. 본 Phase 에서 회귀 안 나는지만 확인.

#### Test 3-2: `tests/critical-path/client-error-handling.test.tsx` 의 401 자동 재로그인 케이스 재평가
- 현재 client 측 `fetch('/api/store')` 후 401 → `router.replace('/auth/start')` 검증.
- SSR redirect 로 동일 사용자 시나리오 커버되므로 이 테스트는 **삭제 또는 `/api/store` 직접 호출 (PWA 등) 시나리오로 한정**.

### 구현 항목

#### 3-impl-cleanup
**파일**: `app/(app)/dashboard/DashboardClient.tsx`
- 파일 삭제. import 사용처는 `app/(app)/dashboard/page.tsx` 만이므로 page.tsx 에서 제거하면 끝.

**파일**: `tests/critical-path/client-error-handling.test.tsx`
- 401 자동 재로그인 시나리오 삭제 또는 PWA fetch 경로로 한정.
- 현재 가지고 있는 다른 시나리오 (429/5xx 클라이언트 에러 UI) 가 `/api/store` 의 직접 호출자가 없는 한 모두 obsolete — 케이스별 검토.

---

## 작업 종속성

### 종속성 그래프
```
Phase 1 ──┬─ 1-1 테스트 ─┐
          └─ 1-2 테스트 ─┴─→ 1-impl (page.tsx SSR 재작성)
                                     │
Phase 2 ──┬─ 2-1 테스트 ──→ 2-impl-redirect ──┐
          ├─ 2-2 테스트 ──→ 2-impl-redirect ──┤
          ├─ 2-3 테스트 ──→ 2-impl-error-state ─┐
          ├─ 2-4 테스트 ──→ 2-impl-error-state ─┤
          └────────────→ 2-impl-retry-button ──┘ (Phase 1 완료 필요)
                                     │
Phase 3 ──── 3-2 테스트 정리 ── 3-impl-cleanup (Phase 2 완료 필요)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2 테스트 (기존 유지) | 없음 | ✅ |
| G2 | 1-impl (page.tsx SSR 재작성) | G1 | - |
| G3 | 2-1, 2-2, 2-3, 2-4 테스트 어설션 갱신 | G2 | ✅ |
| G4 | 2-impl-redirect, 2-impl-error-state, 2-impl-retry-button | G3 | ⚠️ 같은 page.tsx 수정 → 순차 권장 |
| G5 | 3-2 client-error-handling 테스트 정리 | G4 | ✅ |
| G6 | 3-impl-cleanup (DashboardClient 삭제) | G4, G5 | - |

> Phase 2 의 세 impl 항목은 모두 page.tsx 한 파일을 건드리므로 **순차 머지**.

### 종속성 판단 기준
- **종속**: G2 → G3/G4 — page.tsx 의 새 server component 시그니처가 있어야 redirect/error 분기 추가 가능
- **종속**: G4 의 세 항목 — 같은 파일 수정 → 충돌 회피 위해 순차
- **독립**: G1 의 테스트 두 개 — 같은 파일이지만 독립 시나리오, 동시 작성 가능
- **독립**: G3 의 네 테스트 어설션 갱신 — 한 파일 내 별개 케이스

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | given_validSession_whenRenderDashboardServerComponent_thenHtmlContainsFourSkinCardDataTestid | ✅ 완료 | 기존 테스트 유지 |
| 1-2 | given_validSession_whenRenderDashboard_thenContainsAllSkinNames | ✅ 완료 | 기존 테스트 유지 |
| 1-impl | page.tsx 를 async server component 로 재작성 | ✅ 완료 | |
| 2-1 | given_noSession_whenRenderDashboard_thenRedirectsToLogin | ✅ 완료 | 어설션 redirect 로 변경 |
| 2-2 | given_tokenExpiredError_whenRenderDashboard_thenRedirectsToLogin | ✅ 완료 | NEXT_REDIRECT throw 검증 |
| 2-3 | given_storefrontThrowsRiotUpstreamError_whenRenderDashboard_thenShowsErrorStateWithRetryButton | ✅ 완료 | retry-button data-testid 검증 추가 |
| 2-4 | given_storefrontThrowsRateLimitedError_whenRenderDashboard_thenShowsErrorState | ✅ 완료 | |
| 2-impl-redirect | UNAUTHENTICATED / TOKEN_EXPIRED → redirect | ✅ 완료 | |
| 2-impl-error-state | RIOT_5XX / RIOT_RATE_LIMITED → StoreErrorState | ✅ 완료 | |
| 2-impl-retry-button | RetryButton.tsx (client island) | ✅ 완료 | |
| 3-2 | client-error-handling 테스트 정리 | ✅ 완료 | obsolete 케이스 식별/삭제 |
| 3-impl | DashboardClient.tsx 삭제 + page.tsx import 정리 | ✅ 완료 | |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
