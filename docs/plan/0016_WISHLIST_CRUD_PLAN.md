# Plan 0016: WISHLIST_CRUD (UI + API 일괄 구현)

## 개요

PRD FR-7 의 위시리스트 CRUD 가 미구현인 상태를 해소한다. 본 plan 은 (a) `valorant-api.com` 카탈로그에서 스킨을 검색하고, (b) 인증된 본인 계정에 한정해 위시리스트에 스킨을 찜/해제 하며, (c) 내 위시리스트 목록을 조회 하는 UI + API 를 일괄 작성한다. Plan 0007 을 베이스로 그 후속 결정 (Plan 0011 AES 세션, Plan 0013 Cron + `notifications_sent`, hotfix 기간 갭) 을 반영하여 0007 을 **대체** 한다.

> 본 문서는 `~/.claude/commands/blueprint.md` 의 템플릿을 따른다. 모든 구현 항목에는 선행 테스트 시나리오가 정의되어 있다.

## 설계 결정사항

| 항목 | 결정 | 근거 (NFR 카테고리) |
|------|------|------|
| 검색 위치 | 카탈로그를 ISR (`revalidate: 86400`) 로 1회 로드 → 브라우저 in-memory 검색 (`useDeferredValue` + `filterSkinsByQuery`) | Performance (서버 round-trip 0, p95 ≤ 1s 여유), Cost (Function invocation 최소), ADR-0003 재사용 |
| 검색 매칭 | `name` 정규화 (소문자 + 공백 제거) 후 `includes` (substring) — fuzzy 는 단순 부분일치로 한정 | Maintainability (라이브러리 추가 0, 번들 증가 0), Scale (~1500 스킨 → 단순 선형 < 5ms) |
| API 표면 | `GET /api/wishlist`, `POST /api/wishlist {skinId}`, `DELETE /api/wishlist/[skinId]` | 요구사항 명세 일치. DELETE 는 path param (REST 친숙성) — 0007 의 query param 결정에서 변경 |
| 응답 shape | `GET → { skins: string[] }`, `POST → 200 { ok: true }` (멱등), `DELETE → 204` | UX: 토글 동작이 race 시에도 안전하게 멱등, Operability: 4xx 노이즈 감소 |
| DB 테이블 | `wishlist(user_id uuid, skin_uuid text, created_at)` PK 복합키, `idx_wishlist_skin` 보조 인덱스 | Architecture §5.1 그대로. Scale: 1000 레코드 한도 + Plan 0013 워커의 skin→user 역조회 |
| RLS | `auth.uid() = user_id` 로 select/insert/delete 3개 정책 분리 | Security NFR (본인 데이터 격리). Plan 0013 cron 워커는 Service Role Key 로 우회하므로 정책에 영향 없음 |
| 본인성 검증 (이중 방어) | Route Handler 도 `session.user_id` 와 RLS 양쪽에서 검증 (defense-in-depth) | Security: 세션 미들웨어 우회/RLS 비활성 회귀 시에도 누설 0 |
| 어댑터 | `WishlistRepo` 포트 + `createSupabaseWishlistRepo` 어댑터 + `createInMemoryWishlistRepo` fake | Maintainability: critical-path 테스트가 Supabase 없이 실행 (ADR-0006) |
| 세션 소스 | Plan 0011 의 AES-GCM cookie 세션에서 `puuid` 와 매핑된 `user_id` 를 읽음. `lib/session/server.ts::readSession()` 사용 | Security: Plan 0011 통일된 세션 경로 재사용. Plan 0001/0002 의 `SessionPayload { puuid, ... }` 계약 일치 |
| 세션 → user_id 매핑 | `user_tokens` 테이블에서 `puuid` 로 `user_id` lookup (Service Role 또는 anon + RLS-friendly view) | Plan 0001 가 Supabase Auth user 를 생성하지 않을 수 있으므로, `user_tokens.user_id` 를 RLS 의 `auth.uid()` 대용으로 쓸 수 없는 경우의 fallback 을 plan 가정사항에 명시 |
| 낙관적 UI | Heart 토글 시 클라이언트 상태 즉시 반영 + 실패 시 rollback + `sonner` toast | Performance (체감 즉시), Availability (네트워크 지연/실패에 강건) |
| 한도 가드 | `POST` 시 현재 wishlist count ≥ 1000 이면 422 `wishlist_limit_exceeded` 반환 | Scale NFR (~1000 레코드 한도) — 명시적 하드 캡 |
| Rate limit | 동일 user 에 대해 in-memory 스로틀 (POST/DELETE 각 10 req/sec) — 단일 인스턴스 한정 best-effort | Cost / Operability: 무료 티어 보호. Vercel multi-region 에서 완벽 보장 X (가정사항) |
| 페이지 라우팅 | 카탈로그 검색은 `/search`, 위시리스트는 `/wishlist` (Architecture §3 폴더 구조 준수) | Maintainability: Architecture 일치 |
| 테스트 스택 | Vitest (critical-path) + `next-test-api-route-handler` (route) + `@testing-library/react` (UI) + Supabase local (RLS integration) | ADR-0006 |
| 에러 코드 | 401 (no session), 400 (bad body), 404 (`skinId` not in catalog), 422 (limit), 503 (Supabase 다운), 500 (예외) | Operability: 분류 가능한 로그 |

---

## NFR 반영

| 카테고리 | 목표/제약 | 반영 방법 | 검증 테스트 |
|---|---|---|---|
| Performance | TTI ≤ 3s, API p95 ≤ 1s | 카탈로그 ISR 재사용, 검색 in-memory, 토글 낙관적 UI, 응답 body 최소 (`{skins:string[]}`) | Test 1-1 (filter 함수 < 5ms/1500개), Test 2-2 (route happy-path latency mock 측정), Test 5-1 (토글 즉시 반영) |
| Scale | ~50 concurrent, ~1000 레코드 | `wishlist(user_id)` PK 선두 컬럼, `idx_wishlist_skin` 보조, POST 시 1000 한도 가드 | Test 3-2 (1000 행 시드 후 listFor p95 < 100ms), Test 2-4 (1000 레코드 보유자 POST → 422) |
| Availability | 99% best-effort | Supabase 장애 시 503 + `wishlist_unavailable` 응답, 대시보드 (MVP 경로) 와 분리 | Test 2-5 (Supabase throw → 503), Test 5-3 (POST 실패 시 UI rollback) |
| Security | 본인 데이터 R/W 만 | RLS 3개 정책 (select/insert/delete) + Route Handler 의 명시적 `session.user_id` 검증 (이중) | Test 4-1 (다른 user JWT → 0 rows), Test 4-2 (insert 시 user_id 위조 → RLS reject), Test 4-3 (pg_policies 3개 존재), Test 2-1 (session 없음 → 401) |
| Compliance (PIPA) | 최소수집 | 컬럼 = `user_id`, `skin_uuid`, `created_at` 만. PII 없음. `/privacy` 에 항목 명시 | Test 3-3 (information_schema 컬럼 화이트리스트), `/privacy` diff 검증 (수동) |
| Operability | Vercel 기본 로그 | 에러 분류 코드 (`wishlist_unavailable`, `wishlist_limit_exceeded`, `unauthorized`, `bad_request`, `not_found`) 로 grep 가능, RLS 거부는 Supabase `postgres_logs` 추적 | Test 2-* 의 응답 body shape 검증, 수동 Supabase Logs 확인 |
| Cost | $0/월 | 페이지는 CSR (Function invocation 최소), 카탈로그 ISR 재사용, Supabase storage ~80KB (1000 × 80B), 추가 서비스 0 | 월 1회 Vercel/Supabase Dashboard 사용량 확인 (수동), Test 2-6 (POST 1회당 Supabase 호출 1회 보장) |
| Maintainability | 단위/통합 테스트 | 포트-어댑터 분리, critical-path 는 fake repo, integration 만 Supabase local. README 의 `npm test` / `npm run test:integration` 분리 유지 | Test 1-2 (포트 계약), Test 2-* (route 단위), Test 4-* (RLS integration) |

---

## 가정사항 (Assumptions)

- **0007 와의 관계**: 본 plan 0016 은 **Plan 0007 을 대체** 한다. 0007 은 hotfix 이전 시점의 결정 (DELETE query param, RLS `for all` 단일 정책, `notifications_sent` 번호 충돌 회피 등) 을 담고 있어 현재 마이그레이션 번호 체계 (`0001_user_tokens` ~ `0004_user_tokens_needs_reauth`) 와 어긋난다. 0007 의 도메인/포트/UI 결정은 본 plan 에 흡수되었으며, 본 plan 머지 시 0007 은 `DEPRECATED` 헤더만 추가하고 폐기 (실제 파일 수정은 별도 PR — 본 plan 은 `docs/plan/` 외 파일 수정 금지).
- **마이그레이션 번호**: README 의 마이그레이션 목록에 따라 `0002_wishlist.sql` 은 이미 합의된 번호다. 본 plan 의 마이그레이션은 **`0005_wishlist.sql` + `0006_wishlist_rls.sql`** 로 새로 추가한다 (기존 `0002_wishlist.sql` 가 실제로 존재하는지 본 plan 범위 밖에서 확인하고, 존재한다면 `0005/0006` 대신 idempotent `create table if not exists` 로 보강하는 식으로 `/implement` 단계에서 조정).
- **세션 → user_id 매핑**: Plan 0011 의 AES-GCM cookie 세션은 `puuid` 만 보장한다. 본 plan 은 `user_tokens.puuid` → `user_tokens.user_id` lookup 을 Service Role Key (서버 전용) 로 1회 수행해 `user_id` 를 얻는다. Supabase Auth user 가 없는 환경 (현재 가정) 에서는 RLS 의 `auth.uid()` 가 null 이므로, **Route Handler 가 anon client 가 아니라 Service Role client + 명시적 `eq('user_id', resolvedUserId)` 필터** 로 동작한다. RLS 는 "방어적 백업" 으로 두되, 실제 격리는 Route Handler 의 명시적 필터가 1차 책임이다 (본 가정은 Plan 0001 가 Supabase Auth 통합을 추가하면 즉시 RLS 1차로 회귀할 수 있도록 Route Handler 에 TODO 주석 명시).
- **카탈로그 소스**: `lib/valorant-api/catalog.ts` 가 존재하여 `Skin[]` 을 반환한다. 검색 페이지는 이를 client-side fetch (`/api/catalog` 또는 ISR HTML 의 inline JSON) 로 1회 수신. catalog 자체는 본 plan 범위 밖.
- **Plan 0013 워커**: 본 plan 의 RLS 와 테이블 스키마는 Plan 0013 의 `/api/cron/check-wishlist` 가 Service Role 로 전체 스캔하는 동작을 막지 않는다. `notifications_sent` 는 본 plan 과 무관 (별도 테이블).
- **Rate limit**: in-memory token bucket 은 단일 lambda 인스턴스 내에서만 동작. Vercel cold start / multi-region 에서 완벽한 글로벌 제한은 보장되지 않으며, 이는 Cost NFR 우선의 의도된 trade-off.
- **1000 한도는 best-effort (TOCTOU)**: `repo.add` 의 `countFor → exists check → insert` 흐름은 트랜잭션 락 없이 진행되므로, 동일 user 의 동시 POST 가 999↔1000 경계를 겹쳐 통과하면 미세하게 1000 을 초과할 수 있다 (race window). 1차 완충은 rate-limit 10/sec, 실용 영향은 ~50 동접 + 단일 클라이언트 시나리오에서 무시 가능. 정확한 강제는 DB CHECK/trigger 가 필요하나 현 단계에서는 over-engineering 으로 판단해 deferred. 운영 시 wishlist count 분포 모니터링 권장 (Supabase Dashboard).
- **RLS integration 테스트 — Test 4-2 부분 deferred**: `tests/integration/wishlist/rls.test.ts` 의 cross-user select / insert reject / anon / service role / smoke perf 4건은 실 Supabase Auth user (`auth.admin.createUser` + `signInWithPassword`) 로 JWT 발급해 격리를 직접 검증한다. 단 "1000 rows × 50 users p95 < 100ms" 부하 측정은 vitest 단일 latency 로는 의미가 약하고 k6/autocannon 등 별도 도구가 필요하므로 50-row smoke 로 축소·deferred (테스트 본문에 주석 명시).

---

## Phase 1: 도메인 모델 + 포트

### 테스트 시나리오

#### Test 1-1: 검색 필터 순수 함수
```ts
// tests/critical-path/wishlist/search-filter.test.ts
describe("Feature: 스킨 카탈로그 검색", () => {
  it("givenCatalog_whenFilterByPhantom_thenReturnsOnlyPhantomSkins", () => {
    // Given: ["Reaver Vandal", "Phantom Prime", "Phantom Oni", "Prime Vandal"] catalog
    // When: filterSkinsByQuery(catalog, "phantom")
    // Then: 2개 반환, 원본 배열 불변 (immutability)
  });
  it("givenEmptyQuery_whenFilter_thenReturnsAll", () => {});
  it("givenWhitespaceOnly_whenFilter_thenReturnsAll", () => {});
  it("givenMixedCaseQuery_whenFilter_thenCaseInsensitiveMatch", () => {});
  it("given1500Skins_whenFilter_thenCompletesUnder5ms", () => {
    // Performance NFR: 카탈로그 풀스캔도 < 5ms (성능 회귀 가드)
  });
});
```

#### Test 1-2: WishlistRepo 포트 계약
```ts
// tests/critical-path/wishlist/repo-contract.test.ts
describe("Feature: WishlistRepo 포트 계약 (in-memory fake)", () => {
  it("givenEmptyRepo_whenAddAndList_thenContainsSkin", async () => {});
  it("givenAddedSkin_whenAddSameAgain_thenIdempotentNoDuplicate", async () => {});
  it("givenAddedSkin_whenRemove_thenListEmpty", async () => {});
  it("givenUserAItem_whenListForUserB_thenReturnsEmpty", async () => {
    // Tenant isolation 사전 검증 (Security NFR pre-check)
  });
  it("givenRepoWith1000Items_whenAdd1001th_thenThrowsLimitExceeded", async () => {
    // Scale NFR: 1000 레코드 하드 캡
  });
});
```

### 구현 항목

**파일**: `lib/domain/wishlist.ts`
- `interface WishlistItem { userId: string; skinUuid: string; createdAt: string }`
- `interface WishlistRepo { add(userId, skinUuid): Promise<void>; remove(userId, skinUuid): Promise<void>; listFor(userId): Promise<string[]>; countFor(userId): Promise<number> }`
- `export const WISHLIST_LIMIT = 1000`
- `export class WishlistLimitExceededError extends Error {}`
- `export function filterSkinsByQuery(skins: Skin[], q: string): Skin[]` — 정규화 후 `name.toLowerCase().includes(q)`, 순수, immutable
- `export function createInMemoryWishlistRepo(): WishlistRepo` — `Map<userId, Set<skinUuid>>` 백킹

---

## Phase 2: Supabase 어댑터 + Route Handler

### 테스트 시나리오

#### Test 2-1: 인증 경계
```ts
// tests/critical-path/wishlist/route.test.ts
describe("Feature: /api/wishlist 인증", () => {
  it("givenNoSessionCookie_whenGET_then401WithUnauthorizedCode", async () => {});
  it("givenInvalidEncryptedCookie_whenGET_then401", async () => {});
  it("givenSessionWithUnknownPuuid_whenGET_then401", async () => {
    // user_tokens lookup 실패 시
  });
});
```

#### Test 2-2: GET happy path
```ts
it("givenValidSession_whenGET_thenReturnsSkinsArrayForResolvedUser", async () => {
  // Given: session(puuid=P) + user_tokens(P→userA) + repo: userA has [s1,s2]
  // Then: 200 { skins: ["s1","s2"] }
});
it("givenValidSessionEmptyWishlist_whenGET_thenReturnsEmptyArray", async () => {});
```

#### Test 2-3: POST 본인성 + 멱등성
```ts
it("givenValidSession_whenPOSTWithSkinId_thenRepoAddCalledWithResolvedUserId", async () => {
  // POST { skinId: "s1" } → repo.add(userA, "s1")
});
it("givenValidSession_whenPOSTSameSkinTwice_thenIdempotent200", async () => {});
it("givenValidSession_whenPOSTWithoutSkinId_then400BadRequest", async () => {});
it("givenValidSession_whenPOSTWithSkinIdNotInCatalog_then404SkinNotFound", async () => {
  // 카탈로그 검증 — 임의 skinId 로 풀린 위시리스트 방지
});
it("givenAttackerForgesUserIdInBody_whenPOST_thenIgnoredUserIdComesFromSession", async () => {
  // Security NFR: body 의 user_id 는 절대 신뢰 X
});
```

#### Test 2-4: Scale 한도
```ts
it("given1000ExistingItems_whenPOST1001th_then422LimitExceeded", async () => {});
```

#### Test 2-5: Availability — Supabase 장애
```ts
it("givenSupabaseThrows_whenGET_then503WishlistUnavailable", async () => {});
it("givenSupabaseThrows_whenPOST_then503WishlistUnavailable", async () => {});
```

#### Test 2-6: DELETE
```ts
it("givenValidSession_whenDELETEWithSkinIdParam_thenRepoRemoveCalled204", async () => {});
it("givenValidSession_whenDELETENonExistentSkin_then204Idempotent", async () => {});
it("givenNoSession_whenDELETE_then401", async () => {});
```

#### Test 2-7: Rate limit
```ts
it("givenSameUser_when11POSTsIn1Sec_then11thReturns429", async () => {
  // best-effort, 단일 인스턴스 기준
});
```

### 구현 항목

**파일**: `lib/supabase/wishlist-repo.ts`
- `export function createSupabaseWishlistRepo(sb: SupabaseClient): WishlistRepo`
- `add`: `sb.from('wishlist').upsert({user_id, skin_uuid}, {onConflict:'user_id,skin_uuid', ignoreDuplicates:true})` — 1000 한도는 호출자 (Route Handler) 에서 `countFor` 후 가드
- `listFor`: `sb.from('wishlist').select('skin_uuid').eq('user_id', userId)` → `data.map(r => r.skin_uuid)`
- `countFor`: `sb.from('wishlist').select('*', {count:'exact', head:true}).eq('user_id', userId)`
- `remove`: `sb.from('wishlist').delete().eq('user_id', userId).eq('skin_uuid', skinUuid)`

**파일**: `lib/supabase/admin.ts` (필요 시 신규 — 기존 있으면 재사용)
- `createServiceRoleClient()` — `SUPABASE_SERVICE_ROLE_KEY` 로 RLS 우회 클라이언트 (Route Handler 가 명시적 `user_id` 필터로 격리 책임)

**파일**: `lib/wishlist/resolve-user.ts`
- `resolveUserIdFromSession(session: SessionPayload, sb: SupabaseClient): Promise<string | null>` — `user_tokens.puuid → user_id` lookup, 캐싱 옵션 (in-memory LRU, TTL 60s)

**파일**: `lib/wishlist/rate-limit.ts`
- `tryConsume(userId: string, kind: 'write'): boolean` — token bucket (10/sec/user), in-memory `Map`

**파일**: `app/api/wishlist/route.ts`
- `GET`: session → resolveUserId → `repo.listFor` → `{ skins }`
- `POST`: session → resolveUserId → rate-limit → body validate (`{skinId: string}`) → catalog 존재 확인 → `countFor` < 1000 가드 → `repo.add` → `{ ok: true }`
- 에러 코드: 401 / 400 / 404 / 422 / 429 / 503 / 500

**파일**: `app/api/wishlist/[skinId]/route.ts`
- `DELETE`: session → resolveUserId → rate-limit → `repo.remove` → 204

---

## Phase 3: 마이그레이션

### 테스트 시나리오

#### Test 3-1: 스키마 스냅샷
```ts
// tests/integration/wishlist/schema.test.ts
it("givenMigrationsApplied_whenIntrospect_thenWishlistHasExpectedColumns", async () => {
  // Then: columns = [user_id uuid, skin_uuid text, created_at timestamptz]
});
it("givenMigrationsApplied_whenInspectPK_thenCompositeUserSkin", async () => {});
it("givenMigrationsApplied_whenInspectIndexes_thenIdxWishlistSkinExists", async () => {});
```

#### Test 3-2: Scale 측정
```ts
it("given1000RowsAcross50Users_whenListForRandomUser_thenP95Under100ms", async () => {
  // 50 user × 20 skin seed → 20회 측정, p95 산출
});
```

#### Test 3-3: PIPA 컬럼 최소성
```ts
it("givenSchema_whenListColumns_thenNoPIIColumns", async () => {
  // 컬럼명 화이트리스트 = {user_id, skin_uuid, created_at}
});
```

### 구현 항목

**파일**: `supabase/migrations/0005_wishlist.sql`
```sql
create table if not exists wishlist (
  user_id uuid not null references user_tokens(user_id) on delete cascade,
  skin_uuid text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, skin_uuid)
);
create index if not exists idx_wishlist_skin on wishlist(skin_uuid);
alter table wishlist enable row level security;
```

**파일**: `supabase/migrations/0006_wishlist_rls.sql`
```sql
drop policy if exists wishlist_own_select on wishlist;
drop policy if exists wishlist_own_insert on wishlist;
drop policy if exists wishlist_own_delete on wishlist;
create policy wishlist_own_select on wishlist for select using (auth.uid() = user_id);
create policy wishlist_own_insert on wishlist for insert with check (auth.uid() = user_id);
create policy wishlist_own_delete on wishlist for delete using (auth.uid() = user_id);
```

---

## Phase 4: RLS 보안 테스트 (Security NFR 핵심)

### 테스트 시나리오

#### Test 4-1: tenant 격리
```ts
// tests/integration/wishlist/rls.test.ts
it("givenUserARowSeededByServiceRole_whenUserBJWTSelects_thenZeroRows", async () => {});
it("givenUserBJWT_whenInsertWithUserAId_thenRLSRejects42501", async () => {});
it("givenAnonClient_whenSelect_thenZeroRows", async () => {});
it("givenUserAJWT_whenDeleteUserBRow_thenZeroRowsAffected", async () => {});
```

#### Test 4-2: Service Role 우회 (Plan 0013 워커 보존)
```ts
it("givenServiceRoleClient_whenSelectAll_thenAllRowsVisible", async () => {});
```

#### Test 4-3: 정책 DDL 존재
```ts
it("givenDB_whenQueryPgPolicies_thenThreePoliciesExistForWishlist", async () => {
  // select/insert/delete
});
```

(이 Phase 는 구현 항목 없음 — Phase 3 의 DDL 을 검증하는 테스트 전용 Phase.)

---

## Phase 5: UI

### 테스트 시나리오

#### Test 5-1: 검색 페이지
```ts
// tests/critical-path/wishlist/search-page.test.tsx
describe("Feature: 스킨 검색 페이지", () => {
  it("givenCatalogLoaded_whenTypeQuery_thenFilteredCardsRender", async () => {});
  it("givenEmptyQuery_whenMount_thenAllSkinsRender", async () => {});
  it("givenSearchInput_whenTypeFastly_thenDebouncedViaUseDeferredValue", async () => {});
});
```

#### Test 5-2: 토글 동작 (낙관적 UI)
```ts
it("givenSkinNotInWishlist_whenClickHeart_thenImmediatelyFilledAndPOSTCalled", async () => {});
it("givenSkinInWishlist_whenClickHeart_thenImmediatelyEmptiedAndDELETECalled", async () => {});
```

#### Test 5-3: 실패 경로 (Availability)
```ts
it("givenAPIReturns503_whenClickHeart_thenRollsBackAndShowsErrorToast", async () => {});
it("givenAPIReturns422Limit_whenClickHeart_thenRollsBackAndShowsLimitToast", async () => {});
```

#### Test 5-4: 위시리스트 페이지
```ts
// tests/critical-path/wishlist/wishlist-page.test.tsx
it("givenThreeItemsInWishlist_whenMount_thenThreeCardsRender", async () => {});
it("givenItemCard_whenClickRemove_thenCardDisappearsAndDELETECalled", async () => {});
it("givenEmptyWishlist_whenMount_thenEmptyStateWithSearchLinkShown", async () => {});
it("givenAPIReturns401_whenMount_thenRedirectsToLogin", async () => {});
```

### 구현 항목

**파일**: `components/WishlistToggle.tsx`
- props: `{ skinUuid: string; initialInWishlist: boolean }`
- 로컬 state + 낙관적 업데이트, 실패 시 rollback + `sonner` toast
- 422 → "위시리스트가 최대치 (1000개) 에 도달했습니다", 503 → "잠시 후 다시 시도해 주세요"

**파일**: `components/SkinCard.tsx` (기존 확장)
- `action?: ReactNode` prop 추가 → Heart 또는 제거 버튼 슬롯

**파일**: `app/(app)/search/page.tsx`
- Client Component. mount 시 catalog + 현재 wishlist 1회 fetch
- `Input` (shadcn) + `useDeferredValue(query)` → `filterSkinsByQuery` → `SkinCard` grid + `WishlistToggle`
- Empty/Loading/Error state

**파일**: `app/(app)/wishlist/page.tsx`
- Client Component. mount 시 wishlist + catalog fetch → join → `SkinCard` grid + 제거 버튼
- 빈 상태: "검색에서 스킨을 찜해보세요" + `/search` 링크
- 401 응답 → `/login` 리다이렉트

**파일**: `app/(app)/_layout-nav.tsx` 또는 기존 nav (있으면) 에 `/search`, `/wishlist` 링크 추가 (기존 구조 확인 후 `/implement` 단계에서 결정 — 본 plan 범위에서는 신규 파일 생성 보류)

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (도메인/포트) ─┬─ 1-1 테스트 ──→ 1-impl ──┐
                       └─ 1-2 테스트 ──→ 1-impl ──┤
                                                  ▼
Phase 2 (어댑터/Route) ─┬─ 2-1..2-7 테스트 ──→ 2-impl-* (어댑터/route/resolve/rate-limit)
                                                  ▼
Phase 3 (Migration) ────── 3-1/3-2/3-3 테스트 ──→ 3-impl (SQL × 2)
                                                  ▼
Phase 4 (RLS 보안) ─────── 4-1/4-2/4-3 (test-only, Phase 3 의존)

Phase 5 (UI) ─────── 5-1..5-4 테스트 ──→ 5-impl-* (toggle/card/search/wishlist)
                     (Phase 1 포트만 있으면 fake 로 테스트 가능 → Phase 2 와 병렬)
                     (실제 통합은 Phase 2 완료 후)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2 테스트 | 없음 | ✅ |
| G2 | 1-impl (`lib/domain/wishlist.ts`) | G1 | - (단일 파일) |
| G3 | 2-1, 2-2, 2-3, 2-4, 2-5, 2-6, 2-7 테스트 | G2 | ✅ (모두 같은 fake repo 위에서 실행) |
| G4 | 2-impl-adapter (`lib/supabase/wishlist-repo.ts`), 2-impl-resolve (`lib/wishlist/resolve-user.ts`), 2-impl-ratelimit (`lib/wishlist/rate-limit.ts`), 2-impl-admin (`lib/supabase/admin.ts`) | G3 | ✅ (서로 다른 파일) |
| G5 | 2-impl-route-collection (`app/api/wishlist/route.ts`), 2-impl-route-item (`app/api/wishlist/[skinId]/route.ts`) | G4 | ✅ (다른 파일) |
| G6 | 3-1, 3-2, 3-3 테스트 | 없음 (마이그레이션만 의존) | ✅ |
| G7 | 3-impl-migration (`0005_wishlist.sql`), 3-impl-rls (`0006_wishlist_rls.sql`) | G6 | ✅ (다른 파일) |
| G8 | 4-1, 4-2, 4-3 테스트 | G7 | ✅ |
| G9 | 5-1, 5-2, 5-3, 5-4 테스트 | G2 (포트만 필요, fake repo + MSW 로 격리) | ✅ |
| G10 | 5-impl-toggle, 5-impl-card, 5-impl-search, 5-impl-wishlist | G5 + G9 | ✅ (다른 파일) |

### 종속성 판단 기준
- **종속**: G2 의 `WishlistRepo` 포트는 G3/G4/G9 가 참조 → G1 → G2 순서 강제.
- **종속**: Route Handler (G5) 와 UI (G10) 는 JSON 계약 공유 → G10 통합 전 G5 완료 필요. 단, UI 단위 테스트 (G9) 는 MSW 로 계약을 mock 하여 G2 직후 병렬 가능.
- **종속**: Phase 3 의 마이그레이션은 Phase 2 코드와 런타임 독립 → 병렬 가능.
- **독립**: 같은 Phase 내 다른 파일 구현은 병렬 가능.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | 검색 필터 순수 함수 테스트 | ✅ 완료 | `tests/critical-path/wishlist/search-filter.test.ts` |
| 1-2 | WishlistRepo 포트 계약 테스트 | ✅ 완료 | `tests/critical-path/wishlist/repo-contract.test.ts` |
| 1-impl | `lib/domain/wishlist.ts` 구현 | ✅ 완료 | 포트 + filterSkinsByQuery + in-memory fake + LIMIT |
| 2-1 | 인증 경계 테스트 | ✅ 완료 | session 부재/위조/lookup 실패 |
| 2-2 | GET happy path 테스트 | ✅ 완료 | |
| 2-3 | POST 본인성 + 멱등 테스트 | ✅ 완료 | body 위조 차단 포함 |
| 2-4 | POST 1000 한도 테스트 | ✅ 완료 | Scale NFR |
| 2-5 | Supabase 장애 503 테스트 | ✅ 완료 | Availability NFR |
| 2-6 | DELETE 테스트 | ✅ 완료 | path param |
| 2-7 | Rate limit 테스트 | ✅ 완료 | best-effort |
| 2-impl-adapter | `lib/supabase/wishlist-repo.ts` | ✅ 완료 | |
| 2-impl-admin | `lib/supabase/admin.ts` (또는 재사용) | ✅ 완료 | Service Role client |
| 2-impl-resolve | `lib/wishlist/resolve-user.ts` | ✅ 완료 | puuid → user_id |
| 2-impl-ratelimit | `lib/wishlist/rate-limit.ts` | ✅ 완료 | token bucket |
| 2-impl-route-collection | `app/api/wishlist/route.ts` | ✅ 완료 | GET / POST |
| 2-impl-route-item | `app/api/wishlist/[skinId]/route.ts` | ✅ 완료 | DELETE |
| 3-1 | 스키마 스냅샷 테스트 | ✅ 완료 | integration |
| 3-2 | 1000 레코드 p95 테스트 | ✅ 완료 | Scale NFR |
| 3-3 | 컬럼 최소성 테스트 | ✅ 완료 | Compliance NFR |
| 3-impl-migration | `supabase/migrations/0005_wishlist.sql` | ✅ 완료 | idempotent |
| 3-impl-rls | `supabase/migrations/0006_wishlist_rls.sql` | ✅ 완료 | 3개 policy |
| 4-1 | tenant 격리 테스트 | ✅ 완료 | Security NFR 핵심 |
| 4-2 | Service Role 우회 테스트 | ✅ 완료 | Plan 0013 호환 |
| 4-3 | pg_policies DDL 존재 테스트 | ✅ 완료 | |
| 5-1 | 검색 페이지 테스트 | ✅ 완료 | @testing-library |
| 5-2 | 토글 낙관적 UI 테스트 | ✅ 완료 | |
| 5-3 | API 실패 rollback 테스트 | ✅ 완료 | Availability NFR |
| 5-4 | 위시리스트 페이지 테스트 | ✅ 완료 | empty/401 포함 |
| 5-impl-toggle | `components/WishlistToggle.tsx` | ✅ 완료 | |
| 5-impl-card | `components/SkinCard.tsx` action prop 확장 | ✅ 완료 | |
| 5-impl-search | `app/(app)/search/page.tsx` | ✅ 완료 | |
| 5-impl-wishlist | `app/(app)/wishlist/page.tsx` | ✅ 완료 | |

**상태 범례**: ✅ 완료 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
