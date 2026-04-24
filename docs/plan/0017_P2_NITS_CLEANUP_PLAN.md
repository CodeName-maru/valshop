# Plan 0017: P2 Nits Cleanup

## 개요

이전 리뷰에서 P2(품질/일관성)로 분류된 4가지 nits — (1) `defaultRiotFetcher` 네이밍, (2) `user_tokens.updated_at` 트리거 누락, (3) Countdown `onComplete` 콜백 누락, (4) wishlist 인덱스 중복 — 를 단일 plan/PR 로 묶어 정리한다. 4개 항목은 서로 독립적이지만 모두 작은 정정이라 묶음 처리가 효율적이며, 각 항목은 본 plan 내 독립 섹션·독립 테스트·독립 검증 절차를 갖는다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 1. `defaultRiotFetcher` 새 이름 | `httpRiotFetcher` 로 변경 (가정사항) | 의미: "기본" 이라는 모호한 한정사 대신 "HTTP 어댑터" 라는 역할을 명시. 향후 `mockRiotFetcher`, `cachingRiotFetcher` 등과 대등 위치. **NFR: Maintainability** |
| 1. 호출처 일괄 리네임 범위 | `lib/riot/fetcher.ts` 의 `export` 만 변경하고, 직접 import 한 `lib/auth/callback.ts` 만 수정 (현재 prod 호출처 1곳뿐) | grep 결과 prod 코드 호출처는 callback.ts 1개 파일. 워크트리/테스트 영향 없음. |
| 1. 하위호환 alias 유지 여부 | **유지하지 않음** (`export const defaultRiotFetcher = httpRiotFetcher` 같은 alias 미생성) | 호출처가 1곳이고 단일 PR 로 정리되므로 deprecated alias 는 잡음. **NFR: Maintainability** |
| 2. `updated_at` 트리거 구현 | Supabase 표준 확장 `moddatetime` 을 사용 (`create extension if not exists moddatetime`) | Postgres 표준 + Supabase 공식 권장. 직접 `plpgsql` 함수 작성보다 선언적이고 테스트 단순. **NFR: Operability** |
| 2. 트리거 마이그레이션 파일 | 신규 `supabase/migrations/0007_user_tokens_updated_at_trigger.sql` 생성 (기존 `0001_user_tokens.sql` 미수정) | Migration immutability — 적용된 마이그레이션을 사후 수정하면 환경 간 drift 발생. **NFR: Operability** |
| 3. Countdown `onComplete` API | `onComplete?: () => void` prop 추가, `remaining === 0` 도달 시 **정확히 1회**만 호출 (ref 가드) | 중복 호출 방지가 핵심 요구. React strict-mode + 500ms tick 환경에서 idempotent 보장 필요. **NFR: Maintainability** |
| 3. KST midnight 모드의 `onComplete` 동작 | `endsAtEpochMs` 미지정 (KST midnight 모드) 인 경우 `onComplete` 미지원 (호출 안 함) | midnight 모드는 자정 통과 후 자동으로 다음 자정을 카운트하므로 "완료" 개념이 없음. 콜백은 명시적 endsAt 모드 한정. **NFR: Maintainability** |
| 4. wishlist 중복 인덱스 처리 | `idx_wishlist_user(user_id)` 는 PK `(user_id, skin_uuid)` 의 **leftmost prefix** 와 동일 → 중복으로 판단, drop | Postgres B-tree 는 multi-column PK 의 좌측 prefix 만으로도 single-column lookup 가능. 중복 인덱스는 write amplification + 저장 공간 낭비. **NFR: Operability, Maintainability** |
| 4. drop 마이그레이션 파일 | 신규 `supabase/migrations/0008_drop_wishlist_dup_index.sql` 생성 | Migration immutability 동일 근거. |

### 가정사항

- A1. `defaultRiotFetcher` 의 새 이름은 사용자에게 묻지 않고 `httpRiotFetcher` 로 결정한다 (실행 규칙 #2).
- A2. `moddatetime` extension 은 Supabase 프로젝트에서 사용 가능 (Supabase 의 표준 확장 목록 포함).
- A3. wishlist 테이블의 모든 조회 쿼리는 `user_id` 단독 또는 `(user_id, skin_uuid)` 패턴이며, `skin_uuid` 단독 조회는 없다 (현 코드 기준 검증 후 진행).
- A4. Countdown 의 기존 호출처는 `onComplete` 를 사용하지 않으므로 prop 추가는 backward-compatible.

---

## Phase 1: defaultRiotFetcher → httpRiotFetcher 리네임

### 테스트 시나리오

#### Test 1-1: import 경로 회귀 테스트
```ts
// tests/critical-path/riot-fetcher-export.test.ts
import { describe, it, expect } from "vitest";
import * as fetcherModule from "@/lib/riot/fetcher";

describe("Feature: RiotFetcher export 네이밍", () => {
  it("given_fetcher_module_when_import_then_httpRiotFetcher_export_존재", () => {
    // Given/When
    const exported = fetcherModule;
    // Then
    expect(exported.httpRiotFetcher).toBeDefined();
    expect(typeof exported.httpRiotFetcher.get).toBe("function");
    expect(exported.httpRiotFetcher.fetch).toBeTypeOf("function");
  });

  it("given_fetcher_module_when_import_then_defaultRiotFetcher_제거됨", () => {
    // Given/When
    const exported = fetcherModule as Record<string, unknown>;
    // Then
    expect(exported.defaultRiotFetcher).toBeUndefined();
  });
});
```

#### Test 1-2: 콜백 라우트 통합 회귀
```ts
// 기존 tests/critical-path/auth-callback*.test.ts 가 import 경로 변경 후에도 그대로 통과해야 함 (smoke).
it("given_콜백_핸들러_when_정상_토큰_then_session_쿠키_세팅", async () => {
  // Given: handleAuthCallback 이 httpRiotFetcher 를 내부적으로 사용
  // When: 정상 입력으로 호출
  // Then: 302 redirect /dashboard + Set-Cookie session
});
```

### 구현 항목

**파일**: `lib/riot/fetcher.ts`
- `export const defaultRiotFetcher` → `export const httpRiotFetcher` 로 식별자 변경
- 주석 갱신: "Default RiotFetcher implementation" → "HTTP-based RiotFetcher implementation"

**파일**: `lib/auth/callback.ts`
- `import { defaultRiotFetcher } from "@/lib/riot/fetcher"` → `import { httpRiotFetcher } from "@/lib/riot/fetcher"`
- 본문 사용처 2곳(`exchangeAccessTokenForEntitlements`, `fetchPuuid`) 모두 `httpRiotFetcher` 로 치환

**파일**: `tests/critical-path/riot-fetcher-export.test.ts` (신규)
- 위 Test 1-1 을 작성

---

## Phase 2: user_tokens.updated_at 자동 갱신 트리거

### 테스트 시나리오

#### Test 2-1: UPDATE 시 updated_at 자동 갱신
```sql
-- supabase/tests/0005_user_tokens_updated_at.test.sql (psql 또는 vitest pg-mem 으로 검증)
-- Given: 행 1건 insert, updated_at = T0
-- When: SQL UPDATE user_tokens SET access_token_enc = '...' WHERE user_id = X;
-- Then: updated_at > T0 (트리거가 now() 로 갱신)
```

```ts
// tests/critical-path/user-tokens-updated-at.test.ts (Supabase admin client 또는 통합 테스트)
it("given_user_tokens_행_when_업데이트_then_updated_at_자동_갱신", async () => {
  // Given: insert 후 updated_at 캡처
  const { data: before } = await supabase.from("user_tokens").insert({...}).select().single();
  // When: 임의 컬럼 update
  await new Promise((r) => setTimeout(r, 10));
  const { data: after } = await supabase
    .from("user_tokens")
    .update({ access_token_enc: Buffer.from("new") })
    .eq("user_id", before.user_id)
    .select()
    .single();
  // Then
  expect(new Date(after.updated_at).getTime())
    .toBeGreaterThan(new Date(before.updated_at).getTime());
});
```

#### Test 2-2: 마이그레이션 idempotency
```bash
# supabase migration up 을 두 번 실행해도 에러 없이 통과 (CREATE TRIGGER ... IF NOT EXISTS / DROP IF EXISTS 패턴)
```

### 구현 항목

**파일**: `supabase/migrations/0007_user_tokens_updated_at_trigger.sql` (신규)
```sql
-- Migration 0005: user_tokens.updated_at 자동 갱신 트리거
-- Plan 0017 P2-#2

create extension if not exists moddatetime schema extensions;

drop trigger if exists trg_user_tokens_updated_at on user_tokens;

create trigger trg_user_tokens_updated_at
  before update on user_tokens
  for each row
  execute procedure extensions.moddatetime(updated_at);
```

---

## Phase 3: Countdown 0 도달 시 onComplete 콜백 (1회 보장)

### 테스트 시나리오

#### Test 3-1: 0 도달 시 onComplete 1회 호출
```tsx
it("given_endsAt가_3초후_when_3초_경과_then_onComplete_정확히_1회_호출", () => {
  // Given
  const now = Date.now();
  const onComplete = vi.fn();
  render(<Countdown endsAtEpochMs={now + 3000} onComplete={onComplete} />);
  expect(onComplete).not.toHaveBeenCalled();
  // When: 3.5s 진행
  act(() => vi.advanceTimersByTime(3500));
  // Then
  expect(onComplete).toHaveBeenCalledTimes(1);
});
```

#### Test 3-2: 이미 지난 endsAt 으로 마운트 → 즉시 1회 호출
```tsx
it("given_endsAt가_이미_과거_when_마운트_then_onComplete_1회_즉시_호출", () => {
  // Given/When
  const onComplete = vi.fn();
  render(<Countdown endsAtEpochMs={Date.now() - 5000} onComplete={onComplete} />);
  // Then
  expect(onComplete).toHaveBeenCalledTimes(1);
});
```

#### Test 3-3: 0 도달 후 추가 tick 들이 발생해도 중복 호출 없음
```tsx
it("given_0_도달_when_이후_여러_tick_경과_then_onComplete_여전히_1회", () => {
  // Given
  const onComplete = vi.fn();
  render(<Countdown endsAtEpochMs={Date.now() + 1000} onComplete={onComplete} />);
  // When
  act(() => vi.advanceTimersByTime(10000));
  // Then
  expect(onComplete).toHaveBeenCalledTimes(1);
});
```

#### Test 3-4: KST midnight 모드는 onComplete 무시
```tsx
it("given_endsAt_미지정_when_자정_통과_then_onComplete_미호출", () => {
  // Given: 23:59:58 KST
  vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 58)));
  const onComplete = vi.fn();
  render(<Countdown onComplete={onComplete} />);
  // When: 5초 진행 (자정 통과)
  act(() => vi.advanceTimersByTime(5000));
  // Then
  expect(onComplete).not.toHaveBeenCalled();
});
```

### 구현 항목

**파일**: `components/Countdown.tsx`
- `CountdownProps` 에 `onComplete?: () => void` 추가
- `useRef<boolean>(false)` 로 `firedRef` 도입 (중복 호출 가드)
- `tick()` 내부에서 `endsAtEpochMs` 가 정의된 경우에 한해 `remaining === 0 && !firedRef.current` 일 때 `onComplete?.()` 호출 후 `firedRef.current = true`
- `endsAtEpochMs` prop 이 변경되면 `firedRef.current = false` 로 리셋 (useEffect deps 에 포함된 신규 effect 또는 동일 effect 진입 시 초기화)

---

## Phase 4: wishlist 중복 인덱스 제거

### 테스트 시나리오

#### Test 4-1: 인덱스 목록에서 idx_wishlist_user 가 사라졌는가
```ts
it("given_wishlist_테이블_when_pg_indexes_조회_then_idx_wishlist_user_미존재", async () => {
  // Given/When
  const { data } = await adminSupabase.rpc("execute_sql", {
    sql: "select indexname from pg_indexes where tablename = 'wishlist'",
  });
  // Then
  const names = (data as { indexname: string }[]).map((r) => r.indexname);
  expect(names).not.toContain("idx_wishlist_user");
  expect(names).toContain("wishlist_pkey"); // PK 는 보존
});
```

#### Test 4-2: user_id 단독 조회 성능 회귀 없음 (EXPLAIN)
```ts
it("given_user_id_조회_when_explain_then_pkey_index_scan_사용", async () => {
  // Given
  await seedRows(...);
  // When
  const { data } = await adminSupabase.rpc("execute_sql", {
    sql: "explain select * from wishlist where user_id = '<uuid>'",
  });
  // Then: PK 인덱스로 Index Scan (Seq Scan 아님)
  expect(JSON.stringify(data)).toMatch(/Index (Only )?Scan using wishlist_pkey/);
});
```

#### Test 4-3: 마이그레이션 idempotency
```bash
# 두 번 적용해도 에러 없음 (DROP INDEX IF EXISTS)
```

### 구현 항목

**파일**: `supabase/migrations/0008_drop_wishlist_dup_index.sql` (신규)
```sql
-- Migration 0006: wishlist 중복 인덱스 제거
-- Plan 0017 P2-#4
-- 근거: PK (user_id, skin_uuid) 의 leftmost prefix 가 user_id 단독 조회를 커버하므로
--       idx_wishlist_user(user_id) 는 중복.
drop index if exists idx_wishlist_user;
```

---

## NFR 반영

| 카테고리 | 반영 내용 | 검증 테스트 |
|---|---|---|
| Performance | 중복 인덱스 제거로 wishlist write 시 인덱스 유지 비용 1개 감소. 그 외 항목은 핫패스 영향 없음. | Test 4-2 (EXPLAIN 회귀 없음) |
| Scale | 변경 없음 — ~1000 위시리스트 레코드 한도 내. user_tokens 트리거는 UPDATE 시 1회 실행이라 ~50 concurrent 에서 무시 가능. | N/A — 부하 회귀만 4-2 로 가드 |
| Availability | 트리거/인덱스 변경은 즉시 적용 + idempotent 마이그레이션 → 적용 실패 시 재실행으로 복구 가능. 99% best-effort 유지. | Test 2-2, 4-3 |
| Security | 본 plan 범위 외 — RLS 정책/암호화/RSO 토큰 처리 변경 없음. 회귀만 확인. | N/A (수동 회귀: 기존 auth-callback 테스트 그대로 통과) |
| Compliance | N/A — Riot ToS / 푸터 고지 / PIPA 변경 없음. | N/A |
| Operability | 두 마이그레이션 모두 신규 파일로 분리 (immutability), `IF NOT EXISTS` / `DROP ... IF EXISTS` 로 idempotent. moddatetime 은 Supabase 표준 확장. | Test 2-2, 4-3 |
| Cost | $0/월 — DB 변경은 무료 티어 한도 내, 새 외부 의존성 없음. | N/A |
| Maintainability | (1) `httpRiotFetcher` 네이밍이 역할(HTTP 어댑터) 명시 → 향후 mock/caching variant 와 대등. (3) `onComplete` 1회 보장으로 호출처가 idempotency 신경 쓸 필요 없음. (4) 중복 인덱스 정리로 schema 가독성 향상. | Test 1-1, 1-2, 3-1, 3-3, 4-1 |

---

## 작업 종속성

### 종속성 그래프
```
Phase 1 ─ 1-1 테스트 ─┐
                      ├─→ 1-impl (fetcher rename + callback import) ─→ 1-2 회귀
        ─ 1-2 테스트 ─┘

Phase 2 ─ 2-1 테스트 ──→ 2-impl (migration 0005)
        ─ 2-2 검증

Phase 3 ─ 3-1 테스트 ─┐
        ─ 3-2 테스트 ─┤
        ─ 3-3 테스트 ─┼─→ 3-impl (Countdown onComplete + ref 가드)
        ─ 3-4 테스트 ─┘

Phase 4 ─ 4-1 테스트 ─┐
        ─ 4-2 테스트 ─┼─→ 4-impl (migration 0006)
        ─ 4-3 검증   ─┘

Phase 1 / 2 / 3 / 4 는 서로 완전히 독립 (다른 파일/도메인) → 4 phase 모두 병렬 가능.
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 2-1, 3-1, 3-2, 3-3, 3-4, 4-1, 4-2 테스트 작성 | 없음 | ✅ |
| G2a | 1-impl (fetcher.ts + callback.ts) | G1 (1-1, 1-2) | ✅ G2b/c/d 와 병렬 |
| G2b | 2-impl (migration 0005) | G1 (2-1) | ✅ |
| G2c | 3-impl (Countdown.tsx) | G1 (3-1~3-4) | ✅ |
| G2d | 4-impl (migration 0006) | G1 (4-1, 4-2) | ✅ |
| G3 | 2-2, 4-3 idempotency 수동 검증 | G2b, G2d | ✅ |

> 모든 Phase 가 서로 다른 파일을 만지므로 파일 충돌 없음. `/implement` 는 G1 → G2(병렬 4갈래) → G3 순으로 실행 가능.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | RiotFetcher export 네이밍 테스트 | ⬜ 미착수 | |
| 1-2 | auth-callback 통합 회귀 (기존 테스트) | ⬜ 미착수 | smoke |
| 1-impl | fetcher.ts + callback.ts 리네임 | ⬜ 미착수 | |
| 2-1 | user_tokens.updated_at 자동 갱신 테스트 | ⬜ 미착수 | |
| 2-2 | migration idempotency 검증 | ⬜ 미착수 | 수동 |
| 2-impl | migration 0005 작성 | ⬜ 미착수 | |
| 3-1 | onComplete 1회 호출 테스트 (정상 경과) | ⬜ 미착수 | |
| 3-2 | onComplete 즉시 호출 테스트 (이미 지난 endsAt) | ⬜ 미착수 | |
| 3-3 | onComplete 중복 호출 없음 테스트 | ⬜ 미착수 | |
| 3-4 | KST midnight 모드 onComplete 미호출 테스트 | ⬜ 미착수 | |
| 3-impl | Countdown.tsx onComplete + firedRef 추가 | ⬜ 미착수 | |
| 4-1 | idx_wishlist_user 미존재 테스트 | ⬜ 미착수 | |
| 4-2 | user_id 조회 EXPLAIN 회귀 테스트 | ⬜ 미착수 | |
| 4-3 | migration idempotency 검증 | ⬜ 미착수 | 수동 |
| 4-impl | migration 0006 작성 | ⬜ 미착수 | |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
