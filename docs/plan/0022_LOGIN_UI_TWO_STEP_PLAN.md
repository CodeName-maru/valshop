# Plan 0022: FR-R5 로그인 UI (2-step 상태머신)

## 개요

`app/(app)/login` 을 재작성하여 **credential → mfa 2-step 유한상태머신(FSM) UI** 로 전환한다. Plan 0021(FR-R4) 이 확정한 `/api/auth/login`·`/api/auth/mfa` 응답 계약(`{ok:true} | {status:"mfa_required",email_hint} | {code:AuthErrorCode}`) 을 소비하고, spec § 5 의 `AuthErrorCode` 7종 enum(invalid_credentials / mfa_invalid / mfa_expired / rate_limited / riot_unavailable / session_expired / unknown) 에 대해 한국어 inline 메시지를 매핑한다. 상단에 고정 고지 배너("VAL-Shop 은 라이엇 공식 서비스 아님 / 본인 계정 시연용 / 2FA 권장", ADR-0011) 를 둔다. 로그인 성공 시 `window.location = "/"` 로 라우팅. 기존 Plan 0015 의 placeholder·Riot 302 버튼·`/api/auth/manual` 개발 토큰 UI 는 전면 제거된다.

## 가정사항 (Cross-plan 의존성·요구사항 해석)

- **Plan 0021(FR-R4) 의 엔드포인트 계약은 본 Plan 시작 시점에 고정**되었다고 가정한다. 본 UI 가 소비하는 스키마는 spec § 7 FR-R4 인수조건과 정확히 일치한다. drift 발생 시 cross-plan 계약 위반이며 본 Plan 테스트가 RED 로 잡는다.
- `AuthErrorCode` enum 은 spec § 5 및 Plan 0019(`lib/riot/errors.ts`) 의 소유다. 본 UI 는 **문구 매핑만** 한다 — enum 값 자체를 변경/추가하지 않는다. `mfa_required` 는 에러가 아닌 상태 전이 트리거이므로 에러 메시지 테이블에 포함하지 않는다.
- 상단 고지 배너 문구는 spec § 6 및 ADR-0011 의 원문을 1차 소스로 삼는다. 자구를 임의로 변형하지 않는다 ("VAL-Shop은 라이엇 게임즈 공식 서비스가 아닙니다 · 본인 계정 시연용 · 2FA 사용을 권장합니다" 한 줄 + 보조 설명). ADR-0011 개정 시 본 Plan 구현 파일도 sync.
- **네트워크 실패**(fetch reject / offline) 는 spec § 5 enum 에는 정의되지 않았으나 NFR Availability 요구에 따라 "네트워크 에러" 배너 + 재시도 버튼을 표시한다. 서버가 반환한 `code` 와 **클라이언트 측 네트워크 에러** 는 구분되며, 후자는 UI 내부 `"network"` 의사(pseudo) 코드로만 표현하고 서버 enum 을 오염시키지 않는다.
- Plan 0015 의 `/api/auth/start` anchor·error query 파싱·`/api/auth/manual` 토큰 폼은 **전량 제거**된다 (FR-R6 가 서버 라우트 제거를 담당하나, UI 참조 제거는 본 Plan 에서 선행). `/api/auth/start` redirect 는 더 이상 존재하지 않으므로 "다시 시도" 액션은 단순히 credential step 으로 UI state reset 으로 구현한다.
- **라우팅은 `window.location = "/"`** 로 강제(성공 시) 한다. `router.push()` 가 아닌 전체 페이지 reload 를 쓰는 이유는 (a) Next.js RSC 트리가 session cookie 반영된 상태로 fresh 렌더되어야 헤더/네비가 일관되고, (b) spec § 4-3 flow 의 종료점 정의와 일치하기 때문이다.
- **FSM 구현은 `useReducer`** 로 명시한다. `useState` 분산은 상태 전이 invariant 를 컴파일러가 체크해 주지 않기 때문에 Maintainability 항목(FSM 전이표 + reducer) 을 충족하지 못한다.
- 3개 자식 컴포넌트(`credential-form.tsx`, `mfa-form.tsx`, `notice-banner.tsx`) 는 **prop-driven pure component** 로 설계한다 — dispatch/onSubmit/error/loading 은 전부 부모에서 주입. 단위 테스트는 React Testing Library + Vitest (기존 하네스) 만 사용, MSW 불필요.
- Playwright 스모크는 MSW 로 Riot 업스트림을 stub 한다. Supabase 는 test project (기존 `tests/integration/*` 패턴 재사용). 자세한 MSW stub 구조는 Plan 0020 (FR-R4 통합 테스트) 이 이미 셋업했다고 가정.
- 본 Plan 범위 외:
  - `/api/auth/*` 서버 라우트 구현 (Plan 0021)
  - `lib/riot/errors.ts` enum 정의 (Plan 0019)
  - `/api/auth/start` 등 레거시 서버 코드 삭제 (Plan 0023, FR-R6)
  - CSP / logger / rate-limit 서버 설정 (Plan 0024, FR-R7)

## 설계 결정사항

| 항목 | 결정 | 근거 (NFR) |
|------|------|------|
| 상태 관리 | `useReducer<LoginState, LoginEvent>` (FSM) — `credential` / `credentialSubmitting` / `mfa` / `mfaSubmitting` / `success` 5상태 | Maintainability (전이 invariant 명시), spec § 4-3 |
| 상태 전이표 | 아래 §"FSM 상태 전이 표" 참조 — reducer 가 이 표의 1:1 구현 | Maintainability, 테스트 가능성 |
| 네트워크 호출 | `fetch("/api/auth/login" or "/api/auth/mfa", {method:"POST", credentials:"same-origin", headers:{"Content-Type":"application/json"}, body: JSON.stringify(...)})` | Plan 0021 계약, Security (same-origin, httpOnly cookie 자동 전파) |
| 성공 라우팅 | `window.location.assign("/")` (replace 아님 — 뒤로가기 히스토리 보존) | spec § 4-3, Maintainability |
| 에러 메시지 매핑 | `AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string>` + `NETWORK_ERROR_MESSAGE` 별도 상수 | Operability (enum 공유), Availability (네트워크 별도 처리) |
| 에러 enum 소유 | `lib/riot/errors.ts` 에서 `import type { AuthErrorCode }` — 본 파일은 type 재export 금지 | spec § 5, Operability |
| 고지 배너 위치 | 페이지 최상단 고정 (sticky top-0, z-40). credential/mfa 모두에서 보임 | Compliance (ADR-0011), UX 일관성 |
| 고지 배너 컴포넌트 | `notice-banner.tsx` 분리 — 다른 auth 관련 페이지에서 재사용 가능 | Maintainability |
| 폼 컴포넌트 분리 | `credential-form.tsx`, `mfa-form.tsx` — prop-driven. 부모 page 가 상태/onSubmit 주입 | Maintainability, 단위 테스트 용이 |
| password input | `type="password"`, `autoComplete="current-password"`, `name="password"` | Security (브라우저 패스워드 매니저 친화, 키로거 대비 표준 힌트) |
| username input | `autoComplete="username"`, `name="username"`, `inputMode="text"` | Security, UX |
| MFA code input | `inputMode="numeric"`, `autoComplete="one-time-code"`, `pattern="[0-9]{6}"`, `maxLength={6}` | Security (OTP 자동완성 힌트), UX |
| 성공 직후 폼 state | success 전이 시 reducer 가 username/password/mfaCode 를 빈 문자열로 리셋 (메모리 잔존 최소화) | Security (spec § 6 "로그인 직후 폼 state 초기화") |
| 로딩 표시 | submitting 상태에서 submit 버튼 disabled + 라벨 "인증 중…" + input disabled | UX, 중복 요청 차단 |
| 에러 후 재시도 | 에러 표시 후 input 은 유지 (username 보존) — 사용자 수정 후 즉시 재제출 가능 | UX (Availability) |
| mfa_expired 처리 | mfa step 에서 수신 시 credential step 으로 **자동 전이** + "세션이 만료되어 처음부터 다시 진행해 주세요" 메시지 표시 | spec § 4-3 (auth_pending 10분 TTL) |
| session_expired 처리 | credential/mfa 어느 쪽에서든 수신 가능 — credential step 에러로 표시 | spec § 5 |
| 네트워크 에러 처리 | fetch reject → 현재 step 유지 + "네트워크 오류" inline 메시지 + "다시 시도" 버튼 | NFR Availability |
| Origin / CSRF | fetch 는 same-origin 자동 — 별도 처리 불필요. Plan 0021 서버가 Origin 헤더 검증 | Security (spec § 6) |
| Playwright 스모크 범위 | happy MFA 1 경로만 (credential → mfa → success). 단위가 나머지 케이스 커버 | Cost (E2E 비용), NFR Performance |
| 단위 테스트 스택 | Vitest + @testing-library/react + jsdom (기존 `tests/critical-path/*` 하네스) | Cost (추가 의존 0), Maintainability |
| jsdom `window.location` | 성공 라우팅 검증은 `Object.defineProperty(window, "location", { value: { assign: vi.fn() } })` stub | Maintainability |
| Tailwind 스타일 | 기존 `text-muted-foreground`, `bg-card`, `border-border`, `bg-primary` 토큰 유지 (ADR-0007) | Cost, 일관성 |

## NFR 반영

| 카테고리 | 반영 방식 | 검증 테스트 |
|---|---|---|
| Performance | (a) 단일 페이지 client component, form 2종 분리지만 최초 렌더 시 credential-form 만 마운트 (mfa-form 은 state 전이 후), (b) 외부 폰트·이미지 없음, (c) fetch 완료 전 UI 는 optimistic 전이 없음 (혼동 방지) → LCP ≤ 2.5s / TTI ≤ 3s 충족 | Test 1-1 (초기 credential-form 렌더), Test 4-1 (Playwright LCP 관찰은 범위 외 — 구조적 보장) |
| Scale | 클라이언트 무상태, 서버 상태 점유 0. 동시 N 유저 접속은 `/api/auth/login` 서버 레이트리밋에서 처리 (Plan 0021) | (구조적 — 테스트 불필요) |
| Availability | (a) fetch reject 시 "네트워크 오류" inline 메시지 + 재시도 버튼, (b) mfa_expired 시 credential step 자동 복귀, (c) Riot 5xx(riot_unavailable) 는 inline 메시지 + 재시도, (d) 성공까지 FSM 이 deterministic → 불특정 상태 금지 | Test 3-1 (network error), Test 3-2 (mfa_expired 복귀), Test 3-3 (riot_unavailable 메시지) |
| Security | (a) password `type="password"` + `autoComplete="current-password"`, (b) 성공 직후 reducer 가 password/mfaCode 빈 문자열 리셋, (c) 에러 메시지는 화이트리스트 enum 만 렌더(서버가 보낸 raw message 미노출), (d) `dangerouslySetInnerHTML` 금지, (e) fetch `credentials:"same-origin"` (httpOnly cookie 자동, 3rd-party 노출 0), (f) Plan 0015 의 `/api/auth/manual` 개발 토큰 폼 제거(민감 입력 표면 축소) | Test 2-1 (성공 후 password state 리셋), Test 2-2 (서버 raw message 미렌더), Test 2-3 (password input 속성), Test 2-4 (XSS escape) |
| Compliance | 상단 고정 배너 notice-banner.tsx — "VAL-Shop 은 라이엇 게임즈 공식 서비스 아님 / 본인 계정 시연용 / 2FA 권장" (ADR-0011, spec § 6 원문) | Test 1-7 (배너 문구 존재), Test 1-8 (sticky 레이아웃) |
| Operability | `AuthErrorCode` enum 을 `lib/riot/errors.ts` 에서 import — 서버/클라이언트 단일 소스. drift 시 typecheck 로 감지. 메시지 매핑 테이블은 7종 enum 을 완전 커버 (`Record<AuthErrorCode, string>` 으로 타입 강제) | Test 2-5 (enum 7종 매핑 — it.each) |
| Cost | 신규 런타임 의존 0 (React + Tailwind 기존). Playwright/Vitest 기존 설치 | (의존 추가 금지로 달성) |
| Maintainability | (a) FSM 전이표 — spec 과 reducer 1:1, (b) 폼 컴포넌트 3종 prop-driven (단위 테스트 주입만으로 모든 분기 커버), (c) 에러 매핑 단일 파일 집중, (d) Playwright 스모크 1개 + 단위 13개 = critical path 전 커버 | Phase 1~4 전체 |

---

## FSM 상태 전이 표

### 상태 정의

| 상태 | 설명 | 렌더 | 허용 이벤트 |
|------|------|------|-------------|
| `credential` | 초기 상태 / 자격증명 입력 대기 | `<CredentialForm />` + (optional error banner) | `SUBMIT_CREDENTIAL` |
| `credentialSubmitting` | POST `/api/auth/login` 진행 중 | `<CredentialForm disabled />` | `CREDENTIAL_OK`, `CREDENTIAL_MFA`, `CREDENTIAL_ERROR`, `NETWORK_ERROR` |
| `mfa` | MFA 코드 입력 대기 (email_hint 보유) | `<MfaForm emailHint={...} />` + (optional error banner) | `SUBMIT_MFA`, `BACK_TO_CREDENTIAL` |
| `mfaSubmitting` | POST `/api/auth/mfa` 진행 중 | `<MfaForm disabled />` | `MFA_OK`, `MFA_ERROR`, `MFA_EXPIRED`, `NETWORK_ERROR` |
| `success` | 로그인 성공 — `window.location="/"` 트리거 후 terminal | `<LoadingScreen />` 또는 null | (terminal) |

### 전이 표

| 현재 상태 | 이벤트 | 다음 상태 | 부작용 |
|-----------|--------|-----------|--------|
| `credential` | `SUBMIT_CREDENTIAL{username,password}` | `credentialSubmitting` | fetch POST `/api/auth/login` |
| `credentialSubmitting` | `CREDENTIAL_OK` | `success` | `window.location.assign("/")`, password 리셋 |
| `credentialSubmitting` | `CREDENTIAL_MFA{emailHint}` | `mfa` | password 리셋 (메모리 잔존 최소화), emailHint 보관 |
| `credentialSubmitting` | `CREDENTIAL_ERROR{code}` | `credential` | 에러 메시지 표시, password 유지(사용자 수정 편의), username 유지 |
| `credentialSubmitting` | `NETWORK_ERROR` | `credential` | "네트워크 오류" 메시지 표시 |
| `mfa` | `SUBMIT_MFA{code}` | `mfaSubmitting` | fetch POST `/api/auth/mfa` |
| `mfa` | `BACK_TO_CREDENTIAL` | `credential` | emailHint 제거, mfaCode 리셋 |
| `mfaSubmitting` | `MFA_OK` | `success` | `window.location.assign("/")`, mfaCode/password 리셋 |
| `mfaSubmitting` | `MFA_ERROR{code: mfa_invalid}` | `mfa` | 에러 메시지 표시, mfaCode 리셋(재입력 유도) |
| `mfaSubmitting` | `MFA_ERROR{code: rate_limited\|riot_unavailable\|session_expired\|unknown}` | `mfa` | 에러 메시지 표시 (mfaCode 유지 — 재시도) |
| `mfaSubmitting` | `MFA_EXPIRED` | `credential` | "세션 만료, 처음부터 다시" 메시지, 모든 필드 리셋 |
| `mfaSubmitting` | `NETWORK_ERROR` | `mfa` | "네트워크 오류" 메시지 |

### 응답 → 이벤트 매핑

| 서버 응답 | 발생 이벤트 |
|-----------|-------------|
| 200 `{ok:true}` (login) | `CREDENTIAL_OK` |
| 200 `{status:"mfa_required", email_hint}` | `CREDENTIAL_MFA{emailHint}` |
| 4xx `{code}` (login) | `CREDENTIAL_ERROR{code}` |
| 200 `{ok:true}` (mfa) | `MFA_OK` |
| 4xx `{code:"mfa_expired"}` | `MFA_EXPIRED` |
| 4xx `{code}` (mfa, 그 외) | `MFA_ERROR{code}` |
| fetch reject / TypeError | `NETWORK_ERROR` |

---

## Phase 1: 기본 레이아웃 + credential step (FSM 초기 + 고지 배너)

### 테스트 시나리오

#### Test 1-1: 초기 렌더 — credential-form 마운트
```tsx
// tests/critical-path/login-page.test.tsx
import { render, screen } from "@testing-library/react";
import LoginPage from "@/app/(app)/login/page";

describe("Feature: Login 2-step FSM", () => {
  describe("Scenario: 초기 credential step", () => {
    it("givenFreshMount_whenRendered_thenCredentialFormVisible", () => {
      // Given: fresh mount
      // When
      render(<LoginPage />);
      // Then: username/password input 이 존재, mfa input 은 부재
      expect(screen.getByLabelText(/라이엇 ID|아이디|username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/비밀번호|password/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/인증 코드|mfa/i)).toBeNull();
    });
  });
});
```

#### Test 1-2: credential-form prop-driven 렌더
```tsx
// tests/unit/credential-form.test.tsx
import CredentialForm from "@/app/(app)/login/credential-form";

it("givenLoadingTrue_whenRendered_thenInputsAndButtonDisabled", () => {
  // Given
  const onSubmit = vi.fn();
  // When
  render(<CredentialForm loading={true} error={null} onSubmit={onSubmit} />);
  // Then
  expect(screen.getByLabelText(/아이디/i)).toBeDisabled();
  expect(screen.getByLabelText(/비밀번호/i)).toBeDisabled();
  expect(screen.getByRole("button", { name: /인증 중/ })).toBeDisabled();
});
```

#### Test 1-3: credential-form 에러 prop 렌더
```tsx
it("givenErrorProp_whenRendered_thenAlertBannerShown", () => {
  // Given
  render(<CredentialForm loading={false} error="계정 정보가 올바르지 않습니다." onSubmit={vi.fn()} />);
  // Then
  expect(screen.getByRole("alert")).toHaveTextContent(/계정 정보가 올바르지 않/);
});
```

#### Test 1-4: credential-form submit
```tsx
it("givenFilledForm_whenSubmitted_thenOnSubmitCalledWithCredentials", async () => {
  // Given
  const onSubmit = vi.fn();
  render(<CredentialForm loading={false} error={null} onSubmit={onSubmit} />);
  // When
  await userEvent.type(screen.getByLabelText(/아이디/i), "player#KR1");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "pw1234");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  // Then
  expect(onSubmit).toHaveBeenCalledWith({ username: "player#KR1", password: "pw1234" });
});
```

#### Test 1-5: password input 속성 (Security)
```tsx
it("givenCredentialForm_whenRendered_thenPasswordInputHasSecurityAttributes", () => {
  // Given/When
  render(<CredentialForm loading={false} error={null} onSubmit={vi.fn()} />);
  const pw = screen.getByLabelText(/비밀번호/i);
  // Then
  expect(pw).toHaveAttribute("type", "password");
  expect(pw).toHaveAttribute("autoComplete", "current-password");
  expect(pw).toHaveAttribute("name", "password");
});
```

#### Test 1-6: username input 속성
```tsx
it("givenCredentialForm_whenRendered_thenUsernameInputHasAutocomplete", () => {
  render(<CredentialForm loading={false} error={null} onSubmit={vi.fn()} />);
  const u = screen.getByLabelText(/아이디/i);
  expect(u).toHaveAttribute("autoComplete", "username");
  expect(u).toHaveAttribute("name", "username");
});
```

#### Test 1-7: 고지 배너 문구 (Compliance)
```tsx
// tests/unit/notice-banner.test.tsx
import NoticeBanner from "@/app/(app)/login/notice-banner";

it("givenNoticeBanner_whenRendered_thenContainsAllRequiredPhrases", () => {
  // Given/When
  render(<NoticeBanner />);
  // Then: ADR-0011 키워드 3종
  expect(screen.getByText(/공식.*아닙니다|공식 서비스 아님/)).toBeInTheDocument();
  expect(screen.getByText(/본인 계정 시연/)).toBeInTheDocument();
  expect(screen.getByText(/2FA.*권장/i)).toBeInTheDocument();
});
```

#### Test 1-8: 배너 sticky 위치
```tsx
it("givenLoginPage_whenRendered_thenNoticeBannerIsStickyTop", () => {
  // Given/When
  const { container } = render(<LoginPage />);
  const banner = container.querySelector('[data-testid="notice-banner"]');
  // Then: Tailwind sticky top-0 className 보유
  expect(banner?.className).toMatch(/sticky/);
  expect(banner?.className).toMatch(/top-0/);
});
```

### 구현 항목

**파일**: `app/(app)/login/notice-banner.tsx` (신규)
- `"use client"` 불필요 (정적).
- `<aside data-testid="notice-banner" className="sticky top-0 z-40 border-b border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground backdrop-blur">` 내부에 ADR-0011 원문 3요소를 한 줄·보조 설명으로 배치.
- 문구(spec § 6 / ADR-0011):
  - 메인: "VAL-Shop 은 라이엇 게임즈 공식 서비스가 아닙니다."
  - 보조: "본인 계정 시연용 · 2FA 사용을 권장합니다."

**파일**: `app/(app)/login/credential-form.tsx` (신규)
- `"use client"`.
- Props: `{ loading: boolean; error: string | null; onSubmit: (v: {username: string; password: string}) => void }`.
- 내부 `useState<string>` 로 username/password 유지.
- `<form onSubmit>` — `e.preventDefault()` 후 `onSubmit({username, password})`.
- `<label htmlFor="login-username">라이엇 아이디</label><input id="login-username" name="username" autoComplete="username" ... />`.
- `<label htmlFor="login-password">비밀번호</label><input id="login-password" name="password" type="password" autoComplete="current-password" ... />`.
- error prop 존재 시 `<div role="alert">` 렌더.
- loading 시 input/button disabled, button 라벨 "인증 중…" else "로그인".

**파일**: `app/(app)/login/page.tsx` (재작성 — Phase 1 구현분)
- `"use client"`.
- `useReducer` 로 FSM 도입. Phase 1 에서는 `credential` / `credentialSubmitting` 2상태 + `SUBMIT_CREDENTIAL` 이벤트만 우선 구현 (네트워크 호출은 Phase 2/3 에서). 단, reducer 는 Phase 3 까지 확장되는 완전한 형태로 타입 정의.
- 초기 상태 `{status:"credential", error:null}`.
- `<NoticeBanner />` + `<CredentialForm loading={...} error={...} onSubmit={dispatch SUBMIT_CREDENTIAL + fetch} />`.
- 이 Phase 에서는 fetch 후 응답 파싱은 stub 으로 두되, 다음 Phase 에서 교체.
- 기존 `/api/auth/start` anchor, `/api/auth/manual` 개발 폼, error query 파싱 로직 **전량 삭제**.

---

## Phase 2: credential → mfa 전이 + 에러 enum 매핑

### 테스트 시나리오

#### Test 2-1: `{ok:true}` 응답 → window.location.assign("/")
```tsx
it("givenCredentialOk_whenServerReturnsOk_thenNavigatesToRoot", async () => {
  // Given: MSW stub — POST /api/auth/login → 200 {ok:true}
  server.use(
    http.post("/api/auth/login", () => HttpResponse.json({ ok: true })),
  );
  const assign = vi.fn();
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
  // When
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/아이디/i), "u");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "p");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  // Then
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
});
```

#### Test 2-2: `{status:"mfa_required", email_hint}` → mfa step 전환
```tsx
it("givenMfaRequired_whenResponseReceived_thenMfaFormWithEmailHint", async () => {
  // Given
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json({ status: "mfa_required", email_hint: "j***@gmail.com" })
    ),
  );
  // When
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/아이디/i), "u");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "p");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  // Then: mfa form 렌더 + email_hint 표시
  await waitFor(() => {
    expect(screen.getByLabelText(/인증 코드/i)).toBeInTheDocument();
    expect(screen.getByText(/j\*\*\*@gmail.com/)).toBeInTheDocument();
  });
  // password input 은 사라짐
  expect(screen.queryByLabelText(/비밀번호/i)).toBeNull();
});
```

#### Test 2-3: 성공 후 password state 리셋 (Security)
```tsx
it("givenSuccessfulLogin_whenMfaRequired_thenPasswordStateCleared", async () => {
  // Given: mfa_required 응답
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json({ status: "mfa_required", email_hint: "a@b" })
    ),
  );
  // When: 로그인 제출
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/아이디/i), "u");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "secret");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  // Then: 이후 뒤로가기로 credential step 복귀 시 password 가 비어있음
  // (BACK_TO_CREDENTIAL 이벤트 발생 시나리오)
  await screen.findByLabelText(/인증 코드/i);
  await userEvent.click(screen.getByRole("button", { name: /처음으로|다시/ }));
  const pw = screen.getByLabelText(/비밀번호/i) as HTMLInputElement;
  expect(pw.value).toBe("");
});
```

#### Test 2-4: 에러 enum 7종 매핑 (Operability)
```tsx
// tests/unit/auth-error-messages.test.ts
import { AUTH_ERROR_MESSAGES } from "@/app/(app)/login/error-messages";

it.each([
  ["invalid_credentials", /계정 정보/],
  ["mfa_invalid", /인증 코드가 올바르지 않/],
  ["mfa_expired", /세션.*만료|처음부터/],
  ["rate_limited", /요청이 너무 많|잠시 후/],
  ["riot_unavailable", /라이엇.*서버|일시적/],
  ["session_expired", /세션.*만료|다시 로그인/],
  ["unknown", /알 수 없는|다시 시도/],
])("givenAuthErrorCode_%s_whenLookedUp_thenKoreanMessageReturned", (code, pattern) => {
  expect(AUTH_ERROR_MESSAGES[code as keyof typeof AUTH_ERROR_MESSAGES]).toMatch(pattern);
});
```

#### Test 2-5: invalid_credentials 응답 → 에러 배너 + credential step 유지
```tsx
it("givenInvalidCredentials_whenResponseReceived_thenStaysOnCredentialWithError", async () => {
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json({ code: "invalid_credentials" }, { status: 401 })
    ),
  );
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/아이디/i), "u");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "bad");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/계정 정보/)
  );
  expect(screen.getByLabelText(/비밀번호/i)).toBeInTheDocument();
});
```

#### Test 2-6: 서버 raw message 미렌더 (Security)
```tsx
it("givenServerReturnsRawMessage_whenErrorDisplayed_thenOnlyEnumMappedKoreanShown", async () => {
  // Given: 서버가 유출 실수로 raw message 추가
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json({ code: "invalid_credentials", message: "<script>alert(1)</script>" }, { status: 401 })
    ),
  );
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/아이디/i), "u");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "p");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  // Then: raw message 절대 DOM 에 없음
  await screen.findByRole("alert");
  const { container } = render(<LoginPage />);
  expect(container.innerHTML).not.toContain("<script>");
  expect(container.innerHTML).not.toContain("alert(1)");
});
```

### 구현 항목

**파일**: `app/(app)/login/error-messages.ts` (신규)
- `import type { AuthErrorCode } from "@/lib/riot/errors";`
- `export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = { invalid_credentials: "계정 정보가 올바르지 않습니다. 다시 확인해 주세요.", mfa_invalid: "인증 코드가 올바르지 않습니다.", mfa_expired: "세션이 만료되어 처음부터 다시 진행해 주세요.", rate_limited: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", riot_unavailable: "라이엇 서버에 일시적인 문제가 발생했습니다.", session_expired: "세션이 만료되었습니다. 다시 로그인해 주세요.", unknown: "알 수 없는 오류가 발생했습니다. 다시 시도해 주세요." };`
- `export const NETWORK_ERROR_MESSAGE = "네트워크 오류가 발생했습니다. 연결 상태를 확인하고 다시 시도해 주세요.";`
- `mfa_required` 는 엔트리 없음(상태 전이이므로).

**파일**: `app/(app)/login/mfa-form.tsx` (신규)
- `"use client"`.
- Props: `{ emailHint: string; loading: boolean; error: string | null; onSubmit: (code: string) => void; onBack: () => void }`.
- `<p>인증 코드가 <strong>{emailHint}</strong> 으로 전송되었습니다.</p>`.
- input: `name="code"`, `inputMode="numeric"`, `autoComplete="one-time-code"`, `pattern="[0-9]{6}"`, `maxLength={6}`, `type="text"`.
- 두 버튼: "인증" (submit), "처음으로" (onBack, type="button").
- error prop 존재 시 `<div role="alert">` 렌더.

**파일**: `app/(app)/login/page.tsx` (Phase 2 확장)
- reducer 에 `CREDENTIAL_OK` / `CREDENTIAL_MFA` / `CREDENTIAL_ERROR` / `BACK_TO_CREDENTIAL` 이벤트 처리 추가.
- `handleCredentialSubmit({username,password})`:
  - `dispatch({type:"SUBMIT_CREDENTIAL"})`
  - `const res = await fetch("/api/auth/login", { method:"POST", credentials:"same-origin", headers, body: JSON.stringify({username,password}) })`
  - `const data = await res.json()`
  - if `data.ok` → dispatch `CREDENTIAL_OK` → `window.location.assign("/")`
  - else if `data.status === "mfa_required"` → dispatch `CREDENTIAL_MFA{emailHint: data.email_hint}`
  - else if `data.code` → dispatch `CREDENTIAL_ERROR{code: data.code}`
  - catch → dispatch `NETWORK_ERROR`
- state.status === "mfa" or "mfaSubmitting" 일 때 `<MfaForm emailHint={state.emailHint} onBack={() => dispatch("BACK_TO_CREDENTIAL")} ... />` 렌더.
- `state.error` 는 `AUTH_ERROR_MESSAGES[code]` (또는 network pseudo) 를 통해 한국어 문자열로 변환하여 form 에 주입.

---

## Phase 3: mfa step 완성 + 네트워크 에러 + mfa_expired 자동 복귀

### 테스트 시나리오

#### Test 3-1: MFA happy path
```tsx
it("givenMfaStep_whenCodeSubmittedAndOk_thenNavigatesToRoot", async () => {
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json({ status: "mfa_required", email_hint: "a@b" })
    ),
    http.post("/api/auth/mfa", () => HttpResponse.json({ ok: true })),
  );
  const assign = vi.fn();
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/아이디/i), "u");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "p");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  await userEvent.type(await screen.findByLabelText(/인증 코드/i), "123456");
  await userEvent.click(screen.getByRole("button", { name: /^인증$/ }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
});
```

#### Test 3-2: mfa_expired → credential step 자동 복귀 + 메시지
```tsx
it("givenMfaExpired_whenReceivedInMfaStep_thenReturnsToCredentialWithMessage", async () => {
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json({ status: "mfa_required", email_hint: "a@b" })
    ),
    http.post("/api/auth/mfa", () =>
      HttpResponse.json({ code: "mfa_expired" }, { status: 401 })
    ),
  );
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/아이디/i), "u");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "p");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  await userEvent.type(await screen.findByLabelText(/인증 코드/i), "000000");
  await userEvent.click(screen.getByRole("button", { name: /^인증$/ }));
  // Then: credential step 으로 복귀 + 메시지
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/세션.*만료|처음부터/)
  );
  expect(screen.getByLabelText(/비밀번호/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/인증 코드/i)).toBeNull();
});
```

#### Test 3-3: mfa_invalid → mfa step 유지 + 코드 입력 리셋
```tsx
it("givenMfaInvalid_whenReceived_thenStaysOnMfaAndCodeCleared", async () => {
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json({ status: "mfa_required", email_hint: "a@b" })
    ),
    http.post("/api/auth/mfa", () =>
      HttpResponse.json({ code: "mfa_invalid" }, { status: 401 })
    ),
  );
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/아이디/i), "u");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "p");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  const codeInput = await screen.findByLabelText(/인증 코드/i) as HTMLInputElement;
  await userEvent.type(codeInput, "000000");
  await userEvent.click(screen.getByRole("button", { name: /^인증$/ }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/인증 코드가 올바르지 않/)
  );
  expect(codeInput.value).toBe("");
});
```

#### Test 3-4: 네트워크 에러 (Availability)
```tsx
it("givenFetchRejects_whenSubmittingCredential_thenNetworkErrorShownAndRetryable", async () => {
  server.use(
    http.post("/api/auth/login", () => HttpResponse.error()),
  );
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/아이디/i), "u");
  await userEvent.type(screen.getByLabelText(/비밀번호/i), "p");
  await userEvent.click(screen.getByRole("button", { name: /로그인/ }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/네트워크/)
  );
  // 다시 시도 가능 (credential step 유지)
  expect(screen.getByRole("button", { name: /로그인/ })).not.toBeDisabled();
});
```

#### Test 3-5: mfa-form prop-driven 렌더
```tsx
it("givenMfaForm_withEmailHint_whenRendered_thenHintDisplayed", () => {
  render(<MfaForm emailHint="a***@b.com" loading={false} error={null} onSubmit={vi.fn()} onBack={vi.fn()} />);
  expect(screen.getByText(/a\*\*\*@b.com/)).toBeInTheDocument();
});
```

#### Test 3-6: mfa input 속성 (Security/UX)
```tsx
it("givenMfaForm_whenRendered_thenCodeInputHasOtpAttributes", () => {
  render(<MfaForm emailHint="x" loading={false} error={null} onSubmit={vi.fn()} onBack={vi.fn()} />);
  const input = screen.getByLabelText(/인증 코드/i);
  expect(input).toHaveAttribute("inputMode", "numeric");
  expect(input).toHaveAttribute("autoComplete", "one-time-code");
  expect(input).toHaveAttribute("maxLength", "6");
});
```

### 구현 항목

**파일**: `app/(app)/login/page.tsx` (Phase 3 확장)
- reducer 에 `SUBMIT_MFA` / `MFA_OK` / `MFA_ERROR` / `MFA_EXPIRED` / `NETWORK_ERROR` 이벤트 처리 추가.
- `handleMfaSubmit(code)`:
  - `dispatch({type:"SUBMIT_MFA"})`
  - `fetch("/api/auth/mfa", {method:"POST", credentials:"same-origin", headers, body: JSON.stringify({code})})`
  - if `data.ok` → dispatch `MFA_OK` → `window.location.assign("/")`
  - else if `data.code === "mfa_expired"` → dispatch `MFA_EXPIRED`
  - else if `data.code` → dispatch `MFA_ERROR{code: data.code}`
  - catch → dispatch `NETWORK_ERROR`
- `handleBack()`: `dispatch({type:"BACK_TO_CREDENTIAL"})`.
- reducer `MFA_ERROR` 분기: code==="mfa_invalid" 면 mfaCode 리셋, 그 외는 유지.
- `MFA_EXPIRED` 분기: 상태 `credential` + error = `AUTH_ERROR_MESSAGES.mfa_expired`, emailHint 제거, 모든 폼 필드 리셋.
- `NETWORK_ERROR` 분기: 현재 step (credential 또는 mfa) 으로 복귀 + error = `NETWORK_ERROR_MESSAGE`.

---

## Phase 4: Playwright E2E 스모크 + 단위 결합

### 테스트 시나리오

#### Test 4-1: Playwright E2E (credential → mfa → dashboard)
```ts
// tests/e2e/login-two-step.spec.ts
import { test, expect } from "@playwright/test";

test("Feature: 2-step login with MFA → dashboard", async ({ page }) => {
  // Given: MSW worker 가 Riot 업스트림을 stub (tests/msw/riot-handlers.ts — Plan 0020 산출물 재사용)
  //   /api/auth/login → {status:"mfa_required", email_hint:"u***@gmail.com"}
  //   /api/auth/mfa → {ok:true}
  await page.goto("/login");
  // Scenario: credential step
  await expect(page.getByTestId("notice-banner")).toContainText("공식 서비스가 아닙니다");
  await page.getByLabel(/아이디/).fill("player#KR1");
  await page.getByLabel(/비밀번호/).fill("pw1234");
  await page.getByRole("button", { name: /로그인/ }).click();
  // Scenario: mfa step
  await expect(page.getByLabel(/인증 코드/)).toBeVisible();
  await expect(page.getByText(/u\*\*\*@gmail.com/)).toBeVisible();
  await page.getByLabel(/인증 코드/).fill("123456");
  await page.getByRole("button", { name: /^인증$/ }).click();
  // Then: 루트(/) 로 라우팅 — 대시보드 엘리먼트 노출
  await page.waitForURL("/");
  await expect(page.getByTestId("dashboard-root")).toBeVisible();
});
```

#### Test 4-2: FSM 전이 테이블 단위 검증 (reducer)
```tsx
// tests/unit/login-reducer.test.ts
import { loginReducer, initialLoginState } from "@/app/(app)/login/page";

describe("Feature: Login FSM reducer", () => {
  it.each([
    [{status:"credential"}, {type:"SUBMIT_CREDENTIAL"}, "credentialSubmitting"],
    [{status:"credentialSubmitting"}, {type:"CREDENTIAL_OK"}, "success"],
    [{status:"credentialSubmitting"}, {type:"CREDENTIAL_MFA", emailHint:"x"}, "mfa"],
    [{status:"credentialSubmitting"}, {type:"CREDENTIAL_ERROR", code:"invalid_credentials"}, "credential"],
    [{status:"credentialSubmitting"}, {type:"NETWORK_ERROR"}, "credential"],
    [{status:"mfa", emailHint:"x"}, {type:"SUBMIT_MFA"}, "mfaSubmitting"],
    [{status:"mfa", emailHint:"x"}, {type:"BACK_TO_CREDENTIAL"}, "credential"],
    [{status:"mfaSubmitting"}, {type:"MFA_OK"}, "success"],
    [{status:"mfaSubmitting"}, {type:"MFA_ERROR", code:"mfa_invalid"}, "mfa"],
    [{status:"mfaSubmitting"}, {type:"MFA_EXPIRED"}, "credential"],
  ])("givenState_%s_whenEvent_%s_thenNextState", (from, event, expected) => {
    const next = loginReducer({...initialLoginState, ...from} as any, event as any);
    expect(next.status).toBe(expected);
  });
});
```

### 구현 항목

**파일**: `tests/e2e/login-two-step.spec.ts` (신규)
- 위 Test 4-1 구현. Playwright config 는 기존 것 재사용.
- MSW 핸들러는 Plan 0020 의 `tests/msw/riot-handlers.ts` (가정) 를 참조 — 본 Plan 내부에서는 `/api/auth/login`, `/api/auth/mfa` 만 오버라이드.
- 루트(/) 응답은 dashboard 를 보여주는 기존 라우트 (dashboard 엘리먼트가 `data-testid="dashboard-root"` 을 노출한다고 가정; 없으면 대체 selector).

**파일**: `app/(app)/login/page.tsx` (최종)
- `loginReducer`, `initialLoginState`, `LoginState`, `LoginEvent` 를 export — 단위 테스트에서 직접 import.
- page default export 는 `<Suspense fallback={null}>` 감싸기 유지 (Plan 0015 패턴 계승).
- 최종 구조:
  ```
  export default function LoginPage() {
    return <Suspense fallback={null}><LoginPageInner /></Suspense>;
  }
  function LoginPageInner() {
    const [state, dispatch] = useReducer(loginReducer, initialLoginState);
    // handleCredentialSubmit / handleMfaSubmit / handleBack
    return (
      <div className="flex min-h-screen flex-col">
        <NoticeBanner />
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-md space-y-8">
            <h1>VAL-Shop</h1>
            {state.status === "credential" || state.status === "credentialSubmitting"
              ? <CredentialForm ... />
              : state.status === "mfa" || state.status === "mfaSubmitting"
                ? <MfaForm ... />
                : null /* success — navigate 중 */}
          </div>
        </main>
      </div>
    );
  }
  ```

---

## 작업 종속성

### 종속성 그래프

```
G1 (독립, 병렬)
 ├─ 1-2~1-6 테스트 (credential-form.test.tsx)
 ├─ 1-7~1-8 테스트 (notice-banner.test.tsx)
 └─ 2-4 테스트 (auth-error-messages.test.ts)
          │
          ▼
G2 (단위 impl, 병렬)
 ├─ credential-form.tsx
 ├─ notice-banner.tsx
 └─ error-messages.ts
          │
          ▼
G3 (page 쉘 + FSM 초기 — 순차)
 ├─ 1-1 테스트 (login-page.test.tsx: 초기 렌더)
 └─ page.tsx Phase 1 구현 (reducer 골격 + credential step)
          │
          ▼
G4 (credential 전이 + mfa-form, 병렬 가능)
 ├─ 2-1~2-3, 2-5~2-6 테스트 (login-page.test.tsx 확장)
 ├─ 3-5~3-6 테스트 (mfa-form.test.tsx)
 ├─ mfa-form.tsx 구현
 └─ page.tsx Phase 2 구현 (credential fetch + mfa 전이)
          │
          ▼
G5 (mfa step + 에러 분기)
 ├─ 3-1~3-4 테스트 (login-page.test.tsx 확장)
 └─ page.tsx Phase 3 구현 (mfa fetch + expired/network)
          │
          ▼
G6 (E2E + FSM 단위)
 ├─ 4-2 테스트 (login-reducer.test.ts)
 └─ 4-1 E2E (login-two-step.spec.ts)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-2~1-6, 1-7~1-8, 2-4 테스트 스텁 (3개 파일) | Plan 0021·0019 계약 고정 | ✅ (서로 다른 테스트 파일) |
| G2 | credential-form.tsx, notice-banner.tsx, error-messages.ts | G1 RED | ✅ (서로 다른 소스 파일) |
| G3 | 1-1 테스트 + page.tsx Phase 1 구현 (reducer 골격) | G2 완료 | ❌ 단일 페이지 파일 |
| G4 | 2-1~2-3, 2-5~2-6, 3-5~3-6 테스트 + mfa-form.tsx + page.tsx Phase 2 | G3 완료 | 부분 (mfa-form 구현은 page 와 병렬, 테스트 스텁 먼저) |
| G5 | 3-1~3-4 테스트 + page.tsx Phase 3 구현 | G4 완료 | ❌ 단일 페이지 파일 |
| G6 | 4-1 E2E + 4-2 reducer 단위 | G5 완료 (Phase 3 green) | ✅ (E2E 와 단위는 독립) |

### 종속성 판단 기준 (이 Plan 내 적용)

- `app/(app)/login/page.tsx` 는 Phase 1~3 모두에서 편집 → Phase 단위로 **순차**.
- `credential-form.tsx`, `mfa-form.tsx`, `notice-banner.tsx`, `error-messages.ts` 는 서로 독립 파일 → **병렬**.
- 테스트 파일은 `login-page.test.tsx` (Phase 1~3 공유) 와 각 컴포넌트별 단위 파일(`credential-form.test.tsx` 등) 로 **분리** — 공유 파일은 순차, 컴포넌트별은 병렬.
- Playwright spec (`login-two-step.spec.ts`) 는 Phase 3 green 후에만 의미 있음.
- `loginReducer` export 는 최종 파일 구조에서 단위 테스트(4-2) 를 위해 필수.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | LoginPage 초기 credential-form 마운트 | ⬜ 미착수 | |
| 1-2 | credential-form loading prop 렌더 | ⬜ 미착수 | |
| 1-3 | credential-form error prop 렌더 | ⬜ 미착수 | |
| 1-4 | credential-form submit 콜백 | ⬜ 미착수 | |
| 1-5 | password input Security 속성 | ⬜ 미착수 | NFR Security |
| 1-6 | username input autoComplete | ⬜ 미착수 | |
| 1-7 | notice-banner 문구 (ADR-0011) | ⬜ 미착수 | NFR Compliance |
| 1-8 | notice-banner sticky 레이아웃 | ⬜ 미착수 | |
| 1-impl-notice | `app/(app)/login/notice-banner.tsx` 신규 | ⬜ 미착수 | |
| 1-impl-credential | `app/(app)/login/credential-form.tsx` 신규 | ⬜ 미착수 | |
| 1-impl-page | `app/(app)/login/page.tsx` Phase 1 재작성 (reducer 골격 + credential step) | ⬜ 미착수 | 기존 코드 전량 치환 |
| 2-1 | `{ok:true}` → window.location.assign("/") | ⬜ 미착수 | |
| 2-2 | `mfa_required` → mfa step + email_hint | ⬜ 미착수 | |
| 2-3 | 성공/mfa 전이 후 password state 리셋 | ⬜ 미착수 | NFR Security |
| 2-4 | AuthErrorCode 7종 매핑 (it.each) | ⬜ 미착수 | NFR Operability |
| 2-5 | invalid_credentials → 에러 + credential 유지 | ⬜ 미착수 | |
| 2-6 | 서버 raw message 미렌더 | ⬜ 미착수 | NFR Security |
| 2-impl-errmap | `app/(app)/login/error-messages.ts` 신규 | ⬜ 미착수 | |
| 2-impl-mfa-form | `app/(app)/login/mfa-form.tsx` 신규 | ⬜ 미착수 | |
| 2-impl-page | page.tsx Phase 2 — credential fetch + mfa 전이 + 에러 매핑 | ⬜ 미착수 | |
| 3-1 | MFA happy path (credential → mfa → success) | ⬜ 미착수 | |
| 3-2 | mfa_expired → credential 자동 복귀 + 메시지 | ⬜ 미착수 | FSM 전이 invariant |
| 3-3 | mfa_invalid → mfa 유지 + code 리셋 | ⬜ 미착수 | |
| 3-4 | 네트워크 에러 → inline 메시지 + 재시도 가능 | ⬜ 미착수 | NFR Availability |
| 3-5 | mfa-form email_hint prop 렌더 | ⬜ 미착수 | |
| 3-6 | mfa input OTP 속성 (inputMode/autoComplete/maxLength) | ⬜ 미착수 | NFR Security/UX |
| 3-impl-page | page.tsx Phase 3 — mfa fetch + expired/network 분기 완성 | ⬜ 미착수 | |
| 4-1 | Playwright E2E: 2-step with MFA → dashboard | ⬜ 미착수 | 스모크 1 |
| 4-2 | loginReducer 전이표 단위 테스트 (10 케이스) | ⬜ 미착수 | NFR Maintainability |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
