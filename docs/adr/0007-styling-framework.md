# ADR-0007: styling-framework

- 작성일: 2026-04-23
- 상태: ACCEPTED
- 연관: [PRD](../PRD.md#3-목표--non-goals), [Architecture](../ARCHITECTURE.md#2-컴포넌트)

## Context

PRD § 1 핵심 가치는 "빠른 속도, 깔끔한 UI". PRD § 3 목표는 TTI ≤ 3s. 모바일 Chrome 우선 PWA 이고 타겟은 한국 리전 단일 사용자 + 본인. 3일 데드라인에 실제로 화면이 그려지려면 CSS 프레임워크 선택을 빨리 매듭지어야 한다.

Next.js 는 글로벌 CSS, CSS Modules, Tailwind, styled-components, Emotion, vanilla-extract, Sass 등 모든 방식을 지원한다. 선택 축은 (1) 개발 속도, (2) 번들 사이즈 (TTI 영향), (3) 학습 곡선, (4) 컴포넌트 라이브러리 호환성.

솔로 개발자 · Spring 배경 · 디자인 시스템 부재 상황에서는 **유틸리티 우선 + 사전 제작 컴포넌트** 조합이 가장 빠르다.

## Decision

**Tailwind CSS v3 + shadcn/ui** 를 채택한다. Tailwind 는 App Router 공식 가이드에서 일등 시민이며, shadcn/ui 는 Radix UI 기반 접근성 컴포넌트를 "소스 복사 방식" 으로 가져와 프로젝트에 내재화한다 (npm 의존 아님). 추가로 `lucide-react` 아이콘 세트 사용.

이유:
1. Tailwind 유틸리티 class 는 Bootstrap 의 `d-flex`, `p-3` 류와 패러다임이 닮아 Spring/JSP 전이 개발자에게 낯설지 않음.
2. shadcn/ui 는 "복사 후 수정" 이라 라이브러리 업데이트 종속 없음, 필요한 컴포넌트만 가져오므로 번들 부풀지 않음.
3. Tailwind JIT 로 실제 사용 class 만 CSS 에 포함 → 번들 수 KB 수준 → TTI 목표에 유리.
4. CSS-in-JS 런타임 비용 0. React 19 / Next 15 의 RSC 와도 호환 이슈 없음.

## Alternatives Considered

- **Option A (선택)**: Tailwind CSS + shadcn/ui. Pros: Next.js 공식 추천, 번들 경량, Spring/Bootstrap 유사 패러다임, 접근성 기본 장착. Cons: Tailwind class 가 JSX 를 길어 보이게 함.
- **Option B**: CSS Modules + 직접 디자인. Pros: 표준 CSS 와 가장 가까움, 학습 거의 없음. Cons: 디자인 시스템 부재 상태에서 모든 스타일 직접 작성 → 3일 데드라인 압박, 반응형·접근성 수작업 → **기각 이유: 개발 속도 열위**.
- **Option C**: styled-components / Emotion (CSS-in-JS). Pros: 컴포넌트 단위 캡슐화 직관적. Cons: 런타임 CSS 주입 비용으로 TTI 불리, RSC 에서 주의 필요 (서버 삽입 설정 추가), Next.js 팀이 CSS Modules/Tailwind 쪽으로 기운 흐름 → **기각 이유: Performance NFR 에 미세하게 불리**.
- **Option D**: Material-UI (MUI) / Ant Design. Pros: 풀 컴포넌트 라이브러리 즉시 사용. Cons: 번들 크고 기본 테마 호불호, Tailwind 와 공존 시 이중 스타일 시스템, 디자인 커스터마이징 러닝 → **기각 이유: 번들 무게, 개인 프로젝트에 과함**.

## Consequences

- Positive: 컴포넌트는 shadcn/ui 복사로 수 분에 확보 (Button, Card, Dialog, Toast 등), 디테일은 Tailwind 유틸리티로 즉시 조정, 번들 경량 유지로 TTI 3s 여유.
- Negative: JSX 내 class 속성이 길어지는 가독성 이슈 (특히 스킨 카드 복잡한 레이아웃). `clsx` 또는 `cn()` 헬퍼로 완화 가능. 디자이너가 없어 전반적 비주얼 퀄리티는 shadcn/ui 기본값에 의존.
- Neutral: Tailwind 설정 파일 (`tailwind.config.ts`) 은 한 번 세팅하고 거의 건드리지 않음. shadcn/ui CLI 는 필요한 컴포넌트를 `components/ui/*` 로 떨어뜨리므로 아키텍처 § 3 폴더 구조에 `components/ui/` 가 추가될 수 있다.
