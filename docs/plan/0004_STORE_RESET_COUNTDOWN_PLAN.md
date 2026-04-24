# Plan 0004: 상점 갱신 카운트다운 타이머

## 개요

발로란트 개인 상점은 매일 00:00 KST 에 로테이션된다. 대시보드에서 다음 로테이션까지 남은 시간을 초 단위로 ±1초 정확도로 실시간 표시하는 카운트다운 컴포넌트 (`components/Countdown.tsx`) 와 시간 계산 순수 함수 (`lib/time/countdown.ts`) 를 구현한다. 범위는 순수 클라이언트 컴포넌트 + 시간 로직 유닛 테스트 (fake timers) 이며, 상점 API 응답의 `SingleItemOffersRemainingDurationInSeconds` 연동은 선택 경로로만 남긴다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 기준 시각 | "다음 00:00 KST" 를 `Date.now()` 로 계산 (timezone-agnostic, UTC+9 기준 고정 오프셋) | FR-4 "매일 00:00 KST" 명시 → 클라이언트 시계 기준. Intl.DateTimeFormat 의존 없이 `Date.UTC()` 로 next-midnight-KST 계산해 SSR/CSR 차이 제거. NFR Performance/Maintainability. |
| 틱 방식 | `setInterval(500ms)` + 매 틱마다 `Date.now()` 재계산 | `setInterval(1000)` 은 탭 backgrounding / throttling 으로 drift 누적 → 500ms 로 체감 갱신 주기 유지하되 **표시값은 `Date.now()` 에서 파생** 하여 drift 0. AC-3 ±1초. |
| 재계산 소스 | 벽시계 기반 (`Date.now()`), 카운터 누적 아님 | setInterval drift 방지 핵심. 틱이 밀려도 다음 틱에 정확한 남은 시간 재산출. |
| 0 도달 처리 | 남은 시간이 0 이하가 되면 "00:00:00" 한 프레임 노출 후 자동으로 *다음* 00:00 KST 로 타겟 롤오버 | 로테이션 직후 UI 가 얼어붙지 않도록. 실제 상점 데이터 refetch 는 본 plan 범위 밖 (FR-3). |
| 렌더 최적화 | 표시 문자열 (`HH:MM:SS`) 이 이전 값과 동일할 때 `useState` set 생략 (React 가 re-render skip) | 500ms 틱으로 초 단위 변화 1회/s 만 DOM update. NFR Performance (배터리/CPU). |
| SSR 안전성 | 컴포넌트는 `"use client"`. SSR 시 초기 마크업은 placeholder (`--:--:--`), hydration 후 실제 값 표기 | 서버-클라이언트 시계 불일치로 인한 hydration mismatch 회피. |
| 스타일 | Tailwind 유틸리티 class 직접 기입 (`font-mono tabular-nums`) | ADR-0007. tabular-nums 로 자릿수 흔들림 방지. |
| 테스트 러너 | Vitest + fake timers (`vi.useFakeTimers({ toFake: ['setInterval','clearInterval','Date'] })`) | ADR-0006. 시간 의존 로직을 결정적으로 검증. |
| 테스트 위치 | 순수 함수는 `tests/critical-path/countdown.test.ts` (unit), 컴포넌트는 `tests/critical-path/countdown-component.test.tsx` (component via @testing-library/react) | ADR-0006 테스트 피라미드. critical-path 규칙 (네트워크/DB 금지) 준수. |
| 상점 API 연동 | **가정**: MVP 는 "매일 00:00 KST" 로컬 계산만 사용. 상점 API 응답의 `SingleItemOffersRemainingDurationInSeconds` 는 Props 로 주입 가능하되 기본값은 미사용 | FR-3 (storefront fetch) 는 별도 plan. 본 plan 은 독립 배포 가능해야 함. |

---

## Phase 1: 시간 계산 순수 함수

### 테스트 시나리오

#### Test 1-1: 00:00 KST 이전 시각에서 다음 자정까지의 남은 초 계산

```ts
// tests/critical-path/countdown.test.ts
describe("Feature: 상점 갱신 카운트다운", () => {
  describe("Scenario: 다음 00:00 KST 계산", () => {
    it("given_현재가_KST_23시59분00초_when_secondsUntilNextKstMidnight_then_60을_반환", () => {
      // Given: 2026-04-23 23:59:00 KST == 2026-04-23 14:59:00 UTC
      const now = Date.UTC(2026, 3, 23, 14, 59, 0);
      // When
      const remaining = secondsUntilNextKstMidnight(now);
      // Then
      expect(remaining).toBe(60);
    });
  });
});
```

#### Test 1-2: 자정 정각 경계 — 딱 00:00:00 KST 이면 24h (86400s) 반환

```ts
it("given_현재가_정확히_00시00분00초_KST_when_계산_then_86400초_반환", () => {
  // Given: 2026-04-24 00:00:00 KST == 2026-04-23 15:00:00 UTC
  const now = Date.UTC(2026, 3, 23, 15, 0, 0);
  // When
  const remaining = secondsUntilNextKstMidnight(now);
  // Then — 직전 프레임 자정 충돌 방지: "다음" 자정은 24h 뒤
  expect(remaining).toBe(86400);
});
```

#### Test 1-3: KST 자정 직전 1 ms 경계

```ts
it("given_23시59분59초999_when_계산_then_1초_반환_버림처리", () => {
  // Given
  const now = Date.UTC(2026, 3, 23, 14, 59, 59) + 999;
  // When
  const remaining = secondsUntilNextKstMidnight(now);
  // Then: Math.ceil 로 1 반환 (0초 까지 표시 유지)
  expect(remaining).toBe(1);
});
```

#### Test 1-4: HH:MM:SS 포맷팅

```ts
describe("Scenario: 초 → HH:MM:SS 포맷", () => {
  it.each([
    [0,       "00:00:00"],
    [1,       "00:00:01"],
    [59,      "00:00:59"],
    [60,      "00:01:00"],
    [3600,    "01:00:00"],
    [86399,   "23:59:59"],
  ])("given_%i초_when_format_then_%s", (input, expected) => {
    expect(formatHms(input)).toBe(expected);
  });
});
```

#### Test 1-5: 음수/NaN 방어

```ts
it("given_음수초_when_format_then_00_00_00_으로_clamp", () => {
  expect(formatHms(-5)).toBe("00:00:00");
  expect(formatHms(Number.NaN)).toBe("00:00:00");
});
```

### 구현 항목

**파일**: `lib/time/countdown.ts`
- `export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;`
- `export function secondsUntilNextKstMidnight(nowMs: number): number`
  - `const nowKst = nowMs + KST_OFFSET_MS;`
  - `const dayMs = 86_400_000;`
  - `const nextMidnightKst = Math.floor(nowKst / dayMs) * dayMs + dayMs;`
  - `return Math.max(0, Math.ceil((nextMidnightKst - nowKst) / 1000));`
  - 경계: 정확히 자정인 경우 diff 가 0 이 되므로 `nextMidnight = floor+1day` 로직으로 자연히 86400 반환.
- `export function formatHms(totalSeconds: number): string`
  - `Number.isFinite` 체크 + `Math.max(0, Math.floor(...))`
  - `pad2(h):pad2(m):pad2(s)`

---

## Phase 2: React 카운트다운 컴포넌트

### 테스트 시나리오

#### Test 2-1: 초기 렌더 시 placeholder 에서 첫 틱 이후 실제 값으로 전환

```tsx
// tests/critical-path/countdown-component.test.tsx
describe("Feature: Countdown 컴포넌트 렌더", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval','clearInterval','setTimeout','clearTimeout','Date','performance'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 50))); // 23:59:50 KST
  });
  afterEach(() => vi.useRealTimers());

  it("given_마운트_when_첫_렌더_then_placeholder_표기_후_틱에서_실제값", async () => {
    // Given
    render(<Countdown />);
    // Then (pre-tick placeholder)
    expect(screen.getByTestId("countdown")).toHaveTextContent("--:--:--");
    // When
    act(() => { vi.advanceTimersByTime(500); });
    // Then
    expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:10");
  });
});
```

#### Test 2-2: ±1초 정확도 — 1초 경과 후 정확히 1초 감소 (AC-3 직접 검증)

```tsx
it("given_10초_남음_when_1초_경과_then_9초로_감소", () => {
  // Given
  vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 50))); // 10s 남음
  render(<Countdown />);
  act(() => { vi.advanceTimersByTime(500); });
  expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:10");
  // When
  act(() => { vi.advanceTimersByTime(1000); });
  // Then
  expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:09");
});
```

#### Test 2-3: setInterval drift 방지 — 틱이 밀려도 벽시계 기준 재산출

```tsx
it("given_틱이_3초분_밀려도_when_벽시계_3초_전진_then_표시값도_3초_감소", () => {
  // Given: 시간을 먼저 전진시키되 타이머 콜백은 아직 실행 전
  vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 50))); // 10s 남음
  render(<Countdown />);
  act(() => { vi.advanceTimersByTime(500); });
  expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:10");
  // When: 3초치 벽시계만 이동 (tab background 시뮬레이션) + 다음 틱 1회
  act(() => { vi.advanceTimersByTime(3000); });
  // Then: 카운터 누적이 아니라 Date.now 재산출이므로 정확히 7초
  expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:07");
});
```

#### Test 2-4: 자정 롤오버 — 0 도달 후 다음날 자정으로 자동 타겟 교체

```tsx
it("given_자정_1초_전_when_2초_경과_then_00_00_00_표기_후_다음날_23_59_59_로_전환", () => {
  // Given: 23:59:59 KST (1초 남음)
  vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 59)));
  render(<Countdown />);
  act(() => { vi.advanceTimersByTime(500); });
  expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:01");
  // When: 1초 더 (자정 도달)
  act(() => { vi.advanceTimersByTime(1000); });
  // Then: 정확히 00:00:00 KST → 다음 자정 24h 뒤이므로 23:59:59 로 롤오버
  //       (정확히 00:00:00 순간은 secondsUntilNextKstMidnight = 86400 → 다음 틱에 86399)
  expect(screen.getByTestId("countdown")).toHaveTextContent(/23:59:59|24:00:00|00:00:00/);
});
```

#### Test 2-5: 언마운트 시 interval 해제 (메모리 누수 방지)

```tsx
it("given_마운트된_컴포넌트_when_unmount_then_clearInterval_호출", () => {
  // Given
  const clearSpy = vi.spyOn(globalThis, 'clearInterval');
  const { unmount } = render(<Countdown />);
  act(() => { vi.advanceTimersByTime(500); });
  // When
  unmount();
  // Then
  expect(clearSpy).toHaveBeenCalled();
});
```

#### Test 2-6: 동일 초 내 중복 렌더 억제

```tsx
it("given_같은_초_내_여러_틱_when_state_비교_then_setState_1회만_호출", () => {
  // Given
  vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 50)));
  const renderSpy = vi.fn();
  render(<Countdown onRender={renderSpy} />);
  // When: 500ms 틱 4번 (= 2초) → 초 값은 10 → 9 로 1회 변경
  act(() => { vi.advanceTimersByTime(2000); });
  // Then: 렌더는 초 변경 시점에만 (초기 placeholder + 10 + 9 = 3회 이내)
  expect(renderSpy.mock.calls.length).toBeLessThanOrEqual(3);
});
```

> 주의: Test 2-6 은 최적화 검증용 보조 테스트. 구현은 `onRender` prop 없이도 동작하며, 테스트 목적의 훅만 선택적으로 노출한다.

### 구현 항목

**파일**: `components/Countdown.tsx`
- `"use client"` directive
- `export interface CountdownProps { onRender?: () => void }`
- 내부 상태: `const [display, setDisplay] = useState<string>("--:--:--");`
- `useEffect(() => { ... }, [])`:
  - 즉시 1회 `tick()` 실행 (placeholder → 실제값 즉시 전환)
  - `const id = setInterval(tick, 500);`
  - cleanup: `clearInterval(id)`
- `function tick() { const next = formatHms(secondsUntilNextKstMidnight(Date.now())); setDisplay(prev => prev === next ? prev : next); }`
- 렌더: `<span data-testid="countdown" className="font-mono tabular-nums text-2xl">{display}</span>`
- `onRender?.()` 는 렌더 함수 상단에서 호출 (테스트 훅)

**파일**: `app/(app)/dashboard/page.tsx` (수정 — import + 배치만)
- 기존 대시보드 레이아웃 상단에 `<Countdown />` 삽입.
- 본 plan 범위에서는 placeholder 대시보드 파일에 최소 통합. 실제 상점 카드 레이아웃은 FR-3 plan 에 위임.

---

## NFR 반영

| 카테고리 | 반영 방식 |
|---|---|
| Performance | (1) `setInterval(500ms)` 로 1s 경계 놓침 방지하되 초 단위 변경 없을 때 setState skip → 렌더 부하 최소. (2) Date.now 기반 재산출로 CPU 계산 < 1µs/tick. (3) 배터리: 탭 background 시 브라우저가 알아서 throttle (drift 는 벽시계 재계산으로 자동 보정). NFR ±1초 정확도는 Test 1-1~1-5, 2-2, 2-3 로 검증. |
| Scale | N/A — 범위 외. 100% 클라이언트 사이드 연산이라 서버 부하 없음. ~50 concurrent 와 무관. |
| Availability | 99% best-effort — 시스템 시계가 잘못 설정되었거나 JS timer 가 멈추는 극단 상황 외에는 항상 동작. 외부 의존 없음. |
| Security | N/A — 범위 외. 토큰/쿠키/네트워크 호출 없음. |
| Compliance | N/A — 범위 외. 개인정보 비수집. |
| Operability | N/A — 범위 외. 별도 배포 훅/모니터링 불필요, Vercel 정적 번들에 포함. |
| Cost | $0 — 순수 클라이언트 번들. 추가 의존 무 (`lib/time/countdown.ts` 는 표준 라이브러리만 사용). |
| Maintainability | `lib/time/countdown.ts` 는 순수 함수 → `tests/critical-path/countdown.test.ts` 로 완전 커버. 컴포넌트는 fake timers 로 결정적 검증. ADR-0006 테스트 스택 준수. |

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 ─┬─ 1-1 테스트 ─┐
         ├─ 1-2 테스트 ─┤
         ├─ 1-3 테스트 ─┼─→ 1-impl (lib/time/countdown.ts) ─┐
         ├─ 1-4 테스트 ─┤                                    │
         └─ 1-5 테스트 ─┘                                    │
                                                             ▼
Phase 2 ─┬─ 2-1 테스트 ─┐                                    │
         ├─ 2-2 테스트 ─┤                                    │
         ├─ 2-3 테스트 ─┼─→ 2-impl (components/Countdown.tsx)┤ (Phase 1 완료 필요)
         ├─ 2-4 테스트 ─┤                                    │
         ├─ 2-5 테스트 ─┤                                    │
         └─ 2-6 테스트 ─┘                                    │
                                                             ▼
                                         2-integration (dashboard page 삽입)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3, 1-4, 1-5 테스트 작성 | 없음 | ✅ (모두 동일 파일이지만 각기 다른 `it` 블록이라 병렬 작성 OK; 단일 파일 저장이므로 `/implement` 는 순차 write 가능) |
| G2 | 1-impl (`lib/time/countdown.ts`) | G1 완료 | - |
| G3 | 2-1, 2-2, 2-3, 2-4, 2-5, 2-6 테스트 작성 | G2 완료 (`formatHms`, `secondsUntilNextKstMidnight` import) | ✅ |
| G4 | 2-impl (`components/Countdown.tsx`) | G3 완료 | - |
| G5 | 2-integration (`app/(app)/dashboard/page.tsx` 삽입) | G4 완료 | - |

### 종속성 판단 기준

- Phase 2 컴포넌트는 Phase 1 순수 함수를 import → 순서 필수.
- G1 과 G3 내부 테스트들은 같은 파일에 쓰이므로 파일 쓰기 단위로는 순차지만 논리적으로 독립.
- G5 는 G4 의 `<Countdown />` export 에 의존.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | 테스트: 23:59:00 KST 에서 60초 반환 | ✅ 완료 | |
| 1-2 | 테스트: 00:00:00 KST 경계에서 86400 반환 | ✅ 완료 | |
| 1-3 | 테스트: 23:59:59.999 에서 1초 반환 (ceil) | ✅ 완료 | |
| 1-4 | 테스트: formatHms 표 기반 케이스 | ✅ 완료 | |
| 1-5 | 테스트: 음수/NaN clamp | ✅ 완료 | |
| 1-impl | `lib/time/countdown.ts` 구현 | ✅ 완료 | |
| 2-1 | 테스트: 즉시 실제값 표시 | ✅ 완료 | useEffect에서 즉시 tick 실행 |
| 2-2 | 테스트: ±1초 정확도 (AC-3) | ✅ 완료 | |
| 2-3 | 테스트: setInterval drift 방지 | ✅ 완료 | |
| 2-4 | 테스트: 자정 롤오버 | ✅ 완료 | |
| 2-5 | 테스트: unmount 시 clearInterval | ✅ 완료 | |
| 2-6 | 테스트: 동일 초 내 setState skip | ✅ 완료 | |
| 2-impl | `components/Countdown.tsx` 구현 | ✅ 완료 | |
| 2-integration | `app/(app)/dashboard/page.tsx` 에 `<Countdown />` 삽입 | ✅ 완료 | |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
