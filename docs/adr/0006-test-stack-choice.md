# ADR-0006: test-stack-choice

- 작성일: 2026-04-23
- 상태: ACCEPTED
- 연관: [Architecture](../ARCHITECTURE.md#61-테스트-전략-bdd)

## Context

PRD § 6 Maintainability 는 "Critical path 단위 테스트 (로그인 flow + 상점 파싱) + README" 를 요구한다. Architecture § 6.1 은 BDD 하이브리드 전략 (MVP 경량, Phase 2 에 Gherkin) 을 채택했다. 이 전략을 실제로 실현할 러너·도구 조합을 확정해야 한다.

JS 생태계에는 여러 테스트 도구 조합이 존재하며, Spring 의 JUnit + Cucumber-JVM 처럼 표준화된 기본 세트가 없다. 선택 축은 (1) 러너 (Jest vs Vitest), (2) E2E (Playwright vs Cypress), (3) HTTP 모킹 (MSW vs nock), (4) BDD 레이어 (playwright-bdd vs @cucumber/cucumber) 네 가지.

Next.js App Router + TypeScript + Vercel 배포라는 프로젝트 제약 하에서 각 축마다 자연스러운 선택이 다르다. 솔로 개발자 · 3일 데드라인 맥락에서 학습 곡선과 Next.js 공식 지원이 결정적이다.

## Decision

**Vitest + @testing-library/react + next-test-api-route-handler + MSW + Playwright** 조합을 채택한다. Phase 2 에 **playwright-bdd** 를 추가해 Gherkin `.feature` 파일을 지원한다.

- **Vitest**: 러너. Vite 기반이라 Next.js 의 esbuild 계열 번들링과 호환 우수. ESM 기본 지원.
- **@testing-library/react**: 컴포넌트 렌더·조회. React Testing Library 표준.
- **next-test-api-route-handler**: Route Handler (`app/api/*/route.ts`) 를 in-process 로 호출 → HTTP 레이어 포함 컴포넌트 테스트.
- **MSW (Mock Service Worker)**: Riot / valorant-api HTTP 호출을 인터셉트. Unit 테스트에서도 네트워크 호출을 안전하게 차단.
- **Playwright**: E2E. 멀티브라우저 (Chromium, WebKit) 무료 지원. Vercel 공식 예제도 Playwright 기반.
- **playwright-bdd** (P2): Gherkin `.feature` → Playwright 테스트 변환.

## Alternatives Considered

### 러너
- **Option A (선택)**: Vitest. Pros: Vite/Turbopack 과 호환, ESM 기본, watch 모드 빠름, Jest API 호환 (`describe`/`it`/`expect`). Cons: Next.js 공식 가이드는 아직 Jest 언급이 더 많음.
- **Option B**: Jest. Pros: 생태계 방대, Next.js 공식 가이드. Cons: CJS 기본이라 ESM 설정 피곤, Babel/SWC 설정 필요, Next 15+ App Router 와 충돌 리포트 많음 → **기각 이유: ESM 마찰**.

### E2E
- **Option A (선택)**: Playwright. Pros: Vercel 공식 예제, 빠르고 안정적, 병렬 실행, 자동 대기. Cons: 상대적으로 신규.
- **Option B**: Cypress. Pros: 커뮤니티 친숙, 시각 러너 우수. Cons: iframe 기반 아키텍처로 일부 기능 제약, 멀티탭/도메인 테스트 약함 → **기각 이유: Riot auth 리다이렉트 같은 크로스 도메인 흐름에 취약**.

### HTTP 모킹
- **Option A (선택)**: MSW. Pros: Service Worker 수준에서 인터셉트 → 단위/E2E/브라우저 동작 일관, 핸들러 재사용. Cons: 초기 셋업 15 분.
- **Option B**: nock / fetch-mock. Pros: 가볍고 빠름. Cons: fetch 직접 스텁만 가능, 브라우저 사이드 모킹 별도 설정 필요 → **기각 이유: E2E 와 통합성 열위**.

### BDD (Phase 2)
- **Option A (선택)**: playwright-bdd. Pros: Playwright 테스트 그대로 활용, step 재사용 용이. Cons: Playwright 에 종속.
- **Option B**: @cucumber/cucumber + 별도 HTTP 클라이언트. Pros: Spring Cucumber-JVM 과 거의 동일 API. Cons: Playwright 와 별도 파이프라인 → 툴체인 이중화 → **기각 이유: 복잡도 증가**.

## Consequences

- Positive: 하나의 런타임 (Vitest) 에서 unit·component 커버, 하나의 브라우저 도구 (Playwright) 에서 E2E·BDD 커버 → 툴체인 단순. MSW 덕분에 critical-path 테스트가 진짜로 네트워크·DB 없이 돌아감.
- Negative: Jest 생태계 전제의 서드파티 레시피는 재작성 필요. Cucumber-JVM 사용자는 playwright-bdd 문법 재학습.
- Neutral: Vitest + Playwright 는 Vercel 무료 배포 환경과 호환. CI 부재이므로 로컬 실행 전제 (pre-commit husky 가 옵션).
