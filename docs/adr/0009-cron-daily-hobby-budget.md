# ADR-0009: cron-daily-hobby-budget

- 작성일: 2026-04-24
- 상태: ACCEPTED (Supersedes ADR-0004)
- 연관: PRD § 3 측정 가능 목표, PRD § 8 AC-6/AC-7, ADR-0004, ADR-0008

## Context

ADR-0004 는 "Vercel Hobby Cron 이 시간 단위 스케줄을 허용한다" 는 전제로 `0 * * * *` 를 채택했다. 2026-04 현재 Vercel Hobby 플랜 공식 문서는 cron 주기를 **일 1회** 로 제한하며, sub-daily 표현은 deploy 실패를 유발한다. 즉 ADR-0004 의 전제가 더 이상 유효하지 않고 `vercel.json` 현 상태(`0 * * * *`) 는 Production 배포가 불가능하다.

PRD § 6 Cost NFR 은 $0/월을 강한 제약으로 명시하며 AC-6 으로 수락 기준화돼 있다. 유료 플랜(Pro $20/월) 은 AC-6 직접 위반이므로 배제된다. 따라서 AC-7 (알림 1시간 이내) 을 완화하여 Hobby 일 1회 cron 내에 수용해야 한다.

사용자 패턴: PRD § 2 상 Primary = 개발자 본인 1인, "아침에 확인" 습관. 상점 로테이션이 KST 00:00 에 발생하므로 그 직후 1회 폴링이면 유저가 아침에 확인할 때 알림이 도착해 있다.

## Decision

**Hobby 일 1회 Cron 을 채택**한다.

- `vercel.json`: `{ path: "/api/cron/check-wishlist", schedule: "5 15 * * *" }` (UTC 15:05 ≈ KST 00:05). Vercel cron 정확도에 대한 공식 SLA 는 문서화되어 있지 않으므로 **기대 발동은 KST 00:05, 최악의 경우 해당 hour 내 (KST 00:00~00:59) 또는 다음 hour 초까지 지연 가능** 으로 간주한다 (출처: Vercel Docs — Cron Jobs "usage and limits", 2026-04 확인).
- 외부 cron 서비스 / GitHub Actions / Supabase pg_cron / 유료 전환은 도입하지 않는다.
- AC-7 을 "24시간 이내 (통상 로테이션 직후 1시간 내)" 로 완화한다. PRD 동반 수정(본 plan § Phase 1 diff 참조).

근거:
1. Cost NFR 강한 제약($0) 준수 — AC-6 유지.
2. Security NFR — 외부 cron 미도입으로 엔드포인트 공개 노출 회피.
3. Compliance — Riot 상점 호출이 유저당 일 1회로 더 보수적.
4. 사용자 1인 패턴에 비즈니스 임팩트 미미.
5. 운영/디버깅 단순성 (단일 플랫폼 로그).

## Alternatives Considered

- **Hourly `0 * * * *` (기존 ADR-0004)**: Hobby 에서 deploy 실패 → 채택 불가.
- **GitHub Actions `0 * * * *` → Vercel endpoint**: 5분~1시간 주기 가능. 엔드포인트 공개 노출(CRON_SECRET 로 보호되나 공격 표면 증가), secret 이원화. **기각 이유: 유저 1인에 과투자, Security 공격 표면 증가.**
- **유료 전환 Pro $20/월**: 분 단위 가능. **기각 이유: AC-6 $0 직접 위반.**
- **On-demand lazy refresh (앱 오픈 트리거)**: cron 제거, 유저가 앱 열 때 갱신+알림. **기각 이유: FR-8 "주기적" 의도와 상반, 앱 오픈이 드물면 알림 실질 무력화.**
- **일 2회 (`0 0,12 * * *`)**: 여전히 Hobby 범위 **밖** (sub-daily). 기각.

## Consequences

- Positive: $0 유지, 배포 복구, Security/Compliance 개선 (Riot 호출 감소).
- Negative: 공식 SLA 부재로 발동이 KST 00:59 경 또는 드물게 다음 hour 로 지연될 수 있음. 유저 "아침에 확인" 패턴 (PRD § 2) 상 실질 영향 거의 없음. 야시장 종료 임박 알림 불가 (Non-goal).
- Neutral: `notifications_sent` idempotent 설계 덕분에 Vercel 중복 발동에도 중복 메일 0. 추후 유저 베이스 확대 시 ADR-0009 를 Pro 플랜 또는 Option B 로 재검토.
