# Plan 0010: 인프라 & 배포 (Vercel · PWA · 푸터 · 야시장 뷰)

## 개요

VAL-Shop 의 **기능 외 인프라/배포 성격 요구사항**을 하나의 plan 으로 묶어 TDD 기반으로 구현한다. 범위는 (1) Vercel 공개 배포 + instant rollback, (2) PWA 설치 가능 (manifest + Service Worker + 설치 배너), (3) 전 페이지 공통 푸터 "fan-made" 고지, (4) Phase 2 야시장 전용 뷰 (6개 스킨 + 할인율). PRD AC-4 (Lighthouse TTI≤3s), AC-5 (공개 URL + PWA 배너), AC-6 (무료 티어 한도) 를 직접 타겟으로 한다.

MVP 데드라인 (2026-04-26) 을 우선하기 위해 Phase 1 (Vercel 배포) → Phase 2 (PWA & 푸터) → Phase 3 (야시장 뷰, Phase 2 기능) 순으로 진행한다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 배포 플랫폼 | Vercel Hobby (Git push 자동 배포) | PRD § 7 스택 고정, NFR Cost $0 (AC-6), Operability "instant rollback" |
| 도메인 | `*.vercel.app` 기본 도메인만 사용 (커스텀 도메인 없음) | AC-5 충족, 비용 $0, DNS 관리 부담 제거 |
| 롤백 전략 | Vercel Dashboard "Promote to Production" (instant rollback) | 별도 CD 도구 도입 없이 Operability NFR 달성, 스크립트 작성 불필요 |
| PWA 구현 방식 | `public/manifest.webmanifest` + 순수 SW 파일 (`public/sw.js`) + `navigator.serviceWorker.register` (no `next-pwa`) | `next-pwa` 는 Next 15 App Router 지원 불안정, 스코프 작고 SW 1개면 충분, 번들 증가 0 |
| SW 캐시 전략 | App shell (`/`, `/dashboard`, `/login`, `/offline`) precache + runtime NetworkFirst for `/api/*` + CacheFirst for `/icons/*`, `/_next/static/*` | TTI 개선, Performance NFR (AC-4) 보강, 토큰 응답은 캐시 안 함 (Security NFR) |
| PWA 아이콘 | 192x192 + 512x512 PNG (maskable + any) | Chrome 설치 배너 최소 요건, 용량 최소 |
| 설치 배너 UX | `beforeinstallprompt` 이벤트를 가로채 커스텀 "앱으로 설치" 버튼을 대시보드 상단에 노출, 3번 dismiss 시 14일간 숨김 (localStorage) | AC-5 "배너 동작" 만족 + UX 과잉 방지 |
| 푸터 컴포넌트 위치 | `components/Footer.tsx` 를 `app/layout.tsx` 루트 `<body>` 에 삽입 | 모든 라우트 자동 적용, PRD § 7 법적 고지 요구 1곳에서 충족 |
| 푸터 문구 | "VAL-Shop 은 라이엇 게임즈와 무관한 팬메이드 프로젝트입니다" (PRD § 7 원문 그대로) | Compliance NFR, 변형 금지 |
| 야시장 데이터 파싱 | `lib/riot/storefront.ts` 의 기존 storefront 응답에서 `BonusStore` 노드를 옵셔널 파싱 → `NightMarket { items: NightMarketItem[] }` 도메인 타입 반환 | ARCHITECTURE § 2 Store Proxy 확장, FR-3 상점 파싱 재사용 |
| 야시장 뷰 라우트 | `/night-market` (Phase 2), 야시장 비활성 시 `/dashboard` 로 리다이렉트 | URL 직접 진입 허용, 대시보드와 분리 |
| 야시장 메타 캐싱 | 동일 `valorant-api.com` ISR (24h, ADR-0003 재사용) | 추가 캐시 레이어 0, Cost NFR |
| Lighthouse 측정 | `@lhci/cli` 로 로컬 실행 (CI 없음), preset `mobile`, threshold `tti ≤ 3000ms` | AC-4 객관적 측정, 무료 |
| 테스트 러너 | Vitest (unit/컴포넌트), Playwright (E2E manifest + 설치 배너) | ADR-0006 준수 |

---

## Phase 1: Vercel 배포 (MVP)

### 테스트 시나리오

#### Test 1-1: `vercel.json` 구성이 Phase 2 cron 을 포함하지 않는다 (MVP 단계)

```ts
// tests/critical-path/vercel-config.test.ts
import { describe, it, expect } from "vitest";
import vercelConfig from "../../vercel.json";

describe("Feature: Vercel 배포 구성", () => {
  describe("Scenario: MVP 단계에서 cron 비활성", () => {
    it("Given MVP vercel.json, When 로드, Then crons 키가 없거나 빈 배열이다", () => {
      // Given: repo 에 커밋된 vercel.json
      // When: 파싱
      // Then: cron 은 Phase 2 에서만 정의
      expect(vercelConfig.crons ?? []).toEqual([]);
    });
  });
});
```

#### Test 1-2: 배포된 URL 루트가 200 을 반환한다 (smoke, Playwright)

```ts
// tests/e2e/deploy-smoke.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Feature: 공개 배포 접근", () => {
  test("Given *.vercel.app URL, When GET /, Then 200 과 HTML 수신", async ({ request }) => {
    // Given: 배포 URL (env DEPLOY_URL)
    const url = process.env.DEPLOY_URL ?? "http://localhost:3000";
    // When
    const res = await request.get(url);
    // Then
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("<html");
  });
});
```

#### Test 1-3: `next.config.ts` 가 production 빌드 가능한 설정을 포함한다

```ts
// tests/critical-path/next-config.test.ts
import nextConfig from "../../next.config";
describe("Scenario: production 빌드 가능 설정", () => {
  it("Given next.config, When 로드, Then output 가 standalone 아니고 typed routes 활성", () => {
    // Given/When
    const cfg = typeof nextConfig === "function" ? nextConfig() : nextConfig;
    // Then
    expect(cfg.images).toBeDefined();
    expect((cfg as any).typedRoutes ?? cfg.experimental?.typedRoutes).toBe(true);
  });
});
```

#### Test 1-4 (measurement, Lighthouse CI): Mobile TTI ≤ 3000ms

```js
// lighthouserc.cjs
module.exports = {
  ci: {
    collect: { url: [process.env.DEPLOY_URL], settings: { preset: "desktop" } },
    assert: {
      assertions: {
        "interactive": ["error", { maxNumericValue: 3000 }],
        "first-contentful-paint": ["warn", { maxNumericValue: 1800 }],
      },
    },
  },
};
```
> Given 배포 URL, When `lhci autorun`, Then TTI ≤ 3000ms 로 AC-4 통과.

### 구현 항목

**파일**: `vercel.json`
- `framework: "nextjs"`, `regions: ["icn1"]` (한국 리전), Phase 2 까지는 `crons` 미기재.
- `headers`: `/sw.js` 에 `Cache-Control: no-cache`, `/manifest.webmanifest` 에 `Content-Type: application/manifest+json`.

**파일**: `next.config.ts`
- `images.remotePatterns` 에 `media.valorant-api.com` 등록.
- `experimental.typedRoutes: true`.
- `async headers()` 에서 루트 전체 `Strict-Transport-Security`, `X-Frame-Options: DENY` 추가 (Security NFR).

**파일**: `package.json`
- `scripts`: `"build": "next build"`, `"start": "next start"`, `"lhci": "lhci autorun"`.
- devDependencies 에 `@lhci/cli`.

**파일**: `lighthouserc.cjs`
- 위 Test 1-4 설정.

**파일**: `docs/DEPLOY.md` (새 파일) — README 에서 링크
- Vercel 프로젝트 생성 → GitHub 연동 → env (`TOKEN_ENC_KEY`) 입력 → `main` push → 자동 배포 절차.
- Instant rollback 절차: Vercel Dashboard → Deployments → 원하는 이전 배포 → "Promote to Production".
- 무료 티어 한도 모니터링 포인트 (Function Invocations, Bandwidth 100GB, Build Minutes 6000).

**파일**: `.env.example`
- 배포에 필요한 키 목록: `TOKEN_ENC_KEY`, (P2) `SUPABASE_URL`, `RESEND_API_KEY`.

---

## Phase 2: PWA & 공통 푸터 (MVP)

### 테스트 시나리오

#### Test 2-1: `manifest.webmanifest` 가 PWA 설치 요건을 충족한다

```ts
// tests/critical-path/pwa-manifest.test.ts
import manifest from "../../public/manifest.webmanifest";

describe("Feature: PWA 설치 가능", () => {
  describe("Scenario: Chrome 설치 배너 최소 요건", () => {
    it("Given manifest, When 검사, Then name/short_name/start_url/display/icons(192,512) 모두 존재", () => {
      // Given: 파일 로드
      const m = manifest as any;
      // When/Then
      expect(m.name).toBe("VAL-Shop");
      expect(m.short_name).toBeTruthy();
      expect(m.start_url).toBe("/dashboard");
      expect(m.display).toBe("standalone");
      expect(m.theme_color).toMatch(/^#/);
      const sizes = m.icons.map((i: any) => i.sizes);
      expect(sizes).toContain("192x192");
      expect(sizes).toContain("512x512");
      expect(m.icons.some((i: any) => i.purpose?.includes("maskable"))).toBe(true);
    });
  });
});
```

#### Test 2-2: Service Worker 가 app shell 을 precache 하고 API 응답은 캐시하지 않는다

```ts
// tests/critical-path/sw-strategies.test.ts
import { describe, it, expect } from "vitest";
import { shouldCache, cacheStrategyFor } from "../../public/sw-strategies";

describe("Scenario: 토큰 응답 캐시 금지", () => {
  it("Given /api/auth/callback, When 캐시 정책 조회, Then 'no-cache'", () => {
    expect(cacheStrategyFor("/api/auth/callback")).toBe("no-cache");
  });
  it("Given /icons/skin.png, When 조회, Then 'cache-first'", () => {
    expect(cacheStrategyFor("/_next/static/chunks/abc.js")).toBe("cache-first");
  });
  it("Given /api/store, When 조회, Then 'network-first'", () => {
    expect(cacheStrategyFor("/api/store")).toBe("network-first");
  });
  it("Given /dashboard, When shouldCache, Then true (app shell)", () => {
    expect(shouldCache("/dashboard")).toBe(true);
  });
});
```

#### Test 2-3: `<Footer />` 가 법적 고지 문구를 포함한다

```tsx
// tests/critical-path/footer.test.tsx
import { render, screen } from "@testing-library/react";
import { Footer } from "../../components/Footer";

describe("Feature: 법적 고지 푸터", () => {
  describe("Scenario: 모든 페이지 공통 푸터", () => {
    it("Given 렌더, When 조회, Then 'VAL-Shop 은 라이엇 게임즈와 무관한 팬메이드 프로젝트' 포함", () => {
      // Given/When
      render(<Footer />);
      // Then
      expect(
        screen.getByText(/VAL-Shop 은 라이엇 게임즈와 무관한 팬메이드 프로젝트/)
      ).toBeInTheDocument();
    });
    it("Given 렌더, When role=contentinfo 쿼리, Then landmark 존재 (접근성)", () => {
      render(<Footer />);
      expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    });
  });
});
```

#### Test 2-4: `app/layout.tsx` 가 `<Footer />` 를 포함하여 모든 라우트에 노출된다 (E2E)

```ts
// tests/e2e/footer.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Scenario: 모든 페이지에서 푸터 노출", () => {
  for (const path of ["/", "/login", "/dashboard", "/privacy"]) {
    test(`Given ${path}, When 방문, Then 푸터 문구 노출`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByText(/팬메이드 프로젝트/)).toBeVisible();
    });
  }
});
```

#### Test 2-5: 설치 배너 컴포넌트가 `beforeinstallprompt` 이벤트 수신 시 버튼을 노출한다

```tsx
// tests/critical-path/install-prompt.test.tsx
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallPrompt } from "../../components/InstallPrompt";

describe("Scenario: 설치 배너 노출/숨김", () => {
  it("Given beforeinstallprompt 이벤트, When 발생, Then 버튼 노출", async () => {
    render(<InstallPrompt />);
    const fakeEvent: any = new Event("beforeinstallprompt");
    fakeEvent.prompt = vi.fn().mockResolvedValue(undefined);
    fakeEvent.userChoice = Promise.resolve({ outcome: "accepted" });
    act(() => { window.dispatchEvent(fakeEvent); });
    expect(await screen.findByRole("button", { name: /앱으로 설치/ })).toBeVisible();
  });
  it("Given 3회 dismiss, When 다시 이벤트 발생, Then 14일간 숨김", () => {
    localStorage.setItem("pwa:dismissed", JSON.stringify({ count: 3, until: Date.now() + 1e9 }));
    render(<InstallPrompt />);
    window.dispatchEvent(new Event("beforeinstallprompt"));
    expect(screen.queryByRole("button", { name: /앱으로 설치/ })).toBeNull();
  });
});
```

#### Test 2-6: SW 등록이 `navigator.serviceWorker` 미지원 환경에서 silent fail

```ts
// tests/critical-path/sw-register.test.ts
import { registerServiceWorker } from "../../lib/pwa/register";
it("Given navigator.serviceWorker undefined, When register, Then throw 없음", () => {
  Object.defineProperty(global, "navigator", { value: {}, configurable: true });
  expect(() => registerServiceWorker()).not.toThrow();
});
```

### 구현 항목

**파일**: `public/manifest.webmanifest`
- `name`, `short_name`, `start_url: /dashboard`, `display: standalone`, `theme_color`, `background_color`, `icons[192,512,maskable]`, `scope: /`, `lang: ko`.

**파일**: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`
- 단색 + 이니셜 V 기반 간단 PNG (디자이너 부재).

**파일**: `public/sw.js`
- install: app shell precache (`/`, `/dashboard`, `/login`, `/offline`, `/manifest.webmanifest`).
- activate: 오래된 캐시 버전 정리.
- fetch: URL 패턴 매칭 → `cacheStrategyFor()` 결과에 따라 NetworkFirst / CacheFirst / no-cache.
- `/api/auth/*`, `/api/store` 는 인증 관련이므로 `no-cache` (Security NFR: 토큰 응답 디스크 미저장).

**파일**: `public/sw-strategies.ts` (빌드 시 `sw.js` 가 import — 또는 순수 JS 로 인라인 복사)
- `cacheStrategyFor(url)` 순수 함수 + `shouldCache(path)` export.

**파일**: `lib/pwa/register.ts`
- `export function registerServiceWorker()` — `'serviceWorker' in navigator` 가드 후 `navigator.serviceWorker.register("/sw.js", { scope: "/" })`.

**파일**: `components/Footer.tsx`
- `<footer role="contentinfo">` 에 고지 문구 + `/privacy` 링크 + GitHub 링크 (선택).
- Tailwind 로 `mt-auto text-xs text-muted-foreground` (ADR-0007).

**파일**: `components/InstallPrompt.tsx`
- `'use client'`. `beforeinstallprompt` 리스너 + `prompt()` 호출 + dismiss 카운터 localStorage 관리.

**파일**: `app/layout.tsx`
- `<head>` 에 `<link rel="manifest" href="/manifest.webmanifest" />`, `<meta name="theme-color" ... />`, apple-touch-icon.
- `<body>` 에 children 뒤 `<Footer />` + `<InstallPrompt />` 삽입.
- 클라이언트 훅 `useEffect(() => registerServiceWorker(), [])` 를 담은 `<PWAInit />` 컴포넌트 mount.

**파일**: `app/offline/page.tsx`
- 오프라인 fallback UI (정적). SW precache 대상.

---

## Phase 3: 야시장 전용 뷰 (Phase 2)

### 가정 사항 (인터페이스 명시)

FR-3 의 storefront 응답 파서 확장. `pd.kr.a.pvp.net/store/v2/storefront/{puuid}` 응답에 `BonusStore` 노드가 있을 때만 야시장 활성:

```ts
// lib/domain/night-market.ts
export interface NightMarketItem {
  skinUuid: string;           // Offer.Rewards[0].ItemID
  originalPriceVp: number;    // DiscountCosts.<VP UUID> 이전 원가
  discountedPriceVp: number;  // DiscountCosts.<VP UUID>
  discountPercent: number;    // DiscountPercent (0~100 정수)
  isRevealed: boolean;        // IsSeen
}
export interface NightMarket {
  items: NightMarketItem[];          // 항상 6개 기대, 실제 length 로 검증
  endsAtEpochMs: number;             // BonusStoreRemainingDurationInSeconds → 절대시각
}
export type NightMarketState =
  | { active: false }
  | { active: true; market: NightMarket };
```

### 테스트 시나리오

#### Test 3-1: storefront 응답에 `BonusStore` 가 없으면 비활성 반환

```ts
// tests/critical-path/night-market-parse.test.ts
import { parseNightMarket } from "../../lib/riot/night-market";
import fixtureNoBonus from "./fixtures/storefront-no-bonus.json";

describe("Feature: 야시장 파싱", () => {
  it("Given BonusStore 없음, When parse, Then active:false", () => {
    // Given
    // When
    const res = parseNightMarket(fixtureNoBonus);
    // Then
    expect(res.active).toBe(false);
  });
});
```

#### Test 3-2: `BonusStore` 6개 아이템 + 할인율 파싱

```ts
import fixtureBonus from "./fixtures/storefront-bonus.json";
it("Given BonusStore 6 offers, When parse, Then 6 items + discount% 정수", () => {
  const res = parseNightMarket(fixtureBonus);
  if (!res.active) throw new Error("expected active");
  expect(res.market.items).toHaveLength(6);
  for (const item of res.market.items) {
    expect(item.discountPercent).toBeGreaterThanOrEqual(1);
    expect(item.discountPercent).toBeLessThanOrEqual(99);
    expect(item.discountedPriceVp).toBeLessThan(item.originalPriceVp);
  }
  expect(res.market.endsAtEpochMs).toBeGreaterThan(Date.now());
});
```

#### Test 3-3: `/night-market` 페이지 — 활성 시 6개 카드 + 할인율 렌더

```tsx
// tests/critical-path/night-market-view.test.tsx
import { render, screen } from "@testing-library/react";
import { NightMarketView } from "../../app/(app)/night-market/view";
it("Given active market 6 items, When render, Then 6 카드 + '-%' 노출", () => {
  const market = { items: Array.from({ length: 6 }, (_, i) => ({
    skinUuid: `uuid-${i}`, originalPriceVp: 1775,
    discountedPriceVp: 1000, discountPercent: 44, isRevealed: true,
  })), endsAtEpochMs: Date.now() + 86400000 };
  render(<NightMarketView market={market} metaBySkin={{}} />);
  expect(screen.getAllByTestId("night-market-card")).toHaveLength(6);
  expect(screen.getAllByText(/-44%/)).toHaveLength(6);
});
```

#### Test 3-4: 야시장 비활성 시 `/night-market` 이 `/dashboard` 로 302

```ts
// tests/e2e/night-market-redirect.spec.ts
test("Given 야시장 비활성, When GET /night-market, Then 리다이렉트 /dashboard", async ({ page }) => {
  // Given: MSW 가 storefront 에 BonusStore 없는 응답
  // When
  const res = await page.goto("/night-market");
  // Then
  expect(page.url()).toContain("/dashboard");
});
```

#### Test 3-5: 메타 조회는 기존 `valorant-api` ISR 캐시를 재사용 (모킹 호출 횟수 1)

```ts
it("Given 2회 연속 렌더, When 메타 조회, Then valorant-api fetch 1회만 호출 (ISR 재사용)", async () => {
  const fetchSpy = vi.spyOn(global, "fetch");
  await loadNightMarket();
  await loadNightMarket();
  const apiCalls = fetchSpy.mock.calls.filter(c =>
    String(c[0]).includes("valorant-api.com/v1/weapons/skins")
  );
  expect(apiCalls.length).toBeLessThanOrEqual(1);
});
```

### 구현 항목

**파일**: `lib/domain/night-market.ts`
- 위 인터페이스 정의 + `isActive(state: NightMarketState)` 가드.

**파일**: `lib/riot/night-market.ts`
- `export function parseNightMarket(storefrontJson): NightMarketState` — storefront 응답에서 `BonusStore.BonusStoreOffers` 순회, VP costs UUID (`85ad13f7-...`) 로 금액 매칭, `BonusStoreRemainingDurationInSeconds` 를 `Date.now()` 기반 epoch 로 변환.

**파일**: `app/api/store/route.ts` (기존 파일 확장)
- 반환 payload 에 `nightMarket: NightMarketState` 필드 추가 (기존 상점 파싱과 병렬 계산, 1 round-trip 유지 → Performance NFR).

**파일**: `app/(app)/night-market/page.tsx`
- SSR. `nightMarket.active === false` → `redirect("/dashboard")`.
- 활성 시 6개 `NightMarketCard` + 남은 시간 countdown (기존 `components/Countdown.tsx` 재사용).

**파일**: `app/(app)/night-market/view.tsx`
- `'use client'` 컴포넌트. 테스트 가능한 순수 렌더러.

**파일**: `components/NightMarketCard.tsx`
- `SkinCard` 변형. 할인율 배지 `-{percent}%`, 원가 strikethrough, `data-testid="night-market-card"`.

**파일**: `app/(app)/dashboard/page.tsx` (기존 파일)
- `nightMarket.active` 이면 상단에 "야시장이 열렸습니다 →" 배너 + `/night-market` 링크 노출.

**파일**: `tests/critical-path/fixtures/storefront-bonus.json`, `storefront-no-bonus.json`
- 실제 storefront 응답 구조 (MSW 핸들러와 공유).

---

## NFR 반영

PRD § 6 의 8개 카테고리 전부를 이 plan 의 테스트/측정·구현에 매핑한다.

| # | NFR 카테고리 | 목표/제약 | 이 plan 의 반영 | 검증 번호 |
|---|---|---|---|---|
| 1 | Performance | Lighthouse Mobile TTI ≤ 3s (AC-4) | SW app shell precache (2-2), 야시장도 1 round-trip 파싱 재사용 (3-5, ADR-0003), Tailwind JIT 경량 번들 (ADR-0007), `regions: icn1` | **Test 1-4** (Lighthouse CI threshold 3000ms) |
| 2 | Scale | ~50 concurrent | Vercel Serverless 자동 스케일, SW 로 정적 자원 edge 외 캐시 → 동시 접속 부담 경감 | Test 1-2 (smoke), Lighthouse 측정에서 충분 |
| 3 | Availability | 99% best-effort + 배포 실패 시 instant rollback | `docs/DEPLOY.md` 에 Vercel "Promote to Production" 롤백 절차, SW 로 valorant-api 장애 시 stale 아이콘/메타 | **Test 1-1** (vercel.json 유효), Test 1-2 (smoke) |
| 4 | Security | HTTPS only, PWA scope 제한, 토큰 응답 캐시 금지 | `next.config.ts` HSTS header, manifest `scope: /`, SW 정책 `/api/auth/*` no-cache | **Test 2-2** (캐시 전략 단위 테스트), Test 1-3 |
| 5 | Compliance | 전 페이지 "fan-made" 고지 필수 | `components/Footer.tsx` 를 `app/layout.tsx` 루트에 삽입 (PRD § 7 원문 그대로) | **Test 2-3** (문구 존재), **Test 2-4** (4개 라우트 E2E) |
| 6 | Operability | Git push 자동 배포, instant rollback, 기본 로그 | Vercel GitHub 연동 (Phase 1), `docs/DEPLOY.md` 롤백 절차 | **Test 1-1**, Test 1-2, Test 1-3 |
| 7 | Cost | **$0/월 — Vercel free tier 한도 (AC-6)** | Hobby plan, 추가 서비스 0 (Sentry/CDN/`next-pwa` 없음), 커스텀 도메인 없음, cron 은 Phase 2 에서만 1h 간격 (ADR-0004) | Test 1-1 (cron 미포함 보장), `docs/DEPLOY.md` 무료 티어 모니터링 포인트 |
| 8 | Maintainability | README + 배포 가이드 | `docs/DEPLOY.md` 신설 (Vercel 절차 + 롤백 + env + 무료 티어 모니터링), `.env.example` 키 공개, `README.md` 에서 링크 | Test 1-3 (config 존재), `docs/DEPLOY.md` 자체가 산출물 |

### 설계 결정 ↔ NFR 연결 요약

- **순수 SW (no `next-pwa`)** ← Performance (번들 증가 0), Cost (의존성 0), Maintainability (블랙박스 회피).
- **`*.vercel.app` 기본 도메인** ← Cost ($0), Operability (DNS 관리 없음).
- **ISR 재사용 (야시장 메타)** ← Performance, Cost, Availability (stale-while-revalidate).
- **푸터 루트 삽입** ← Compliance (누락 불가), Maintainability (1곳 유지).
- **Phase 분리** ← 시간 제약 (PRD § 7, 2026-04-26 데드라인) 을 Scale/Availability NFR 보다 우선.

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (MVP — Vercel 배포)
  ├─ 1-1 테스트 (vercel.json) ──────┐
  ├─ 1-3 테스트 (next.config) ──────┼─→ 1-impl (vercel.json, next.config.ts, DEPLOY.md)
  └─ 1-2 테스트 (smoke E2E) ────────┘        │
                                             │
                                             ▼
                                       1-4 Lighthouse measurement (배포 URL 필요)
                                             │
                 ┌───────────────────────────┘
                 ▼
Phase 2 (MVP — PWA & 푸터)
  ├─ 2-1 manifest 테스트 ───→ 2-impl-manifest (manifest + icons)
  ├─ 2-2 SW 전략 테스트 ────→ 2-impl-sw (public/sw.js + sw-strategies.ts)
  ├─ 2-6 SW register 테스트 → 2-impl-register (lib/pwa/register.ts)
  ├─ 2-3 Footer 단위 테스트 → 2-impl-footer (components/Footer.tsx)
  ├─ 2-5 InstallPrompt 테스트 → 2-impl-prompt (components/InstallPrompt.tsx)
  └─ 2-4 Footer E2E ────────→ 2-impl-layout (app/layout.tsx 통합 — 위 모두 필요)
                                             │
                                             ▼
Phase 3 (Phase 2 기능 — 야시장 뷰)   ※ FR-3 Store Proxy 가 선행 구현되어 있다고 가정
  ├─ 3-1 parse 비활성 테스트 ┐
  ├─ 3-2 parse 활성 테스트 ──┼─→ 3-impl-parse (lib/riot/night-market.ts)
  │                          │              │
  ├─ 3-5 ISR 재사용 테스트 ──┘              ▼
  │                              3-impl-route (app/api/store/route.ts 확장)
  │                                          │
  ├─ 3-3 view 렌더 테스트 ─────→ 3-impl-view (NightMarketCard, view.tsx)
  └─ 3-4 redirect E2E ─────────→ 3-impl-page (app/(app)/night-market/page.tsx + dashboard 배너)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3 테스트 | 없음 | ✅ |
| G2 | 1-impl (vercel.json, next.config.ts, DEPLOY.md, .env.example, package.json) | G1 완료 | - (같은 설정 레이어) |
| G3 | 1-4 Lighthouse 측정 | G2 완료 + 실제 배포 | - |
| G4 | 2-1, 2-2, 2-3, 2-5, 2-6 테스트 | G2 완료 | ✅ |
| G5 | 2-impl-manifest, 2-impl-sw, 2-impl-register, 2-impl-footer, 2-impl-prompt | G4 완료, 파일 서로 독립 | ✅ |
| G6 | 2-4 E2E 테스트 + 2-impl-layout (app/layout.tsx) | G5 완료 (모든 컴포넌트 존재) | - |
| G7 | 3-1, 3-2, 3-5 테스트 | G2 완료 (Phase 1 배포 설정 필요) | ✅ |
| G8 | 3-impl-parse (lib/riot/night-market.ts) | G7 완료 | - |
| G9 | 3-impl-route (app/api/store/route.ts 확장) | G8 완료 | - |
| G10 | 3-3 view 테스트 | G8 완료 | ✅ (G9 와 병렬) |
| G11 | 3-impl-view (NightMarketCard + view.tsx) | G10 완료 | - |
| G12 | 3-4 redirect E2E + 3-impl-page + dashboard 배너 | G9 + G11 완료 | - |

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | vercel.json 구성 테스트 | ⬜ 미착수 | Phase 1 |
| 1-2 | 배포 URL smoke E2E | ⬜ 미착수 | Phase 1, DEPLOY_URL env |
| 1-3 | next.config production 테스트 | ⬜ 미착수 | Phase 1 |
| 1-4 | Lighthouse CI TTI≤3s 측정 | ⬜ 미착수 | AC-4, 배포 후 |
| 1-impl | vercel.json / next.config.ts / DEPLOY.md / .env.example / package.json | ⬜ 미착수 | Phase 1 구현 |
| 2-1 | manifest.webmanifest 유효성 테스트 | ⬜ 미착수 | AC-5 |
| 2-2 | SW 캐시 전략 단위 테스트 | ⬜ 미착수 | Security NFR |
| 2-3 | Footer 문구 + 접근성 테스트 | ⬜ 미착수 | Compliance NFR |
| 2-4 | Footer 전 페이지 E2E | ⬜ 미착수 | Compliance NFR |
| 2-5 | InstallPrompt beforeinstallprompt 테스트 | ⬜ 미착수 | AC-5 |
| 2-6 | SW register silent fail 테스트 | ⬜ 미착수 | 견고성 |
| 2-impl-manifest | public/manifest.webmanifest + 아이콘 PNG | ⬜ 미착수 | Phase 2 |
| 2-impl-sw | public/sw.js + sw-strategies.ts + app/offline/page.tsx | ⬜ 미착수 | Phase 2 |
| 2-impl-register | lib/pwa/register.ts + PWAInit | ⬜ 미착수 | Phase 2 |
| 2-impl-footer | components/Footer.tsx | ⬜ 미착수 | Phase 2 |
| 2-impl-prompt | components/InstallPrompt.tsx | ⬜ 미착수 | Phase 2 |
| 2-impl-layout | app/layout.tsx (manifest link + Footer + PWAInit + InstallPrompt 삽입) | ⬜ 미착수 | Phase 2 통합 |
| 3-1 | parseNightMarket 비활성 테스트 | ⬜ 미착수 | Phase 2 기능 |
| 3-2 | parseNightMarket 6-item 활성 테스트 | ⬜ 미착수 | Phase 2 기능 |
| 3-3 | NightMarketView 렌더 테스트 | ⬜ 미착수 | Phase 2 기능 |
| 3-4 | /night-market redirect E2E | ⬜ 미착수 | Phase 2 기능 |
| 3-5 | ISR 재사용 (fetch 호출 1회) 테스트 | ⬜ 미착수 | ADR-0003 재사용 |
| 3-impl-parse | lib/domain/night-market.ts + lib/riot/night-market.ts + fixtures | ⬜ 미착수 | Phase 2 기능 |
| 3-impl-route | app/api/store/route.ts 확장 (nightMarket 필드) | ⬜ 미착수 | Phase 2 기능 |
| 3-impl-view | components/NightMarketCard.tsx + app/(app)/night-market/view.tsx | ⬜ 미착수 | Phase 2 기능 |
| 3-impl-page | app/(app)/night-market/page.tsx + dashboard 배너 | ⬜ 미착수 | Phase 2 기능 |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
