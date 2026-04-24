# ADR-0004: push-worker-vercel-cron-hourly

- 작성일: 2026-04-23
- 상태: SUPERSEDED by ADR-0009 (2026-04-24) — Hobby 가 hourly 를 허용하지 않는 것으로 정책 확인됨
- 연관: [PRD](../PRD.md#3-목표--non-goals), [Architecture](../ARCHITECTURE.md#2-컴포넌트)

## Context

PRD Phase 2 FR-8 은 "위시리스트 스킨이 상점에 뜨면 지정 시간 내 알림 도달" 을 요구한다 (채널 결정은 ADR-0008 에서 이메일로 확정). 초기 목표는 5분이었으나, Vercel Hobby (무료) 플랜의 Cron 최소 간격 제약 (일 제한·시간 단위 스케줄만 허용) 으로 5분 단위 폴링이 불가능함이 Phase 3 elicitation 에서 밝혀졌다.

대안 탐색 결과 무료 티어로 5분 주기를 달성할 수 있는 경로 (GitHub Actions scheduled workflow, Supabase pg_cron, cron-job.org 외부 ping) 들이 존재하나, 각각 Vercel 과 별도 인프라를 도입하는 부담이 있고, 솔로 개발자의 3일 MVP + 여력 시 Phase 2 구조에 맞지 않는다.

PRD 는 본 ADR 확정과 함께 AC-7 을 "1시간 이내" 로 완화 (commit `b064dcb` 참조). 매일 상점 로테이션이 KST 00:00 이므로, 1시간 레이지는 유저 관점에서도 수용 가능 수준 (주된 사용 패턴이 "아침에 확인" 이라면 자정~1시 알림이면 충분).

## Decision

**Vercel Cron Hobby 로 1시간 간격 폴링**을 채택한다. `vercel.json` 에 `crons: [{ path: "/api/cron/check-wishlist", schedule: "0 * * * *" }]` 설정. 외부 cron 서비스 · GitHub Actions · Supabase pg_cron 은 도입하지 않는다.

이유:
1. 추가 인프라 0 (Vercel 내 완결) → $0 목표 유지.
2. PRD AC-7 을 1시간으로 완화한 의사결정과 정합.
3. Phase 2 가 "여력 시" 작업이라 단순함이 완수 확률을 올림.
4. 향후 5분 주기가 정말 필요해지면 Option B (GitHub Actions) 로 이전 가능 — endpoint URL 만 같으면 cron source 교체는 무리 없음.

## Alternatives Considered

- **Option A (선택)**: Vercel Cron Hobby, 1시간 간격. Pros: 단일 플랫폼, 셋업 1 줄, 무료. Cons: 1시간 레이지 (5분 목표 완화 필요).
- **Option B**: GitHub Actions scheduled workflow (`*/5 * * * *`) 가 Vercel endpoint 를 HTTP POST. Pros: 무료, 5분 주기 가능. Cons: GitHub Actions 공용 실행자는 스케줄 정확도 편차 (수 분 지연 흔함), secret 관리가 GitHub 쪽으로 분산, Vercel 로그와 어긋나 디버깅 힘듦 → **기각 이유: 1h 완화로 불필요**.
- **Option C**: Supabase Edge Function + pg_cron. Pros: 무료, DB 트리거와 가까워 락 없이 동작. Cons: Supabase 쪽에 비즈니스 로직 이중화 (Riot API 호출도 거기서), Edge Function 배포 pipeline 별도 필요 → **기각 이유: 추상화 경계 혼란, 학습 곡선**.
- **Option D**: 외부 cron 서비스 (cron-job.org) 가 Vercel endpoint 호출. Pros: 5분 주기 가능, 무료. Cons: 제3자 서비스 의존 추가, endpoint 가 공개되면 남용 위험 (인증 필요), SLA 없음 → **기각 이유: 신뢰성·보안 열위**.

## Consequences

- Positive: Vercel 내 완결로 운영 단순. 무료 유지. 로그가 한 곳에 모임. Phase 2 가 "여력 시" 라는 전제에 부합.
- Negative: 1시간 레이지로 유저 만족도 상한 제한. 야시장 같은 단기 이벤트는 로테이션 종료 직전에 감지 실패 가능. 고가치 알림 기대가 있다면 Option B 로 업그레이드 필요.
- Neutral: Hobby 플랜의 일일 cron 호출 횟수 한도 내에 머무름 (현재 24회/일 << 한도). 상용화 시 Pro 플랜 ($20/월) 이면 분 단위 cron 가능 — 이 시점에 재검토.
