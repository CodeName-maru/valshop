> **DEPRECATED (replaced by plan 0018~0023 auth redesign)**
> 본 plan 은 Riot implicit-grant redirect 를 전제로 작성됐으나,
> spec `docs/superpowers/specs/2026-04-24-auth-redesign-design.md` 에 따라
> PW 프록시 + ssid reauth 패턴으로 전면 재설계됨. 이력 보존 목적으로만 유지.

# Plan 0015: 로그인 버튼 → `/api/auth/start` 배선

## 개요

`(app)/login` 페이지에 남아 있는 placeholder ("로그인 기능은 현재 준비 중입니다") 를 제거하고, "Riot 로 로그인" 버튼을 Plan 0001 에서 머지된 `/api/auth/start` 진입점과 실제로 배선한다. PRD FR-1 의 사용자 가시 경로(MVP 첫 화면)를 완성하며, FR-6 의 로그인 단계 에러 표면화(쿼리 `?error=<code>` → 한국어 배너) 를 본 페이지에서 소비한다. 본 Plan 은 **클라이언트 UI 배선과 에러 표면화에 한정**되며, 서버 라우트(`/api/auth/start`, `/api/auth/callback`, callback/hash) 와 RiotFetcher·세션·crypto 계약은 Plan 0001/0002/0006 의 산출물을 그대로 소비한다.

## 가정사항 (Cross-plan 의존성·요구사항 해석)

요구사항 본문은 "ID/PW 입력 후 로그인 버튼 → `/api/auth/start` 호출" 로 기술되어 있으나, 이는 **PRD § 6 Security NFR (PW 서버 미저장)** 및 **ADR-0001 (비공식 Riot auth flow)** 와 직접 충돌한다. Plan 0001 가 머지한 실제 흐름은 (a) 사용자가 "Riot 로 로그인" 버튼을 누름 → (b) `/api/auth/start` 가 state cookie 발급 후 `auth.riotgames.com` 으로 302 → (c) 사용자가 **Riot 도메인에서 직접** ID/PW(+2FA) 입력 → (d) implicit grant fragment 로 `/api/auth/callback` 또는 `/api/auth/callback/hash` 에 토큰 도착, 이다. 따라서 본 Plan 은 다음과 같이 해석한다:

- **앱 도메인에 ID/PW input 을 두지 않는다.** 이는 PRD Security 와 ADR-0001 에 의해 강제되는 비협상 결정이며, 요구사항 본문의 "ID/PW 입력 후" 문구는 "Riot 로그인 화면을 거친 뒤" 로 재해석된다.
- "2FA 필요 → 코드 입력 화면" 분기 또한 **Riot 도메인에서 처리**된다. 앱은 Riot 가 callback 으로 돌려준 결과(성공 / `mfa_required` / `invalid_credentials` / `upstream` / `state_mismatch` / `timeout` / `unknown`)만 query 로 받아 한국어 배너로 노출한다 (Plan 0006 Phase 5 와 일치).
- "즉시 성공 → 상점/홈 라우팅" 은 callback 측에서 이미 `/dashboard` 302 로 처리됨 (Plan 0001). 본 Plan 은 클라이언트가 `/api/auth/start` 로 navigate 하기만 하면 되며, 성공 라우팅은 서버 책임.
- "폼 검증 (빈 입력 차단)" 은 ID/PW input 이 부재하므로 **버튼 활성화 가드 — 시작 요청 in-flight 동안 disabled** 로 대체한다.
- 본 Plan 은 `app/(app)/login/page.tsx` 만 수정한다. `app/(auth)/login/page.tsx` (Plan 0001 산출물) 와 라우트 그룹이 다르나, **현재 코드베이스의 활성 로그인 페이지는 `(app)/login`** 이므로 후자를 본 Plan 의 단일 진실 소스로 채택한다. (`(auth)/login` 의 존재 여부와 무관하게 본 Plan 의 변경은 `(app)/login` 한 파일에 격리된다.)
- 디자인 토큰·Tailwind 클래스는 기존 placeholder 의 `text-muted-foreground`, `border-border`, `bg-card` 컨벤션을 그대로 따른다 (ADR-0007 styling framework).
- 신규 런타임 의존 0 (`useState`, `useSearchParams`, native `<a>`/`<button>` 만 사용). React Testing Library + Vitest 는 기존 `client-error-handling.test.tsx` 등에서 이미 도입되어 추가 의존 없음.

## 설계 결정사항

| 항목 | 결정 | 근거 (NFR) |
|------|------|------|
| 서버 호출 방식 | `<a href="/api/auth/start">` 기반 navigate (전체 페이지 이동, fetch 아님) — JS 비활성 환경에서도 동작 | Performance(p95 ≤ 1s, 추가 RTT 0), Availability(JS 실패에도 진입), Security(서버 302 그대로 따름) |
| 클릭 시 보조 동작 | `onClick` 으로 `loading=true` 상태 → 버튼 disabled + "이동 중…" 라벨, default navigation 은 그대로 진행 (preventDefault 금지) | UX, Maintainability (의도 명확) |
| Form 검증 | ID/PW input 부재 — "빈 입력 차단" 요구는 본 페이지 적용 불가 → **다중 클릭 차단(disabled)** 으로 대체 | Security(중복 state cookie 발급 회피), 가정사항 § 4 |
| 에러 코드 노출 | `useSearchParams().get("error")` 로 화이트리스트 코드 → 한국어 메시지 매핑. 알 수 없는 코드는 "unknown" 메시지 | Security(서버에서 분류된 코드만 신뢰, 사용자 입력 raw 미노출), Plan 0006 Phase 5-3 정합 |
| 에러 메시지 테이블 위치 | `app/(app)/login/page.tsx` 내부 const map. 별도 파일 분리 비용 > 이득 (총 6~7 entries) | Maintainability(단일 파일 응집) |
| Footer | 기존 푸터 ("팬메이드 프로젝트") 카드 내부 텍스트 유지 + 전역 `<Footer />` 가 별도 Plan 에서 주입 시 충돌 없도록 카드 내부 마이크로 카피로 한정 | Compliance (PRD § 7 fan-made 고지) |
| 클라이언트 컴포넌트 분리 | 페이지 자체를 `"use client"` 로 변환 (input 상태·useSearchParams 필요). metadata 는 별도 layout 또는 동일 파일 export 유지 가능 — 본 Plan 은 페이지에서 metadata export 제거하고 인접 `layout.tsx` 또는 `head.tsx` 위임은 범위 외, 페이지에 `"use client"` 만 부여 | Maintainability, Performance (TTI 영향 미미; 단일 버튼) |
| 메타데이터 처리 | 페이지가 client component 가 되면 `export const metadata` 가 무효 → 동일 디렉토리에 `layout.tsx` 가 없으면 새로 생성하여 metadata 를 옮긴다 (별도 구현 항목으로 명시) | Performance (SEO 영향은 로그인 페이지라 미미하나 컨벤션 준수), Maintainability |
| 로딩 상태 reset | `pageshow` 이벤트(bfcache 복귀) 에서 `loading=false` 로 강제 reset — 사용자가 Riot 페이지에서 뒤로가기로 돌아왔을 때 disabled 잔존 방지 | Availability (UX 차단 방지) |
| 테스트 스택 | Vitest + @testing-library/react + jsdom (기존 `*.test.tsx` 와 동일 하네스). 네트워크 호출 없음 → MSW 불필요 | Maintainability (critical path 단위 테스트 — NFR Maintainability), Cost (의존 0) |
| 로그인 시작 요청 method | `<a>` GET 만 사용 (POST 아님). state cookie 는 서버에서 GET 시 발급됨 (Plan 0001 의 `/api/auth/start` 시그니처) | Plan 0001 계약 준수 |

## NFR 반영

| 카테고리 | 반영 방식 | 검증 테스트 |
|---|---|---|
| Performance | (a) `<a href>` navigate — 추가 클라이언트 fetch RTT 0, (b) 페이지가 client component 이지만 단일 버튼·작은 state map 으로 JS payload 최소, (c) 에러 배너는 첫 페인트와 동시 렌더 (suspense 불필요) → TTI ≤ 3s 예산 영향 무시 가능 | Test 1-1 (네비게이션 트리거), Test 1-4 (loading 상태 즉시 반영) |
| Scale | 클라이언트 단일 페이지 컴포넌트, 서버 상태 점유 0. 동시 50 유저가 동시에 버튼을 눌러도 `/api/auth/start` 만 50회 호출되며 본 페이지 자체는 무상태 | (구조적 보장 — 측정 테스트 불필요) |
| Availability | (a) JS 실패 시에도 `<a href>` 가 동작, (b) bfcache 복귀 시 `pageshow` 로 disabled 해제, (c) 알 수 없는 에러 코드도 graceful fallback ("일시적인 문제가 발생했습니다") | Test 2-3 (unknown 코드 fallback), Test 1-5 (bfcache reset) |
| Security | (a) 앱 도메인에 PW input 부재 — PRD § 6 PW 서버 미저장 비협상 결정 준수, (b) 에러 코드는 화이트리스트 매핑, query string 의 raw 메시지를 직접 렌더하지 않음 (XSS·정보 누출 차단), (c) `<a>` 는 동일 오리진 절대 경로만 — open redirect 표면 0 | Test 2-1 (화이트리스트 외 → unknown), Test 2-4 (error query 의 HTML 미해석) |
| Compliance | 카드 내부 fan-made 고지 유지 (PRD § 7). Riot ToS 측면에서 PW 미수집 흐름 그대로 | Test 1-6 (fan-made 텍스트 존재) |
| Operability | 클라이언트 컴포넌트라 Vercel function log 영향 0. 에러 코드 매핑 미스 시 `console.warn(unknownErrorCode)` 만 (토큰/PII 무관) | Test 2-2 (unknown 코드 시 console.warn 호출) |
| Cost | 신규 런타임 의존 0, 외부 서비스 0. Vercel 빌드 size 증가 미미 | (의존 추가 금지로 달성 — 측정 불필요) |
| Maintainability | (a) Vitest critical-path 단위 테스트 6 종으로 버튼 동작 + 에러 배너 + bfcache + 화이트리스트를 커버 (PRD § 6 Maintainability — 로그인 flow critical path 단위 테스트 필수), (b) 에러 메시지 테이블은 Plan 0006 Phase 5 의 코드 화이트리스트와 동일 키 사용 → drift 시 grep 가능 | Phase 1, Phase 2 전체 |

---

## Phase 1: 로그인 버튼 동작 (정상 경로)

### 테스트 시나리오

#### Test 1-1: 버튼 클릭 시 `/api/auth/start` 로 navigate
```tsx
// tests/critical-path/login-page.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "@/app/(app)/login/page";

describe("Feature: 로그인 페이지 버튼 배선", () => {
  describe("Scenario: 정상 클릭", () => {
    it("givenIdleLoginPage_whenClickStartButton_thenAnchorPointsToAuthStart", async () => {
      // Given: 로그인 페이지 렌더, error 쿼리 없음
      render(<LoginPage />);
      // When: "Riot 로 로그인" 링크/버튼 조회
      const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
      // Then: href === "/api/auth/start" (전체 페이지 navigate 보장)
      expect(link).toHaveAttribute("href", "/api/auth/start");
    });
  });
});
```

#### Test 1-2: 클릭 직후 disabled + "이동 중…" 라벨
```tsx
it("givenIdleButton_whenClicked_thenBecomesDisabledWithLoadingLabel", async () => {
  // Given: 페이지 렌더
  render(<LoginPage />);
  const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
  // When: 사용자가 클릭
  await userEvent.click(link);
  // Then
  // - aria-disabled="true" (anchor 는 native disabled 불가 → aria 로 표현)
  // - 라벨이 "이동 중…" 으로 전환
  expect(link).toHaveAttribute("aria-disabled", "true");
  expect(link).toHaveTextContent(/이동 중/);
});
```

#### Test 1-3: 연속 클릭 차단 (중복 navigate 방지)
```tsx
it("givenButtonClickedOnce_whenClickedAgain_thenSecondClickPrevented", async () => {
  // Given: 클릭 핸들러가 default navigation 진행 직전 preventDefault 추적용 spy
  const preventDefault = vi.fn();
  render(<LoginPage />);
  const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
  await userEvent.click(link);
  // When: 두 번째 클릭 (event 에 preventDefault 캡처)
  link.addEventListener("click", (e) => { if (e.defaultPrevented) preventDefault(); });
  await userEvent.click(link);
  // Then: 두 번째 클릭은 default 가 prevent 됨
  expect(preventDefault).toHaveBeenCalledTimes(1);
});
```

#### Test 1-4: loading 상태 즉시 반영 (Performance 보조)
```tsx
it("givenClick_whenStateUpdates_thenDisabledFlagAppliedSynchronouslyAfterClick", async () => {
  // Given: 렌더
  render(<LoginPage />);
  const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
  // When: 클릭
  await userEvent.click(link);
  // Then: 같은 tick 내에 aria-disabled 적용 (사용자가 두 번째 클릭을 시도하기 전)
  expect(link.getAttribute("aria-disabled")).toBe("true");
});
```

#### Test 1-5: bfcache 복귀 시 loading 해제 (Availability)
```tsx
it("givenLoadingState_whenPageShowEventFired_thenLoadingResetToIdle", async () => {
  // Given: 클릭으로 loading=true 진입
  render(<LoginPage />);
  const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
  await userEvent.click(link);
  expect(link).toHaveAttribute("aria-disabled", "true");
  // When: pageshow 이벤트 dispatch (브라우저 뒤로가기 복귀 시뮬)
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  // Then: 다시 idle 라벨 + aria-disabled 해제
  expect(link).not.toHaveAttribute("aria-disabled", "true");
  expect(link).toHaveTextContent(/Riot 로 로그인/);
});
```

#### Test 1-6: fan-made 고지 텍스트 보존 (Compliance)
```tsx
it("givenLoginPage_whenRendered_thenFanMadeNoticePresent", () => {
  // Given/When
  render(<LoginPage />);
  // Then
  expect(screen.getByText(/팬메이드 프로젝트/)).toBeInTheDocument();
});
```

### 구현 항목

**파일**: `app/(app)/login/page.tsx`
- 파일 상단에 `"use client"` 추가.
- 기존 `export const metadata` 제거 (client component 충돌). metadata 는 인접 `layout.tsx` 로 이전 (별도 구현 항목).
- placeholder 카드 내부 ("로그인 기능은 현재 준비 중입니다") 를 다음으로 교체:
  - `<a>` 태그 (Tailwind primary 버튼 스타일) — `href="/api/auth/start"`, 라벨 "Riot 로 로그인".
  - `useState<boolean>` 으로 `loading` 관리. `onClick` 핸들러에서 (a) 이미 `loading=true` 면 `e.preventDefault()`, (b) 아니면 `setLoading(true)` 후 default navigation 진행.
  - `aria-disabled={loading}`, label = `loading ? "이동 중…" : "Riot 로 로그인"`.
  - `useEffect(() => { const onShow = (e: PageTransitionEvent) => setLoading(false); window.addEventListener("pageshow", onShow); return () => window.removeEventListener("pageshow", onShow); }, [])`.
- fan-made 안내 문구 유지.

**파일**: `app/(app)/login/layout.tsx` (신규)
- 단순 wrapper: `export const metadata = { title: "로그인", description: "VAL-Shop 로그인" }; export default function Layout({ children }) { return <>{children}</>; }`.
- 사유: page 가 client component 가 되어 metadata export 가 무시되므로 layout 으로 이전 (Maintainability — 컨벤션 준수).

---

## Phase 2: 에러 쿼리 표면화 (FR-6 / Plan 0006 Phase 5 정합)

### 테스트 시나리오

#### Test 2-1: 화이트리스트 에러 코드 → 한국어 배너
```tsx
it("givenErrorQueryMfaRequired_whenRendered_thenShowsKoreanBannerAndRetry", async () => {
  // Given: useSearchParams 가 ?error=mfa_required 반환하도록 모킹
  mockUseSearchParams("error=mfa_required");
  // When
  render(<LoginPage />);
  // Then
  expect(screen.getByRole("alert")).toHaveTextContent(/2단계 인증이 필요합니다/);
  expect(screen.getByRole("link", { name: /다시 시도/ })).toHaveAttribute("href", "/api/auth/start");
});
```

#### Test 2-2: 화이트리스트 외 코드 → unknown fallback + console.warn
```tsx
it("givenUnknownErrorCode_whenRendered_thenFallbackMessageAndWarnLogged", () => {
  // Given
  mockUseSearchParams("error=<script>alert(1)</script>");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // When
  render(<LoginPage />);
  // Then
  expect(screen.getByRole("alert")).toHaveTextContent(/일시적인 문제가 발생했습니다/);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknownErrorCode"));
});
```

#### Test 2-3: 에러 query 부재 시 배너 미렌더
```tsx
it("givenNoErrorQuery_whenRendered_thenNoAlertBanner", () => {
  mockUseSearchParams("");
  render(<LoginPage />);
  expect(screen.queryByRole("alert")).toBeNull();
});
```

#### Test 2-4: error query 의 HTML 미해석 (Security)
```tsx
it("givenErrorQueryWithHtml_whenRendered_thenContentEscapedNotInjected", () => {
  // Given: ?error=<img src=x onerror=alert(1)>
  mockUseSearchParams("error=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E");
  // When
  const { container } = render(<LoginPage />);
  // Then: <img> 태그가 DOM 에 삽입되지 않음 (innerHTML 우회 없음)
  expect(container.querySelector("img")).toBeNull();
});
```

#### Test 2-5: 화이트리스트 전 코드 매핑 검증 (Plan 0006 정합)
```tsx
it.each([
  ["state_mismatch", /보안 검증/],
  ["invalid_credentials", /계정 정보가 올바르지 않/],
  ["mfa_required", /2단계 인증/],
  ["upstream", /라이엇 서버/],
  ["timeout", /응답 시간이 초과/],
  ["rate_limited", /잠시 후 다시/],
  ["unknown", /일시적인 문제/],
])("givenErrorCode_%s_whenRendered_thenMessageMatches", (code, pattern) => {
  // Given
  mockUseSearchParams(`error=${code}`);
  // When
  render(<LoginPage />);
  // Then
  expect(screen.getByRole("alert")).toHaveTextContent(pattern);
});
```

### 구현 항목

**파일**: `app/(app)/login/page.tsx` (Phase 1 와 동일 파일 — 같은 그룹에서 처리)
- `useSearchParams` import (`next/navigation`).
- 페이지 내부 const `ERROR_MESSAGES: Record<string, string>` — 키는 `state_mismatch`, `invalid_credentials`, `mfa_required`, `upstream`, `timeout`, `rate_limited`, `unknown` (Plan 0006 Phase 5-3 화이트리스트와 동일).
- `const errorCode = searchParams.get("error");`
- 매핑 결과 `const message = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.unknown) : null;`
- 화이트리스트 외 코드일 때 `useEffect(() => { if (errorCode && !ERROR_MESSAGES[errorCode]) console.warn(`unknownErrorCode: ${errorCode}`); }, [errorCode]);`
- `message` 가 있으면 카드 상단에 `<div role="alert" className="...">` 로 메시지 + "다시 시도" 링크(`/api/auth/start`) 렌더.
- 사용자 입력 코드는 React 의 기본 텍스트 노드 삽입(=자동 escape)만 사용. `dangerouslySetInnerHTML` 금지.

### Phase 2 테스트 하네스

**파일**: `tests/critical-path/login-page.test.tsx` (신규, Phase 1 과 공유)
- `vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: (k: string) => new URLSearchParams(currentQuery).get(k) }) }))` 패턴으로 query 모킹 헬퍼 `mockUseSearchParams(qs: string)` 정의.
- jsdom 환경에서 `<a>` 클릭 시 navigation 부작용은 jsdom 이 자체적으로 차단하므로 별도 `Object.defineProperty(window, "location", ...)` 불필요.

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (버튼 배선)
  ├─ 1-1 test ──┐
  ├─ 1-2 test ──┤
  ├─ 1-3 test ──┤
  ├─ 1-4 test ──┼──→ 1-impl-page (app/(app)/login/page.tsx 재작성)
  ├─ 1-5 test ──┤            │
  └─ 1-6 test ──┘            │
                              ▼
                     1-impl-layout (app/(app)/login/layout.tsx 신규)
                              │
Phase 2 (에러 표면화)         │ (같은 page.tsx 편집 → 순차)
  ├─ 2-1 test ──┐             │
  ├─ 2-2 test ──┤             │
  ├─ 2-3 test ──┼─────────────┴──→ 2-impl-page (page.tsx 에 useSearchParams + 배너 주입)
  ├─ 2-4 test ──┤
  └─ 2-5 test ──┘
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1 ~ 1-6 테스트 스텁 작성 (단일 파일 `login-page.test.tsx`) | 없음 | 아니오 (단일 파일 편집) |
| G2 | 1-impl-layout (`app/(app)/login/layout.tsx` 신규) | G1 완료 (RED) | 예 (별도 파일) |
| G3 | 1-impl-page (`app/(app)/login/page.tsx` 버튼 배선) | G1 완료, G2 와 병렬 가능 | 예 (별도 파일) |
| G4 | 2-1 ~ 2-5 테스트 스텁 추가 (동일 `login-page.test.tsx`) | G3 완료 (Phase 1 green) | 아니오 (단일 파일) |
| G5 | 2-impl-page (page.tsx 에 useSearchParams + 에러 배너) | G4 완료 (RED) | 아니오 (G3 과 동일 파일) |

### 종속성 판단 기준 (이 Plan 내 적용)

- `app/(app)/login/page.tsx` 는 Phase 1·2 모두에서 편집 → 동일 파일 충돌 회피 위해 Phase 1 → Phase 2 순차.
- `layout.tsx` 신규 파일은 page 와 독립 → 병렬 가능 (G2/G3).
- 테스트 스텁(`login-page.test.tsx`) 는 단일 파일이라 그룹 내부에서는 sequential 추가.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | 버튼 href === /api/auth/start 테스트 | ✅ 완료 | |
| 1-2 | 클릭 후 disabled + loading 라벨 테스트 | ✅ 완료 | |
| 1-3 | 중복 클릭 preventDefault 테스트 | ✅ 완료 | fireEvent 반환값으로 검증 |
| 1-4 | loading 상태 동기 반영 테스트 | ✅ 완료 | NFR Performance |
| 1-5 | pageshow(bfcache) loading 리셋 테스트 | ✅ 완료 | NFR Availability |
| 1-6 | fan-made 고지 보존 테스트 | ✅ 완료 | NFR Compliance |
| 1-impl-layout | `app/(app)/login/layout.tsx` 신규 (metadata 이전) | ✅ 완료 | |
| 1-impl-page | `app/(app)/login/page.tsx` 버튼 배선 ("use client", a + onClick + useState + pageshow) | ✅ 완료 | |
| 2-1 | mfa_required → 한국어 배너 + 재시도 링크 | ✅ 완료 | |
| 2-2 | unknown 코드 fallback + console.warn | ✅ 완료 | NFR Operability/Security |
| 2-3 | error query 부재 시 배너 미렌더 | ✅ 완료 | |
| 2-4 | error query HTML 미해석 (XSS 차단) | ✅ 완료 | NFR Security |
| 2-5 | 화이트리스트 7종 코드 매핑 (it.each) | ✅ 완료 | Plan 0006 정합 |
| 2-impl-page | page.tsx 에 useSearchParams + ERROR_MESSAGES + 배너 주입 | ✅ 완료 | |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
