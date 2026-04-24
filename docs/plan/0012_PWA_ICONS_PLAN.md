# Plan 0012: PWA_ICONS — PWA 설치 아이콘 자산 추가

## 개요
`public/manifest.webmanifest` 와 `app/layout.tsx` 에서 참조하는 아이콘 3종(192 any, 512 any, 512 maskable) 이 실제로 존재하지 않아 Chrome PWA 설치 배너(AC-5) 가 트리거되지 않는 문제를 해결한다. 팬메이드 프로젝트 Compliance 제약에 따라 Riot 공식 자산 없이 "VS" 이니셜 기반의 독립 브랜드 아이콘을 생성하고, 빌드 시점에 SVG 소스에서 PNG 를 결정론적으로 렌더링하는 스크립트를 도입한다. favicon.ico 레거시 대응과 manifest 테스트 확장, 로컬 Lighthouse 측정 가이드를 함께 포함한다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 아이콘 디자인 | "VS" 모노그램 + `#ff4655` 배경 (theme_color 조화), `#0f1923` 텍스트 대비 | Compliance: Riot 공식 자산 금지. brand_color 일관성. |
| 생성 방법 | (b) 빌드 타임 SVG→PNG 스크립트 (`scripts/generate-icons.ts`) 사용 후 PNG 를 `public/icons/` 에 커밋 | (a) 수동: 재현성 낮음. (c) 런타임 리사이즈: PWA manifest 는 실제 PNG URL 필요, installability 만족 안 함. (b) 는 결정론적 + Cost($0, 빌드 시 1회) + Maintainability(SVG 수정만으로 재생성). |
| PNG 렌더러 | `sharp` (이미 Vercel/Next 에 포함된 의존성 계열, native) — devDependency 로 추가 | 대안 `resvg-js`, `puppeteer` 대비 설치 크기/속도 우수. MIT. |
| Maskable safe zone | 512 캔버스 중앙 409.6px (80%) 원형 safe zone 안에 "VS" 배치. 배경은 full bleed `#ff4655` | W3C spec: maskable 아이콘은 safe zone 밖이 crop 됨 |
| favicon.ico | `public/favicon.ico` 를 32x32/16x16 멀티사이즈로 동일 SVG 에서 생성, 스크립트에 포함 | 레거시 브라우저 및 탭 아이콘. Next.js root 자동 인식. |
| 소스 위치 | `assets/icons/icon.svg`, `assets/icons/icon-maskable.svg` (2개 SVG 소스) | 리포 루트 `assets/` 는 빌드 입력, `public/` 은 산출물. 소스/산출물 분리. |
| 스크립트 실행 시점 | `package.json` 의 `prebuild` 훅 + 수동 `npm run icons` | CI 와 로컬 빌드 모두 일관. 생성물은 git 커밋해 Vercel 빌드 실패 시 fallback 확보. |
| 테스트 전략 | `pwa-manifest.test.ts` 확장: 아이콘 파일 존재 + PNG 매직넘버 검증 + 크기(읽어서 width/height) 검증 | Maintainability: critical path. |
| Lighthouse 가이드 | `README.md` 에 `npx lhci autorun` 로컬 실행 섹션 추가 (CI 도입은 별도 plan) | Cost: CI $0 유지. Operability: 수동 스모크. |
| Compliance 고지 | 아이콘 SVG 에 `data-fan-made="true"` 주석 + `README.md` 팬메이드 고지 강화 | Compliance NFR: Riot ToS. |

## NFR 반영

| 카테고리 | 반영 내용 |
|---------|----------|
| Performance | PNG 는 sharp 로 optimized (palette, compressionLevel=9). 192 PNG ≤ 4KB, 512 ≤ 12KB 목표. TTI 에 영향 없음(정적 자산, CDN 캐시). |
| Scale | 정적 자산이므로 동시 50 사용자와 무관. Vercel CDN 에지 캐시(immutable). |
| Availability | 생성물을 git 에 커밋해 빌드 스크립트 실패 시에도 산출물 유실 없음(99% best-effort). |
| Security | SVG 에 외부 참조/스크립트 없음. PNG 는 확장자 검증 테스트로 변조 방지. HTTPS 전달(Vercel 기본). |
| Compliance | Riot 공식 자산 0% 사용. "VS" 이니셜 기반 독립 브랜드. SVG/README 에 팬메이드 고지. |
| Operability | `npm run icons` 단일 커맨드 재생성. Vercel 로그에서 prebuild 출력 확인. |
| Cost | sharp 는 devDependency (런타임 $0). 정적 파일 CDN 비용 무시 수준. CI Lighthouse 는 로컬 가이드로 회피. |
| Maintainability | SVG 소스 수정 → 스크립트로 일괄 재생성. 테스트가 파일 존재/크기/매직넘버 검증해 회귀 방지. |

## 가정사항
- `sharp` 를 devDependency 로 추가 가능 (Node 런타임 native binding 이슈 없음).
- `assets/` 디렉터리 생성은 허용됨 (git tracked).
- 디자인 최종 승인은 별도 프로세스 없음 — "VS" 모노그램 스펙으로 바로 진행.
- `public/icons/*.png` 와 `public/favicon.ico` 를 git 에 커밋한다 (binary 허용).
- `app/layout.tsx` 의 icon 참조는 수정 불필요 (경로 그대로 사용).
- `components/InstallPrompt.tsx` 의 `beforeinstallprompt` 핸들러는 이미 존재한다고 가정(이 plan 에서는 테스트만 보강).

---

## Phase 1: 아이콘 소스 및 생성 스크립트

### 테스트 시나리오

#### Test 1-1: SVG 소스 파일 존재 및 safe zone 검증
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("Feature: PWA 아이콘 소스", () => {
  it("givenRepo_whenReadingSvgSources_thenBothFilesExist", () => {
    // Given: assets/icons 디렉터리
    const base = join(__dirname, "../../assets/icons");
    // When: SVG 경로 확인
    // Then: 두 소스 모두 존재
    expect(existsSync(join(base, "icon.svg"))).toBe(true);
    expect(existsSync(join(base, "icon-maskable.svg"))).toBe(true);
  });

  it("givenMaskableSvg_whenParsing_thenContentInsideSafeZone", () => {
    // Given: maskable SVG
    const svg = readFileSync(join(__dirname, "../../assets/icons/icon-maskable.svg"), "utf-8");
    // When/Then: viewBox 는 0 0 512 512 이고 텍스트 그룹이 safe zone(중앙 80%) 내부
    expect(svg).toMatch(/viewBox=["']0 0 512 512["']/);
    // safe zone translate 힌트 주석 또는 data-safe-zone 속성 존재
    expect(svg).toMatch(/data-safe-zone="80"/);
  });
});
```

#### Test 1-2: generate-icons 스크립트 실행 결과
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { existsSync, statSync } from "fs";
import { join } from "path";

describe("Feature: 아이콘 생성 스크립트", () => {
  beforeAll(() => {
    // Given: 소스 SVG 존재
    // When: 스크립트 실행
    execSync("npm run icons", { cwd: join(__dirname, "../..") });
  });

  it("givenScriptRun_whenFinished_thenAllIconFilesGenerated", () => {
    // Then: 3개 PNG + favicon 생성
    const pub = join(__dirname, "../../public");
    expect(existsSync(join(pub, "icons/icon-192.png"))).toBe(true);
    expect(existsSync(join(pub, "icons/icon-512.png"))).toBe(true);
    expect(existsSync(join(pub, "icons/icon-maskable-512.png"))).toBe(true);
    expect(existsSync(join(pub, "favicon.ico"))).toBe(true);
  });

  it("givenScriptRun_whenFinished_thenFileSizeWithinBudget", () => {
    // Performance NFR: 192 ≤ 4KB, 512 ≤ 12KB
    const pub = join(__dirname, "../../public");
    expect(statSync(join(pub, "icons/icon-192.png")).size).toBeLessThanOrEqual(4096);
    expect(statSync(join(pub, "icons/icon-512.png")).size).toBeLessThanOrEqual(12288);
    expect(statSync(join(pub, "icons/icon-maskable-512.png")).size).toBeLessThanOrEqual(12288);
  });
});
```

### 구현 항목

**파일**: `assets/icons/icon.svg`
- 512x512 viewBox, 배경 `#ff4655` full bleed
- 중앙 "VS" 모노그램 (font-weight 900, 대비용 `#0f1923`)
- `data-fan-made="true"` 주석

**파일**: `assets/icons/icon-maskable.svg`
- 동일 viewBox, 배경 full bleed
- "VS" 를 safe zone 80% (중앙 409.6px) 내부에 축소 배치
- `data-safe-zone="80"` 속성

**파일**: `scripts/generate-icons.ts`
- `sharp` 로 icon.svg → 192.png, 512.png 렌더
- icon-maskable.svg → maskable-512.png 렌더
- icon.svg → favicon.ico (16+32 멀티사이즈, sharp + `to-ico` 또는 sharp 다중 resize)
- compressionLevel 9, palette:true 적용

**파일**: `package.json`
- `devDependencies`: `sharp`, `to-ico`, `tsx` (존재 확인)
- `scripts.icons`: `tsx scripts/generate-icons.ts`
- `scripts.prebuild`: `npm run icons` (기존 prebuild 가 있으면 chain)

---

## Phase 2: manifest/layout 참조 검증 및 테스트 확장

### 테스트 시나리오

#### Test 2-1: manifest 에서 참조하는 파일의 실체 존재
```ts
it("givenManifest_whenIconsReferenced_thenFilesExistOnDisk", () => {
  // Given: manifest
  const m = manifest as any;
  // When: 각 icon src 를 public/ 하위에서 resolve
  // Then: 모두 실제 파일로 존재
  for (const icon of m.icons) {
    const p = join(__dirname, "../../public", icon.src);
    expect(existsSync(p)).toBe(true);
  }
});
```

#### Test 2-2: PNG 매직넘버 + 크기 검증
```ts
it("givenReferencedIcons_whenReadingBytes_thenValidPngWithDeclaredSize", async () => {
  // Given: manifest icons
  // When: 각 파일 헤더 read
  // Then: 첫 8바이트 PNG 시그니처 일치, IHDR width/height == sizes
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const icon of (manifest as any).icons) {
    const buf = readFileSync(join(__dirname, "../../public", icon.src));
    expect(buf.subarray(0, 8).equals(sig)).toBe(true);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const [w, h] = icon.sizes.split("x").map(Number);
    expect(width).toBe(w);
    expect(height).toBe(h);
  }
});
```

#### Test 2-3: layout.tsx 참조 아이콘도 실제 존재
```ts
it("givenLayoutIconLinks_whenResolving_thenFilesExist", () => {
  // Given: app/layout.tsx 내 <link rel="icon" />, <link rel="apple-touch-icon" />
  const layout = readFileSync(join(__dirname, "../../app/layout.tsx"), "utf-8");
  const hrefs = [...layout.matchAll(/href="(\/icons\/[^"]+)"/g)].map(m => m[1]);
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(existsSync(join(__dirname, "../../public", href))).toBe(true);
  }
});
```

### 구현 항목

**파일**: `tests/critical-path/pwa-manifest.test.ts`
- 기존 3개 테스트 유지
- Test 2-1, 2-2, 2-3 추가
- PNG 매직넘버 파서 유틸 inline

**파일**: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`, `public/favicon.ico`
- Phase 1 스크립트 산출물 커밋

---

## Phase 3: InstallPrompt 회귀 테스트 + README Lighthouse 가이드

### 테스트 시나리오

#### Test 3-1: InstallPrompt 컴포넌트가 beforeinstallprompt 이벤트 수신 시 버튼 렌더
```tsx
it("givenBeforeInstallPromptEvent_whenDispatched_thenInstallButtonVisible", async () => {
  // Given: InstallPrompt 마운트
  render(<InstallPrompt />);
  // When: beforeinstallprompt 이벤트 디스패치 (preventDefault 확인)
  const event = new Event("beforeinstallprompt") as any;
  event.prompt = vi.fn();
  window.dispatchEvent(event);
  // Then: "설치" 버튼 가시성
  expect(await screen.findByRole("button", { name: /설치/ })).toBeInTheDocument();
});
```

#### Test 3-2: README 에 Lighthouse 로컬 측정 섹션 존재
```ts
it("givenReadme_whenSearching_thenLighthouseSectionPresent", () => {
  // Given: README.md
  const readme = readFileSync(join(__dirname, "../../README.md"), "utf-8");
  // When/Then
  expect(readme).toMatch(/## Lighthouse/i);
  expect(readme).toMatch(/lhci autorun/);
});
```

### 구현 항목

**파일**: `tests/components/install-prompt.test.tsx` (기존 `tests/critical-path/install-prompt.test.tsx` 확인 후 보강)
- beforeinstallprompt 이벤트 수신 → 버튼 가시성 회귀 테스트 추가

**파일**: `README.md`
- "## Lighthouse 로컬 측정" 섹션 추가
  - `npx lhci autorun --collect.url=http://localhost:3000/dashboard`
  - PWA category 점수 확인 지침
  - 팬메이드 고지 링크
- CI 미도입 배경 (Cost NFR) 1~2줄 명시

---

## 작업 종속성

### 종속성 그래프
```
Phase 1 ─┬─ 1-1 테스트 ──→ 1-impl (SVG+스크립트+package.json) ─┐
         └─ 1-2 테스트 ──→ 1-impl                               │
                                                                 ▼
Phase 2 ─┬─ 2-1 테스트 ──→ 2-impl (테스트 확장, PNG 커밋) ── (Phase 1 완료 필요)
         ├─ 2-2 테스트 ──→ 2-impl
         └─ 2-3 테스트 ──→ 2-impl
                                                                 ▼
Phase 3 ─┬─ 3-1 테스트 ──→ 3-impl (InstallPrompt 보강)
         └─ 3-2 테스트 ──→ 3-impl (README)                    (Phase 2 완료 필요)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2 테스트 작성 | 없음 | ✅ |
| G2 | 1-impl (SVG 소스 + scripts/generate-icons.ts + package.json) | G1 완료 | - (동일 package.json 수정 집중) |
| G3 | 2-1, 2-2, 2-3 테스트 작성 | G2 완료 | ✅ |
| G4 | 2-impl (pwa-manifest.test.ts 확장 + PNG 산출물 커밋) | G3 완료 | - (동일 파일) |
| G5 | 3-1, 3-2 테스트 작성 | G4 완료 | ✅ |
| G6 | 3-impl (InstallPrompt 테스트 보강 + README 업데이트) | G5 완료 | ✅ (서로 다른 파일) |

### 종속성 판단 기준 적용
- Phase 1 → 2: 2-1/2-2/2-3 은 Phase 1 이 생성한 PNG/favicon 실체가 있어야 통과.
- Phase 2 → 3: 3-1 은 아이콘이 존재해야 InstallPrompt 정상 렌더, 3-2 는 독립적이지만 문서 순서상 뒤로.
- G2/G4 내부 직렬: 같은 `package.json` / `pwa-manifest.test.ts` 수정으로 파일 충돌 방지.
- G6 병렬: `tests/components/install-prompt.test.tsx` vs `README.md` 서로 다른 파일.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | SVG 소스 파일 존재 + safe zone 속성 테스트 | ✅ 완료 | |
| 1-2 | generate-icons 스크립트 실행 결과(파일 + 크기 예산) 테스트 | ✅ 완료 | Performance NFR |
| 1-impl | assets/icons/*.svg + scripts/generate-icons.ts + package.json(scripts, devDeps) | ✅ 완료 | Compliance: Riot 자산 금지 |
| 2-1 | manifest 참조 아이콘 파일 존재 테스트 | ✅ 완료 | |
| 2-2 | PNG 매직넘버 + 선언 크기 검증 테스트 | ✅ 완료 | Security NFR |
| 2-3 | layout.tsx 아이콘 참조 존재 테스트 | ✅ 완료 | |
| 2-impl | pwa-manifest.test.ts 확장 + public/icons/*.png + public/favicon.ico 커밋 | ✅ 완료 | |
| 3-1 | InstallPrompt beforeinstallprompt 회귀 테스트 | ✅ 완료 | AC-5 검증 |
| 3-2 | README Lighthouse 섹션 존재 테스트 | ✅ 완료 | Operability NFR |
| 3-impl | install-prompt.test.tsx 보강 + README.md Lighthouse 섹션 | ✅ 완료 | |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
