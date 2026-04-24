# Plan 0013: CRON_BUDGET_ADJUST — Vercel Hobby Cron 한도 대응

> MVP 배포 차단 이슈 (2026-04-26). `vercel.json` 의 `schedule: "0 * * * *"` (매시 정각) 은 현재 Vercel Hobby 정책상 **배포 자체가 실패**하는 상태. AC-6 ($0 비용) 과 AC-7 (위시리스트 1시간 이내 알림) 의 충돌을 PRD/ADR 레벨에서 재조정한다.

## 개요

본 plan 의 목적은 **코드 제품 기능 구현이 아니라, PRD/ADR 수정 제안과 `vercel.json` 스케줄 조정** 이다. 구현량은 작지만 상위 문서 의사결정이 선행되어야 한다.

## 외부 조사 결과 (2026-04-24 web search)

| 출처 | 확인 사항 |
|------|-----------|
| Vercel Docs — Cron Jobs Usage & Pricing (`vercel.com/docs/cron-jobs/usage-and-pricing`) | **Hobby 플랜 cron 은 일 1회만 허용**. 분/시간 단위 스케줄은 deploy 실패. |
| Vercel KB — Troubleshooting Cron | `0 * * * *`, `*/30 * * * *` 등 sub-daily 표현은 "Hobby accounts are limited to daily cron jobs" 에러로 배포 자체가 실패. |
| Vercel Changelog (cron 100 개/project) | Cron 개수 한도는 프로젝트당 100 개 (전 플랜) — 개수는 제약 아님. 주파수만 제약. |
| Vercel Hobby 일반 한도 | 스케줄 내 실제 발동 시각은 해당 시간대(hour) 내 임의 시점 (load distribution). 이벤트가 드물게 중복 발동 가능 → 핸들러 idempotent 필요. |

**핵심 오차 요약**: ADR-0004 는 "Hobby Cron = 시간 단위 스케줄만 허용, 일 제한 있음" 으로 기록하나 실제 현행 Hobby 정책은 **일 1회 제약**. ADR-0004 전제 자체가 2026-04 시점에 부정확.

## 설계 결정사항

### 선택지 비교

| 옵션 | 설명 | Cost (NFR) | AC-7 SLA | Security (NFR) | 구현 부담 | 평가 |
|------|------|-----------|----------|----------------|-----------|------|
| (a-1) `0 0 * * *` (매일 KST 00:05 내외) Hobby 준수 | 일 1회만 호출 | $0 유지 | **"24시간 이내"** 로 완화 필요 | 기존 `CRON_SECRET` 유지 | 낮음 | **채택 후보 1** |
| (a-2) 로테이션 직후 1회 — KST 00:05 UTC 15:05 | 상점 로테이션(KST 00:00)에 가장 인접한 1회 | $0 유지 | "로테이션 직후 ≤ 30분" (단, Vercel 은 해당 hour 내 임의 발동 → 실제는 0~59분) | 기존 유지 | 낮음 | **채택** |
| (b) GitHub Actions scheduled workflow `0 * * * *` → Vercel endpoint 호출 | 외부 cron | $0 유지 (Actions free tier) | 1시간 유지 | **엔드포인트 공개 노출 — `CRON_SECRET` 만으로 보호됨. 기존과 동일 수준이지만 공격 표면이 "인증된 Vercel-internal" → "인터넷" 으로 확대** | 중간 (secret 동기화) | ADR-0004 Option B. 1인 유저엔 과투자. |
| (c) 유료(Pro $20/월) 전환 | 분 단위 가능 | **AC-6 위반** | 5분 가능 | 영향 없음 | 없음 | AC-6 명시적 위반, 기각 |
| (d) on-demand lazy 갱신 (앱 오픈 시 서버에서 상점 조회 + 매칭 + 메일) | cron 제거 | $0 유지 | "**앱 오픈 시점**" (알림 선제성 포기) | 기존 유지 | 중간 (라우트/훅 추가) | FR-8 "주기적 폴링" 문구와 불일치. 앱을 거의 안 여는 패턴 → 알림 실질 무력화. 기각 |

### 채택: **(a-2) Hobby 준수 일 1회 cron — KST 로테이션 직후 1회**

- 구체 스케줄: `5 15 * * *` (UTC 15:05 ≈ KST 00:05). Vercel 은 해당 hour 내 임의 발동이므로 실제 발동은 **KST 00:00~00:59 사이**. 상점 로테이션(KST 00:00 정각) 직후 window 에 1회 폴링 → 그날의 위시리스트 매칭 기회를 놓치지 않음.
- **AC-7 을 "1시간 이내" → "로테이션 후 24시간 이내 (실측 대부분 1시간 이내)" 로 완화**. MVP 유저 = 개발자 1인, "아침에 확인" 사용 패턴(PRD § 2) 에 부합.
- 야시장(단기 이벤트) 은 로테이션 이후 변화가 적으므로 일 1회로도 개시일 놓침 없음. 종료 임박 감지는 본 MVP Non-goal 로 간주.

### NFR 근거

- **Cost (핵심 제약)**: AC-6 $0 유지. 유료 전환 없이 Hobby 한도 내 정상 배포 가능.
- **Security**: 외부 cron(b) 미채택 → 엔드포인트가 Vercel-internal cron 에서만 트리거. 공격 표면 최소화. 기존 `CRON_SECRET` 검증 유지.
- **Compliance (Riot ToS)**: 유저당 storefront 호출 일 1회 → 기존 시간당 1회 대비 **훨씬 보수적**. Riot ToS 측면은 순효과.
- **Performance / Scale**: 유저 1~50명 단일 invocation 처리 (기존 plan 0008 Phase 3 로직 재사용). `maxDuration=60s` 내.
- **Availability**: 발동 실패 시 다음 날까지 재시도 없음 → best-effort 99% 유지. 단일 실패가 유저에게 체감되지 않도록 `notifications_sent` idempotent 로직(plan 0008) 재사용. Vercel 중복 발동 시에도 중복 메일 없음.
- **Operability**: `vercel.json` 한 줄 수정 + Vercel dashboard 확인만으로 배포/롤백 (Git push).
- **Maintainability**: 기존 워커/핸들러 코드 무수정. 스케줄 문자열만 변경. 테스트는 스케줄-파서 단위 + 문서 정합 테스트.
- **Cron 스케줄 해석**: Vercel 은 UTC 기준. 표기 명시 필요 (`vercel.json` 주석 불가 → plan/README 에서 매핑 명시).

---

## Phase 1: 문서 수정 제안 (PRD / ADR diff)

본 plan 은 `/implement` 단계에서 다음 diff 를 적용할 것을 제안한다. 본 plan 작성 시점에는 수정하지 않는다 (작업 범위: `docs/plan/` 만).

### PRD.md — AC-7 및 측정 가능 목표 조정

**docs/PRD.md § 3 측정 가능 목표**
```diff
-  - **위시리스트 알림 ≤ 1시간**: 상점 로테이션 후 매칭 스킨 **이메일 알림** 도달까지 (Vercel Hobby Cron 무료 티어 제약 반영)
+  - **위시리스트 알림 ≤ 24시간** (목표: 로테이션 직후 1시간 이내): Vercel Hobby Cron 이 일 1회만 허용하므로 일 단위 폴링을 전제로 함. 발동 시각은 KST 00:00~00:59 window.
```

**docs/PRD.md § 5 FR-8**
```diff
-- FR-8: 시스템은 주기적으로 각 유저의 상점을 폴링하여, 위시리스트 스킨이 감지되면 해당 유저에게 이메일 알림 (Resend) 을 1시간 이내 전달한다.
+- FR-8: 시스템은 상점 로테이션 직후 (KST 00:00~00:59 window) 각 유저의 상점을 1일 1회 폴링하여, 위시리스트 스킨이 감지되면 해당 유저에게 이메일 알림 (Resend) 을 전달한다 (도달 목표: 24시간 이내).
```

**docs/PRD.md § 8 AC-7**
```diff
-- **AC-7**: 위시리스트에 찜한 스킨이 상점 로테이션에 포함되면 1시간 이내 이메일 알림이 수신된다.
+- **AC-7**: 위시리스트에 찜한 스킨이 상점 로테이션에 포함되면 24시간 이내 이메일 알림이 수신된다 (통상 로테이션 직후 1시간 내 도달).
```

**근거 기록 (PRD § 7 제약 또는 § 9 미해결 옆에 짧은 각주 추가 권장)**
```diff
+- **Cron 빈도 제약**: Vercel Hobby 는 일 1회 cron 만 허용(2026-04 시점). AC-7 의 1h → 24h 완화는 AC-6 ($0 비용) 우선 결정의 귀결 — ADR-0009 참조.
```

### ADR-0004 수정 vs ADR-0009 신규

- **권고**: ADR-0004 는 "시간 단위" 전제로 기록돼 있고 그 전제 자체가 현행 정책과 어긋남. 역사적 기록으로 유지하되 상태를 `SUPERSEDED by ADR-0009` 로 변경, 신규 ADR-0009 를 작성.
- 신규 ADR 경로: `docs/adr/0009-cron-daily-hobby-budget.md`

**ADR-0009 초안 (plan 내 인라인 — /implement 에서 실제 파일 생성)**

```markdown
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

- `vercel.json`: `{ path: "/api/cron/check-wishlist", schedule: "5 15 * * *" }` (UTC 15:05 ≈ KST 00:05). Vercel 의 hour-distribution 특성상 실제 발동은 KST 00:00~00:59 범위.
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
- Negative: 로테이션 직후 몇 시간 놓치는 edge case 가능성 (Vercel hour-distribution 으로 실제 발동이 KST 00:59 경일 경우 아침 확인 시점에는 반영됨 → 실질 영향 거의 없음). 야시장 종료 임박 알림 불가 (Non-goal).
- Neutral: `notifications_sent` idempotent 설계 덕분에 Vercel 중복 발동에도 중복 메일 0. 추후 유저 베이스 확대 시 ADR-0009 를 Pro 플랜 또는 Option B 로 재검토.
```

### ADR-0004 수정 제안

```diff
-- 상태: ACCEPTED
+- 상태: SUPERSEDED by ADR-0009 (2026-04-24) — Hobby 가 hourly 를 허용하지 않는 것으로 정책 확인됨
```

### 관련 plan 0008 동기화

plan 0008 은 schedule `0 * * * *` 에 기반한 NFR 설명을 많이 포함한다. 본 plan 채택 시 plan 0008 텍스트 역시 schedule/AC-7 표현이 달라져야 하나, **다른 plan 수정 금지** 규칙(작업 주의사항)에 따라 본 plan 에서 수정하지 않는다. `/implement` 단계에서 plan 0008 의 schedule 문자열, NFR 표의 Compliance 셀, Cost 셀 을 ADR-0009 참조로 업데이트하는 것을 별도 챙김 항목으로 제안.

---

## Phase 2: `vercel.json` 스케줄 수정 & 회귀 가드 테스트

### 테스트 시나리오

#### Test 2-1: `vercel.json` 스케줄이 Hobby 한도 준수 (일 1회)
```ts
describe("Feature: vercel.json cron schedule — Hobby budget", () => {
  describe("Scenario: schedule 파싱", () => {
    it("given vercel.json, when crons[0].schedule 읽기, then 일 1회 cron 표현이어야", () => {
      // Given
      const config = JSON.parse(readFileSync("vercel.json", "utf8"));
      const schedule = config.crons[0].schedule;
      // When
      const fields = schedule.trim().split(/\s+/);
      // Then: 5-field cron, minute/hour 고정(숫자), day-of-month/month/day-of-week = "*"
      expect(fields).toHaveLength(5);
      const [min, hour, dom, mon, dow] = fields;
      expect(min).toMatch(/^\d+$/);
      expect(hour).toMatch(/^\d+$/);
      expect(dom).toBe("*");
      expect(mon).toBe("*");
      expect(dow).toBe("*");
    });
  });
});
```

#### Test 2-2: 스케줄이 KST 로테이션 window 내 발동
```ts
it("given UTC schedule, when KST 변환, then 00:00~00:59 범위", () => {
  // Given
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  const [min, hour] = config.crons[0].schedule.split(/\s+/);
  // When
  const utcHour = Number(hour);
  const kstHour = (utcHour + 9) % 24;
  // Then
  expect(kstHour).toBe(0); // 로테이션 직후 hour
  expect(Number(min)).toBeGreaterThanOrEqual(0);
  expect(Number(min)).toBeLessThanOrEqual(30); // 로테이션 후 30분 이내 권장
});
```

#### Test 2-3: 경로 보존
```ts
it("given vercel.json, when crons[0].path 읽기, then 기존 엔드포인트 유지", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  expect(config.crons[0].path).toBe("/api/cron/check-wishlist");
});
```

#### Test 2-4: 핸들러 idempotency 회귀 (Vercel 중복 발동 대응)
```ts
// 기존 plan 0008 Test 3-3 (같은 로테이션 중복 발송 방지) 가 이를 커버.
// 본 plan 에서는 "ADR-0009 Consequences 에서 idempotency 에 의존한다" 는 사실을
// 테스트 파일의 describe 블록 주석으로 명시해 회귀 시 링크가 끊기지 않게 한다.
it("given 같은 invocation 2회, when runWorker 2회, then resend.send 호출 1회 (idempotent)", async () => {
  // Given: plan 0008 Test 3-3 과 동일 fixture
  // When/Then: 재사용 — 본 테스트는 cross-plan 링크 주석만 추가
});
```

### 구현 항목

**파일**: `vercel.json`
```diff
   "crons": [
     {
       "path": "/api/cron/check-wishlist",
-      "schedule": "0 * * * *"
+      "schedule": "5 15 * * *"
     }
   ]
```
- 주석: JSON 은 주석 불가. `README.md` Phase 2 섹션 또는 `docs/adr/0009-*.md` 에 "UTC 15:05 = KST 00:05, Vercel hour-distribution 으로 실제 발동은 KST 00:00~00:59 window" 명시.

**파일**: `tests/critical-path/vercel-cron-schedule.test.ts` (신규)
- Test 2-1, 2-2, 2-3 수용.
- Test 2-4 는 plan 0008 의 `tests/critical-path/worker-check-wishlist.test.ts` 에 cross-reference 주석만 추가 (파일 자체 수정은 `/implement` 에서 검토 — plan 0008 결과물과 충돌 없는지 확인 후 최소 수정).

**파일**: `README.md` (기존, Phase 2 섹션 업데이트)
- Cron 스케줄을 `5 15 * * *` 로 기재 + "UTC 15:05 = KST 00:05, 실제 발동 KST 00:00~00:59" 설명 추가.
- 롤백 절차: `vercel.json` 의 `crons` 배열을 `[]` 로 비우고 push 하면 즉시 정지.
- 수동 실행은 기존 `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/check-wishlist` 유지 (schedule 무관).

---

## NFR 반영

| 카테고리 | 실현 방법 | 측정 / 테스트 |
|---|---|---|
| **Performance** (TTI ≤ 3s, API p95 ≤ 1s) | Cron 주기 변경은 사용자 대면 latency 에 무영향. 워커 실행 시간 예산은 plan 0008 로직 재사용(`maxDuration=60s`). | plan 0008 Test 4-1 재사용 |
| **Scale** (~50 concurrent, ~1000 wishlist rows) | 일 1회 단일 invocation 으로 전체 유저 처리. 현재 유저 1명 → 여유. 50명 상한 시에도 plan 0008 분석대로 60s 내. | plan 0008 Test 4-1 재사용 |
| **Availability** (99% best-effort) | 일 1회 발동 실패 시 다음 날까지 공백. Vercel 중복 발동에는 `notifications_sent` idempotency 로 안전. 유지보수 윈도우 자유는 유지. | Test 2-4 (idempotency 회귀) |
| **Security** (CRON_SECRET, RSO 암호화) | 기존 `CRON_SECRET` Bearer 검증 변경 없음. **외부 cron(GitHub Actions) 미도입으로 공개 엔드포인트 남용 리스크 추가 없음**. `TOKEN_ENC_KEY` / Supabase service role 키 영향 없음. | 기존 plan 0008 Test 3-1 재사용 |
| **Compliance** (Riot ToS, 팬메이드 고지) | 유저당 storefront 호출 **시간당 1회 → 일 1회** 로 감소 → ToS 보수성 증가. 푸터 고지 영향 없음. | plan 0008 Test 4-2 (호출 수 ≤1/유저) 재사용 |
| **Operability** (Vercel logs, Git push 배포) | `vercel.json` 한 줄 변경 + push. Vercel dashboard 에서 "Crons" 탭으로 다음 실행 시각 확인 가능. 로그는 기존 function logs 그대로. | 배포 후 dashboard 확인, 수동 `curl` 실행 smoke test |
| **Cost** ($0 — 본 plan 핵심 목적) | Hobby 일 1회 한도 준수 → 배포 성공 + $0 유지. 유료 전환 회피. Resend 발송량은 이미 free 3000통/월 대비 현격히 적음. Supabase free tier 내. | Vercel usage dashboard, Supabase usage dashboard, AC-6 수락 기준 |
| **Maintainability** (Critical path 단위 테스트) | `vercel.json` 회귀 가드 테스트 추가로 schedule drift 방지. ADR-0009 가 의사결정 맥락을 장기 보존. | Test 2-1 ~ 2-3, ADR-0009 문서 |

---

## PRD / ADR Diff 요약 (재확인용)

1. **PRD.md § 3**: 측정 가능 목표 "1시간" → "24시간 (목표 1시간 이내)"
2. **PRD.md § 5 FR-8**: 주기 표현 조정 + KST 00:00~00:59 window 명시
3. **PRD.md § 8 AC-7**: 1시간 → 24시간
4. **PRD.md § 7 또는 § 9**: Cron 제약 각주 추가 (ADR-0009 링크)
5. **ADR-0004**: 상태 SUPERSEDED by ADR-0009
6. **ADR-0009**: 신규 생성 (본 plan 내 초안 참조)
7. **vercel.json**: `schedule` `"0 * * * *"` → `"5 15 * * *"`
8. **README.md**: Phase 2 Cron 섹션 schedule/타임존 설명 업데이트
9. **plan 0008**: schedule 문자열 및 Compliance 셀 "시간당 1회" → "일 1회" 참조 업데이트 (별도 후속 작업)

---

## 가정사항

1. **Vercel Hobby 정책은 2026-04-24 web search 확인 기준**. `/implement` 시 재확인 권장. 만약 Vercel 이 Hobby 에 sub-daily cron 을 재허용했다면 plan 재평가.
2. **KST 로테이션 시각은 00:00**. 이미 현 코드가 이 가정에 맞춰 `rotation_date` 를 계산(plan 0008 `notifications-repo.ts`). 본 plan 은 기존 KST 기준 헬퍼 재사용.
3. **Vercel hour-distribution** 은 해당 hour 내 임의 발동 — 최악 59분 지연. 사용자 패턴(아침 확인) 상 허용 가능.
4. **유저 1인 (PRD § 2 Secondary: 없음)** 전제. 유저 베이스가 실제로 커질 경우 ADR-0009 Consequences 의 재검토 트리거 발동.
5. **plan 0008 은 이미 배포 전 상태** — schedule 문자열을 바꿔도 기존 구현 코드/테스트는 의미론적으로 그대로 통과 (스케줄은 Vercel 설정이지 worker 로직이 아님).
6. **ADR 번호 0009** 가 아직 비어있음 확인됨 (`docs/adr/0001~0008` 존재, 0009 없음).
7. Vercel 의 `maxDuration=60s` Hobby 한도는 본 plan 에서 변경 없음.
8. Resend 무료 티어(3000통/월)는 일 1회 × 유저 1명 × 매칭 스킨 수 기준 여유 압도적.

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (문서 수정 제안 — 본 plan 채택 후 /implement 에서 수행)
  1-PRD-diff ──┐
  1-ADR-0004-supersede ──┼──► Phase 2 (코드 변경)
  1-ADR-0009-new ────────┘
                            │
                            ▼
Phase 2
  2-1 test (schedule 형식) ──┐
  2-2 test (KST window)      ├──► 2-impl (vercel.json schedule 변경)
  2-3 test (path 보존)       │
  2-4 test (idempotency ref) ─┘
                            │
                            ▼
                        2-readme (README Phase 2 업데이트)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | PRD.md § 3 / § 5 / § 8 / (§ 7 or § 9) 수정 | 없음 | ✅ 같은 파일이나 서로 다른 섹션 (순차 권장) |
| G2 | ADR-0004 상태 변경, ADR-0009 신규 작성 | G1 | ✅ (독립 파일) |
| G3 | Test 2-1 ~ 2-3 (신규 파일 `tests/critical-path/vercel-cron-schedule.test.ts`) | G1/G2 무관 (코드만 의존) | ✅ 한 파일 내 describe 블록 — 사실상 단일 작업 |
| G4 | Test 2-4 cross-reference 주석 (plan 0008 테스트 파일) | G3 | ❌ plan 0008 결과물과 충돌 확인 후 최소 수정 |
| G5 | `vercel.json` schedule 수정 | G3 | - |
| G6 | README.md Phase 2 업데이트 | G5 | - |

### 종속성 판단 기준

- **종속**: vercel.json 수정(G5)은 회귀 가드 테스트(G3)가 먼저 red → green 으로 확인된 뒤에 진행 (TDD).
- **독립**: PRD diff 와 ADR-0009 작성은 코드 변경과 독립 병렬 가능하나, ADR 이 vercel.json 변경의 근거 문서이므로 커밋 순서상 ADR → code 권장.
- **외부 종속**: 실제 `vercel deploy` 확인은 배포 환경 접근 필요 — 로컬 테스트로는 schedule 문자열 검증까지만 가능. 프로덕션 배포 smoke 는 수동.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-PRD | PRD.md § 3/§ 5/§ 8/§ 9 diff 적용 | ✅ 완료 | /implement |
| 1-ADR-0004 | ADR-0004 상태 SUPERSEDED 로 변경 | ✅ 완료 | /implement |
| 1-ADR-0009 | ADR-0009 신규 작성 (본 plan 초안 사용) | ✅ 완료 | /implement |
| 2-1 | vercel-cron-schedule.test.ts — 형식 테스트 | ✅ 완료 | |
| 2-2 | vercel-cron-schedule.test.ts — KST window 테스트 | ✅ 완료 | |
| 2-3 | vercel-cron-schedule.test.ts — path 보존 테스트 | ✅ 완료 | |
| 2-4 | worker-check-wishlist.test.ts idempotency cross-ref 주석 | ✅ 완료 | plan 0008 파일 — 주석만 추가 |
| 2-impl | vercel.json schedule `5 15 * * *` 로 변경 | ✅ 완료 | vercel-config.test.ts 동기 업데이트 |
| 2-readme | README.md Phase 2 Cron 섹션 업데이트 | ✅ 완료 | |
| 3-followup | plan 0008 schedule/NFR 셀 ADR-0009 참조로 업데이트 (별도 후속) | ⬜ 미착수 | 본 plan 범위 외, 챙김 |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
