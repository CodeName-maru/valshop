# Plan 0009: 스킨 상세 뷰 (크로마 / 고화질 / 영상 링크) — Phase 2

## 개요

PRD FR-9 에 따라 유저가 스킨 카드를 탭하면 라우팅되는 상세 뷰 (`/skin/[uuid]`) 를 구현한다. 페이지는 `valorant-api.com` 의 `chromas`, `levels`, `streamedVideo` 필드를 이용해 고화질 이미지·크로마 색상 옵션을 노출하고, 인게임 영상 링크를 안전한 형태로 렌더한다. Phase 2 범위이며 MVP 의 메타 캐시 (ADR-0003) 와 styling 스택 (ADR-0007), 테스트 스택 (ADR-0006) 을 그대로 재사용한다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 라우트 | `app/(app)/skin/[id]/page.tsx` (App Router dynamic route, RSC) | ARCHITECTURE § 3 폴더 구조 준수, SSR 로 초기 렌더 빠름 (Performance NFR) |
| 데이터 소스 | `valorant-api.com/v1/weapons/skins/{uuid}` 단건 + 전체 카탈로그 (ISR 24h) 재사용 | ADR-0003 메타 캐시 재사용 → 추가 비용 0 (Cost NFR) |
| 메타 fetch 위치 | `lib/valorant-api/catalog.ts` 에 `getSkinDetail(uuid)` 확장. `fetch(..., { next: { revalidate: 86400 } })` | ADR-0003 일관, stale-while-revalidate 장애 내성 (Availability NFR) |
| 크로마 선택 상태 | 클라이언트 컴포넌트 `<ChromaSelector>` (useState) | 단순 UI 상태 → 서버 라운드트립 불필요 (Performance NFR) |
| 고화질 이미지 렌더 | `next/image` + `loading="lazy"` + `sizes` responsive + placeholder blur | Performance NFR (lazy-load), Lighthouse LCP 개선 |
| 영상 링크 렌더 | `streamedVideo` URL 을 `<a target="_blank" rel="noopener noreferrer nofollow">` 외부 링크로만 노출. 임베드 없음 | Security NFR (외부 미디어 XSS/clickjacking 방지), Compliance (라이엇 자원 직접 재송출 회피) |
| URL 검증 | 화이트리스트: `https://` + `youtube.com` / `youtu.be` / `media.valorant-api.com` 만 허용; 그 외는 숨김 | Security NFR |
| 영상 fallback | `streamedVideo` 가 null/missing/비허용 도메인이면 "영상 없음" UI 로 graceful degrade | FR-9 "인게임 영상 링크는 옵션" |
| 데이터 미스 fallback | 카탈로그에 UUID 없으면 `notFound()` (404 page) | Next.js 관용 |
| 스타일 | Tailwind + shadcn/ui `Card`, `Tabs`, `Button` | ADR-0007 일관 |
| 라우팅 계약 (가정) | FR-3 카드가 `<Link href={`/skin/${uuid}`}>` 로 wrap 되어 있음. 실제 wrap 은 본 plan 범위 밖 — FR-3 구현에서 제공 | 가정 명시 (PRD FR-3 ↔ FR-9 연결) |
| 테스트 | Vitest + @testing-library/react (컴포넌트), MSW (valorant-api 모킹) | ADR-0006 |

---

## NFR 반영

PRD § 6 의 8 카테고리 전부를 본 plan 에서 어떻게 보장하는지 명시한다.

| 카테고리 | 반영 방법 | 테스트/측정 |
|---|---|---|
| **Performance** | (1) RSC 로 메타 fetch → 초기 HTML 에 크로마 목록 포함. (2) `next/image` `loading="lazy"` + responsive `sizes` 로 대용량 크로마/레벨 이미지 lazy-load. (3) 첫 번째 크로마 대표 이미지만 priority, 나머지는 lazy. | Test 2-4 (첫 이미지 priority, 나머지 loading="lazy" 속성 assertion). 수동: Chrome DevTools Performance 탭에서 스킨 상세 TTI < 2s (대시보드 대비) 확인. |
| **Scale** | ~50 concurrent 가정. 상세 페이지는 read-only + ISR 캐시 hit 이므로 origin 요청 수렴. 추가 DB 호출 없음. | 측정 불필요 (Vercel 자동 스케일). 테스트 1-impl 에서 `fetch` 가 카탈로그 캐시 호출 1회로 수렴함을 확인. |
| **Availability** | ADR-0003 stale-while-revalidate 로 `valorant-api.com` 장애 중에도 이전 값 제공. 카탈로그 미스 시 404 fallback. | Test 1-3 (카탈로그 미스 시 notFound). |
| **Security** | HTTPS 전용. `streamedVideo` URL 화이트리스트 검증 후에만 렌더. 외부 링크는 `rel="noopener noreferrer nofollow"` + `target="_blank"`. `dangerouslySetInnerHTML` 미사용. 이미지 src 는 `next.config.ts` `remotePatterns` 에 `media.valorant-api.com` 만 허용 (기존 설정 재사용 가정, 없으면 본 plan 에서 추가). | Test 2-5 (허용 도메인 통과), Test 2-6 (비허용 도메인 차단), Test 2-7 (`rel` 속성 assertion). |
| **Compliance** | Riot ToS: 스킨 자산은 valorant-api.com 링크만 사용, 자체 호스팅 금지. fan-made footer 를 layout 에서 상속. | 수동 육안. |
| **Operability** | Vercel 기본 function logs. 에러 경로 (`getSkinDetail` throw) 는 Next.js error boundary → Vercel 로그에 자동 캡처. 별도 로깅 추가 없음. | `app/(app)/skin/[id]/error.tsx` 존재 확인. |
| **Cost** | **$0**. 신규 API/DB/스토리지 없음. valorant-api 메타는 ADR-0003 ISR 24h 캐시에 **적중** → 외부 호출 증가분 0. `next/image` 변환은 Vercel Hobby 무료 쿼터 내. | Test 1-2 (`fetch` 호출이 `revalidate: 86400` 옵션으로 이뤄지는지 assertion → 캐시 재사용 확인). Vercel 대시보드 `Image Optimization` 사용량 주간 체크. |
| **Maintainability** | 뷰 단위 테스트 (@testing-library/react). 크로마 선택 / 영상 fallback / URL 검증 각각 독립 테스트. 포트-어댑터: `getSkinDetail` 는 `fetch` 주입 가능한 모듈 인터페이스. | Phase 2 의 모든 Test 2-N. |

---

## Phase 1: 도메인 타입 + 메타 클라이언트 확장

### 테스트 시나리오

#### Test 1-1: 카탈로그에서 단건 스킨 상세를 가져온다
```ts
// tests/critical-path/skin-detail.test.ts
it("givenValidUuid_whenGetSkinDetail_thenReturnsSkinWithChromasAndLevels", async () => {
  // Given: MSW 가 valorant-api.com/v1/weapons/skins/{uuid} 를 모킹
  //   (chromas 3개, levels 2개, streamedVideo 포함 fixture)
  // When: getSkinDetail(uuid) 호출
  // Then: SkinDetail 타입으로 매핑되어 chromas.length === 3, levels.length === 2,
  //   streamedVideo URL 이 그대로 유지된다
});
```

#### Test 1-2: ISR 캐시 옵션이 ADR-0003 과 동일하다 (Cost NFR)
```ts
it("givenGetSkinDetailCall_whenFetchInvoked_thenUsesRevalidate86400", async () => {
  // Given: fetch spy
  // When: getSkinDetail(uuid)
  // Then: fetch 가 { next: { revalidate: 86400 } } 옵션으로 호출된다
  //   (ADR-0003 메타 캐시 재사용 보장 → 외부 호출 증가 0)
});
```

#### Test 1-3: 존재하지 않는 UUID 에 대해 null 을 반환한다
```ts
it("givenUnknownUuid_whenGetSkinDetail_thenReturnsNull", async () => {
  // Given: MSW 가 404 응답
  // When: getSkinDetail("00000000-…")
  // Then: null 반환 (페이지 레이어에서 notFound() 변환)
});
```

### 구현 항목

**파일**: `lib/domain/skin.ts` (확장)
- `Chroma`, `SkinLevel`, `SkinDetail` 타입 추가
- 필드: `uuid`, `displayName`, `displayIcon`, `chromas: Chroma[]`, `levels: SkinLevel[]`, `streamedVideo?: string | null`, `contentTierUuid?: string`

**파일**: `lib/valorant-api/catalog.ts` (확장)
- `getSkinDetail(uuid: string): Promise<SkinDetail | null>` 추가
- `fetch(`https://valorant-api.com/v1/weapons/skins/${uuid}`, { next: { revalidate: 86400 } })`
- 404 → null, 2xx → 도메인 타입으로 매핑

---

## Phase 2: 상세 페이지 + 크로마 선택 + 영상 링크

### 테스트 시나리오

#### Test 2-1: 페이지가 스킨 이름·대표 이미지·크로마 개수를 렌더한다
```ts
it("givenSkinWithThreeChromas_whenPageRenders_thenShowsNameImageAndThreeChromaOptions", async () => {
  // Given: getSkinDetail 이 3 크로마 스킨을 반환하도록 모킹
  // When: SkinDetailPage({ params: { id: uuid } }) 렌더
  // Then: h1 에 displayName, img 에 displayIcon, 크로마 버튼 3개 노출
});
```

#### Test 2-2: 크로마 버튼 클릭 시 메인 이미지가 해당 크로마로 교체된다
```ts
it("givenChromaSelector_whenUserClicksSecondChroma_thenMainImageSrcChanges", async () => {
  // Given: 렌더 완료된 상세 페이지
  // When: 두번째 크로마 버튼 클릭 (fireEvent.click)
  // Then: <img data-testid="main-skin-image"> 의 src 가 chromas[1].fullRender 로 바뀜
});
```

#### Test 2-3: 크로마가 0/1개면 셀렉터가 숨겨진다
```ts
it("givenSingleChroma_whenPageRenders_thenChromaSelectorIsNotRendered", async () => {
  // Given: chromas.length === 1 인 스킨
  // When: 렌더
  // Then: queryByTestId("chroma-selector") 가 null
});
```

#### Test 2-4: 고화질 이미지가 lazy-load 속성을 갖는다 (Performance NFR)
```ts
it("givenMultipleLevelImages_whenPageRenders_thenNonPrimaryImagesHaveLoadingLazy", async () => {
  // Given: levels.length === 3 인 스킨
  // When: 렌더
  // Then: 메인 이미지는 priority (loading 속성 없음 or "eager"),
  //   나머지 레벨 이미지 <img> 들은 loading="lazy"
});
```

#### Test 2-5: 허용 도메인의 streamedVideo 링크는 안전한 anchor 로 렌더된다 (Security NFR)
```ts
it("givenYoutubeStreamedVideo_whenPageRenders_thenAnchorHasNoopenerNoreferrerAndTargetBlank", async () => {
  // Given: streamedVideo === "https://youtu.be/abc123"
  // When: 렌더
  // Then: a[href="https://youtu.be/abc123"] 존재,
  //   target="_blank", rel 에 "noopener" "noreferrer" "nofollow" 포함
});
```

#### Test 2-6: 허용되지 않은 도메인 / 비HTTPS 는 링크가 렌더되지 않는다 (Security NFR)
```ts
it("givenNonWhitelistedVideoUrl_whenPageRenders_thenVideoLinkIsHiddenAndFallbackShown", async () => {
  // Given: streamedVideo === "http://evil.example.com/x" 또는 "javascript:alert(1)"
  // When: 렌더
  // Then: anchor 미존재, "인게임 영상 없음" fallback 텍스트 노출
});
```

#### Test 2-7: streamedVideo 가 null 이면 fallback 을 보여준다 (FR-9 옵션)
```ts
it("givenNoStreamedVideo_whenPageRenders_thenShowsNoVideoFallback", async () => {
  // Given: streamedVideo === null
  // When: 렌더
  // Then: "인게임 영상 없음" 텍스트, anchor 0개
});
```

#### Test 2-8: 카탈로그에 UUID 없으면 notFound 처리된다
```ts
it("givenUnknownUuid_whenPageRenders_thenThrowsNotFound", async () => {
  // Given: getSkinDetail 이 null 반환
  // When: SkinDetailPage 렌더
  // Then: Next.js notFound 가 throw (NEXT_NOT_FOUND)
});
```

### 구현 항목

**파일**: `lib/security/url.ts` (신규, 작은 유틸)
- `isSafeExternalVideoUrl(url: string | null | undefined): boolean`
  - null/undefined → false
  - `new URL()` 파싱 실패 → false
  - `protocol !== "https:"` → false
  - host 가 `youtube.com` / `www.youtube.com` / `youtu.be` / `media.valorant-api.com` 아니면 false

**파일**: `components/skin-detail/ChromaSelector.tsx` (신규, 클라이언트 컴포넌트)
- `"use client"` 선언
- props: `chromas: Chroma[]`, `onSelect(index)` 또는 내부 useState + 메인 이미지 콜백
- `chromas.length <= 1` 이면 null 반환
- shadcn/ui `Button` + 선택된 항목 aria-pressed

**파일**: `components/skin-detail/VideoLink.tsx` (신규)
- props: `url: string | null | undefined`
- `isSafeExternalVideoUrl` 통과 시에만 `<a target="_blank" rel="noopener noreferrer nofollow">` 렌더
- 그 외 "인게임 영상 없음" fallback span

**파일**: `components/skin-detail/SkinDetailView.tsx` (신규, 클라이언트 컴포넌트)
- 메인 이미지 + `<ChromaSelector>` + `<VideoLink>` + 레벨 이미지 리스트 조립
- 메인 이미지 `next/image` `priority`, 레벨·크로마 프리뷰는 `loading="lazy"`

**파일**: `app/(app)/skin/[id]/page.tsx` (신규, RSC)
- `params.id` 로 `getSkinDetail` 호출
- null 이면 `notFound()`
- `<SkinDetailView skin={skin} />` 렌더

**파일**: `app/(app)/skin/[id]/error.tsx` (신규)
- Next.js error boundary — 에러 시 "상세 정보를 불러올 수 없습니다" + 재시도 버튼

**파일**: `next.config.ts` (확인/수정)
- `images.remotePatterns` 에 `media.valorant-api.com` HTTPS 포함 확인 (MVP 에서 이미 설정되었으면 no-op)

---

## 작업 종속성

### 종속성 그래프
```
Phase 1 ─┬─ 1-1 테스트 ──→ 1-impl (catalog.getSkinDetail) ─┐
         ├─ 1-2 테스트 ──→ 1-impl                           │
         └─ 1-3 테스트 ──→ 1-impl                           │
                                                            ▼
Phase 2 ─┬─ 2-url-test ──→ 2-url-impl (lib/security/url)   (Phase 1 완료 후)
         ├─ 2-1,2-2,2-3 ──→ 2-chroma-impl (ChromaSelector + SkinDetailView)
         ├─ 2-4         ──→ 2-view-impl   (SkinDetailView lazy-load)
         ├─ 2-5,2-6,2-7 ──→ 2-video-impl  (VideoLink)
         └─ 2-8         ──→ 2-page-impl   (page.tsx notFound)
                                                            ▼
                                                      2-config (next.config images)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3 테스트 작성 | 없음 | 가능 |
| G2 | 1-impl (`lib/domain/skin.ts` 타입 확장 + `lib/valorant-api/catalog.ts` getSkinDetail) | G1 완료 | 같은 파일군 — 불가 (순차) |
| G3 | 2-url-test, 2-5/2-6/2-7 비디오 테스트, 2-1/2-2/2-3 크로마 테스트, 2-4 lazy-load 테스트, 2-8 notFound 테스트 (파일 분리) | G2 완료 | 가능 (파일 독립) |
| G4 | 2-url-impl (`lib/security/url.ts`), 2-video-impl (`components/skin-detail/VideoLink.tsx`), 2-chroma-impl (`components/skin-detail/ChromaSelector.tsx`) | G3 완료 | 가능 (파일 독립, VideoLink 는 url util import — 단 G4 내 순서: url → video) |
| G5 | 2-view-impl (`SkinDetailView.tsx`) | G4 완료 | - |
| G6 | 2-page-impl (`app/(app)/skin/[id]/page.tsx`) + 2-error (`error.tsx`) + 2-config (`next.config.ts`) | G5 완료 | 가능 (파일 독립) |

> G4 내부 미시 순서: `url.ts` 먼저 → `VideoLink.tsx` / `ChromaSelector.tsx` 병렬. 이는 `/implement` 가 import 해결 순으로 자연스럽게 처리.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | 카탈로그 단건 조회 성공 테스트 | 완료 | 35 tests 전체 통과 |
| 1-2 | revalidate 86400 옵션 assertion (Cost NFR) | 완료 | ISR 캐시 확인 |
| 1-3 | 404 시 null 반환 테스트 | 완료 | 네트워크 에러 포함 |
| 1-impl | `SkinDetail` 타입 + `getSkinDetail` 구현 | 완료 | `lib/domain/skin.ts`, `lib/valorant-api/catalog.ts` |
| 2-url-test | `isSafeExternalVideoUrl` 단위 테스트 (화이트리스트/비HTTPS/javascript:) | 완료 | 7 tests 통과 |
| 2-url-impl | `lib/security/url.ts` 구현 | 완료 | 화이트리스트 + HTTPS 검증 |
| 2-1 | 이름·이미지·크로마 개수 렌더 | 완료 | `SkinDetailView` 렌더링 확인 |
| 2-2 | 크로마 클릭 시 메인 이미지 교체 | 완료 | useState로 선택 상태 관리 |
| 2-3 | 크로마 1개면 셀렉터 숨김 | 완료 | `chromas.length <= 1` 조건 |
| 2-4 | 레벨 이미지 loading="lazy" assertion | 완료 | 메인은 eager, 레벨은 lazy |
| 2-5 | YouTube 링크 rel/noopener assertion | 완료 | `rel="noopener noreferrer nofollow"` |
| 2-6 | 비허용 도메인/javascript: 차단 | 완료 | 보안 필터 통과 |
| 2-7 | streamedVideo null fallback | 완료 | "인게임 영상 없음" UI |
| 2-8 | 미존재 UUID notFound 테스트 | 완료 | `notFound()` 호출 확인 |
| 2-chroma-impl | `ChromaSelector.tsx` 구현 | 완료 | 클라이언트 컴포넌트 |
| 2-video-impl | `VideoLink.tsx` 구현 | 완료 | 안전한 anchor 렌더링 |
| 2-view-impl | `SkinDetailView.tsx` 조립 (lazy-load 포함) | 완료 | `next/image` 사용 |
| 2-page-impl | `app/(app)/skin/[id]/page.tsx` RSC + notFound | 완료 | 동적 라우트 |
| 2-error | `app/(app)/skin/[id]/error.tsx` | 완료 | 에러 바운더리 |
| 2-config | `next.config.ts` `images.remotePatterns` 확인 | 완료 | `media.valorant-api.com` 추가 |

**상태 범례**: 미착수 | 진행중 | 완료 | 차단됨

---

## 구현 완료 요약

### 생성된 파일
- `lib/domain/skin.ts` - `Chroma`, `SkinLevel`, `SkinDetail` 타입 추가
- `lib/valorant-api/catalog.ts` - `getSkinDetail()` 함수 추가
- `lib/security/url.ts` - `isSafeExternalVideoUrl()` 보안 함수
- `components/skin-detail/ChromaSelector.tsx` - 크로마 선택 UI
- `components/skin-detail/VideoLink.tsx` - 안전한 비디오 링크
- `components/skin-detail/SkinDetailView.tsx` - 메인 상세 뷰
- `app/(app)/skin/[id]/page.tsx` - 동적 라우트 페이지
- `app/(app)/skin/[id]/error.tsx` - 에러 페이지
- `next.config.ts` - 이미지 최적화 설정

### 테스트 파일
- `tests/critical-path/skin-detail.test.ts` - 4 tests (Phase 1)
- `tests/critical-path/url-security.test.ts` - 7 tests
- `tests/components/video-link.test.tsx` - 7 tests
- `tests/components/chroma-selector.test.tsx` - 5 tests
- `tests/components/skin-detail-view.test.tsx` - 6 tests
- `tests/app/skin-detail-page.test.tsx` - 2 tests
- **총 35 tests, 전체 통과**

---

## 가정사항 (Assumptions)

- **FR-3 라우팅 계약**: 대시보드 스킨 카드 (`components/SkinCard.tsx`) 가 `<Link href={`/skin/${uuid}`}>` 로 래핑되어 있거나, FR-3 구현 단계에서 래핑될 예정이라고 가정한다. 본 plan 은 `/skin/[id]` 라우트의 **도착지** 만 책임지며, 카드 측 `Link` 부착은 FR-3 의 작업 범위이다.
- **`next.config.ts` 이미지 호스트**: MVP 에서 `media.valorant-api.com` 이 `remotePatterns` 에 이미 허용되어 있다고 가정. 없으면 2-config 에서 추가.
- **Supabase/Resend 미사용**: 본 기능은 Phase 2 범위이지만 DB·이메일 의존성이 없다. 오직 ISR 캐시된 valorant-api 메타만 사용 → Phase 2 내부에서 가장 먼저 시작해도 무방.
