# ADR-0003: meta-catalog-isr-caching

- 작성일: 2026-04-23
- 상태: ACCEPTED
- 연관: [PRD](../PRD.md#3-목표--non-goals), [Architecture](../ARCHITECTURE.md#2-컴포넌트)

## Context

Riot 의 storefront 응답은 스킨 UUID 4개와 가격만 주고, 유저가 실제로 보는 정보 (스킨 이름, 이미지, 티어 아이콘) 는 `valorant-api.com/v1/weapons/skins` 에서 별도로 조회해야 한다. 이 카탈로그는 전체 응답이 수 MB 규모이며, 실제 업데이트는 신규 스킨 패치 (대략 2-3주에 1회) 때만 일어난다.

PRD § 3 측정 가능 목표: TTI ≤ 3초, API p95 ≤ 1초, 월 비용 $0. 매 요청마다 수 MB 카탈로그를 외부에서 fetch 하면 TTI 목표 달성이 어렵고, valorant-api.com 순간 장애 시 대시보드 전체가 깨진다.

## Decision

**Next.js ISR (Incremental Static Regeneration) 로 카탈로그를 24시간 캐시**한다. `lib/valorant-api/catalog.ts` 내부 `fetch("...skins", { next: { revalidate: 86400 } })` 를 사용. 스킨 패치 주기 (2-3주) 대비 24h 는 충분히 신선하며, 캐시 미스 시 다음 요청까지 stale-while-revalidate 로 즉시 응답한다.

이유:
1. Vercel 이 자체적으로 엣지 노드에 캐시 분산 → 추가 인프라 0.
2. stale-while-revalidate 동작으로 valorant-api 장애 중에도 이전 값 제공 → Availability 보강.
3. 코드 변경 없이 단순 `revalidate` 값만으로 구성 — Spring 의 `@Cacheable(ttl=86400)` 과 동등.

## Alternatives Considered

- **Option A (선택)**: Next.js ISR fetch 캐시 (`revalidate: 86400`). Pros: 셋업 0, Vercel 기본 기능, stale-while-revalidate 자동, 비용 $0. Cons: Vercel 에 묶임 (다른 플랫폼으로 마이그레이션 시 캐시 레이어 재작성).
- **Option B**: Vercel Edge Config / Upstash Redis. Pros: 더 세밀한 TTL·무효화 제어. Cons: 별도 서비스 추가 (무료 티어 있으나 관리 부담), 이 규모에 과함 → **기각 이유: 오버엔지니어링, $0 목표 유지에 부담**.
- **Option C**: 클라이언트가 직접 valorant-api 에 fetch. Pros: 서버 부담 0. Cons: 매 유저·매 요청 수 MB 전송 → TTI 목표 위배, CORS 이슈 가능, 장애 내성 없음 → **기각 이유: Performance NFR 미달**.
- **Option D**: 빌드 타임에 카탈로그 snapshot 을 레포에 커밋. Pros: 런타임 fetch 0, 완전한 장애 내성. Cons: 신규 스킨 반영 시마다 재빌드·재배포 필요, 데이터 신선도 문제 → **기각 이유: 운영 부담, Non-goal (자동화)**.

## Consequences

- Positive: TTI ≤ 3s 달성 여유 확보. valorant-api 장애에도 대시보드 동작. 추가 비용·인프라 0.
- Negative: 신규 스킨 패치 후 최대 24h 동안 옛 메타 표시 가능 (실사용 영향 미미). Vercel 플랫폼 lock-in (캐시 계층 한정).
- Neutral: 카탈로그 크기가 커지면 Vercel 의 fetch 캐시 한도 (50MB/entry, 2GB/deployment) 에 근접할 수 있음. 현재 규모는 여유.
