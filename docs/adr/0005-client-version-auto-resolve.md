# ADR-0005: client-version-auto-resolve

- 작성일: 2026-04-23
- 상태: ACCEPTED
- 연관: [Architecture](../ARCHITECTURE.md#2-컴포넌트)

## Context

Riot 의 storefront 엔드포인트는 HTTP 요청 헤더에 현재 게임 클라이언트 버전 (`X-Riot-ClientVersion`, 예: `release-08.11-shipping-6-3154137`) 을 요구한다. 이 값이 틀리면 Riot 서버가 **400 Bad Request** 또는 오래된 버전 관련 에러를 돌려주며, 발로란트는 2주마다 패치가 있어 버전 문자열이 주기적으로 바뀐다.

따라서 앱은 "현재 게임 버전" 을 어떤 방식으로든 알아내서 헤더에 주입해야 한다. 선택지는 (1) 하드코딩 + 패치마다 수동 갱신, (2) 외부 API 에서 주기 조회, (3) 유저 본인이 클라이언트에서 추출한 값을 입력 등이 있다.

`valorant-api.com/v1/version` 은 커뮤니티 유지 중인 엔드포인트로 최신 `riotClientVersion` 을 반환한다. 이미 ADR-0003 에서 valorant-api 를 의존성으로 받아들였으므로 추가 의존 증가 없음.

## Decision

**`valorant-api.com/v1/version` 을 Next.js ISR (`revalidate: 3600`) 로 주기 조회**하여 Store Proxy 헤더에 주입한다. `lib/riot/version.ts` 에 구현. 1시간 주기는 발로란트 패치 공지 → 실제 클라이언트 롤아웃 사이의 지연 (보통 수 시간) 과 정합.

이유:
1. 수동 갱신을 사람 개입 없이 자동화 → 솔로 개발자 유지보수 부담 제거.
2. 이미 있는 의존 (valorant-api) 재활용, 신규 외부 의존 0.
3. ADR-0003 의 ISR 패턴과 동일 메커니즘 → 구현·운영 경로 일관.
4. 1h TTL 은 패치 당일 수 시간 내 자동 반영 달성.

## Alternatives Considered

- **Option A (선택)**: valorant-api `/v1/version` ISR 1h 캐시 + 자동 주입. Pros: 완전 자동, 추가 의존 0, ADR-0003 과 일관. Cons: valorant-api 가 버전 추적을 놓치면 앱도 실패 (의존 신뢰성 = catalog 와 동일).
- **Option B**: 버전 문자열을 코드/환경변수에 하드코딩, 패치마다 수동 배포. Pros: 런타임 외부 조회 0. Cons: 격주마다 배포 의무 발생, 휴가·바쁜 시기에 앱 전체 깨짐, 개인 프로젝트의 유지 리듬과 불일치 → **기각 이유: Maintainability 치명적**.
- **Option C**: Riot `/v1/version` 등 공식 엔드포인트 사용. Pros: 공식 출처. Cons: 발로란트 클라이언트 버전을 공식으로 공개하는 엔드포인트 없음, League Valorant API 에는 해당 필드 부재 → **기각 이유: 기술적으로 불가능**.
- **Option D**: 유저 input 필드에 본인 클라이언트 버전 기입. Pros: 외부 의존 0. Cons: UX 최악, 패치마다 유저가 귀찮아함, 개인용 앱이라도 본인조차 안 쓸 설계 → **기각 이유: PRD § 3 "가볍고 빠른" 경험 위배**.

## Consequences

- Positive: 패치 당일 자동 반영 (최대 1h 지연). 수동 배포 의무 제거. Store API 400 에러 거의 소멸.
- Negative: valorant-api 가 버전 추적을 중단하면 즉시 영향 (추적 지연도 동일). 이 리스크는 catalog 의존과 함께 묶여 있어 피할 수 없음.
- Neutral: ISR 캐시는 Vercel 전역이라 롤아웃 타이밍이 엣지 노드별로 ±수분 편차 가능.
