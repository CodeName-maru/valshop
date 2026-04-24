# Plan 0007: 스킨 검색 및 위시리스트 CRUD (Phase 2)

## 개요

> Cross-plan 정합성 감사(2026-04-23) 반영: `user_tokens` DDL 소유권을 Plan 0002 로 확정, 마이그레이션 번호 충돌 해소, `SessionPayload` 필드명을 Plan 0002 기준으로 통일.

유저가 `valorant-api.com` 전체 스킨 카탈로그에서 스킨을 검색하고, 본인 계정에 한정된 위시리스트에 찜/해제(CRUD) 할 수 있는 Phase 2 기능을 구현한다. 범위는 (1) 카탈로그 검색 UI (`/search`), (2) 위시리스트 목록 UI (`/wishlist`), (3) Supabase 기반 Wishlist Store + RLS, (4) `/api/wishlist` Route Handler 다. FR-8(폴링 워커), FR-1(인증)과는 테이블 스키마 / `auth.uid()` 계약을 가정하여 연계한다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 검색 구현 위치 | 클라이언트 측 필터 (카탈로그 전체를 ISR 로 수신 후 in-memory 검색) | ADR-0003 ISR 캐시 재사용, 서버 round-trip 없음 → Performance NFR (체감 즉시) 충족, Cost $0 유지 |
| 검색 인덱스 | `name` 정규화 (소문자 + 공백 제거 + 한글 자모 분해 생략) 후 `includes` 매칭 + `useDeferredValue` 로 입력 디바운스 | 카탈로그 ~1500 스킨 규모 → 단순 선형 검색도 < 5ms, 라이브러리 추가 불필요 (번들·Maintainability) |
| DB 스키마 | Architecture §5.1 의 `wishlist(user_id, skin_uuid)` PK 복합키 그대로 사용 | 재정의 방지. FR-8 워커와 동일 테이블 계약 |
| 인덱스 | `wishlist(user_id)` 자동 (복합 PK 선두 컬럼) + `skin_uuid` 보조 인덱스 (워커 역조회 대비) | Scale NFR: 1000 레코드 × 50 동시 접속 상 PK scan 으로 충분하되, 워커 쪽 skin→users 조회를 위한 `idx_wishlist_skin` 추가 |
| RLS 정책 | `auth.uid() = user_id` 로 `select/insert/delete` 전부 제한 | Security NFR: 본인 레코드만 접근. Supabase Auth `auth.uid()` 와 `user_tokens.user_id` 가 동일 uuid 체계라는 가정 (FR-1 계약) |
| API 경로 | `GET /api/wishlist`, `POST /api/wishlist {skin_uuid}`, `DELETE /api/wishlist?skin_uuid=…` | 단일 route 파일로 REST-lite. 삭제는 멱등 |
| 어댑터 패턴 | `WishlistRepo` 포트(Architecture §6.1) + `createSupabaseWishlistRepo` 어댑터 + 테스트용 in-memory fake | Maintainability: critical-path 테스트가 Supabase 없이 돌게 함 (ADR-0006) |
| Supabase 클라이언트 선택 | Route Handler: `createServerClient` (cookie 기반 세션), RLS 작동 검증용 integration 테스트: `createClient` + anon key + JWT | Security NFR: RLS 가 실제로 동작하는지 JWT 주입으로 확인 |
| 낙관적 UI | 토글 시 클라이언트 상태 즉시 반영 + 실패 시 롤백 | Performance NFR: "체감 즉시" |
| 테스트 스택 | Vitest (unit + integration), RLS 테스트는 `tests/integration/` 에서 Supabase local | ADR-0006 |
| 스타일 | Tailwind + shadcn/ui `Input`, `Card`, `Button`, `Toggle`, `lucide-react` (Heart) | ADR-0007 |
| 에러 처리 | POST 중복 → 409 대신 멱등 200 처리 (토글 UX), DELETE 없음 → 204 | 단순화, 동시성 race 회피 |
| Cost 제약 | 페이지 데이터는 SSR 없이 CSR (`useEffect` + SWR 없이 fetch 1회) → Vercel Function invocation 최소화 | Cost NFR: free tier 한도 유지 |

### NFR 반영

| 카테고리 | 반영 방법 | 테스트/측정 |
|---|---|---|
| Performance | 카탈로그는 ISR 캐시 재사용, 검색은 클라이언트 in-memory, 위시리스트 토글 낙관적 UI | Test 1-1 (검색 < 16ms/입력), 수동 체감 확인, DevTools Performance 패널 |
| Scale | 1000 레코드 상한, `wishlist(user_id)` PK + `idx_wishlist_skin` 보조 인덱스, 50 동시 연결은 Supabase free tier 60 pool 내 | Test 3-2 (1000 행 삽입 후 조회 p95 < 100ms), Supabase Dashboard → DB usage |
| Availability | Supabase 장애 시 위시리스트 기능만 저하, 대시보드는 MVP 경로로 계속 동작 (컴포넌트 경계 분리). Retry 없음 (MVP 정책 일치) | Test 2-3 (Supabase 500 mock → UI 에 fallback toast) |
| Security | RLS `auth.uid() = user_id` 정책, Service Role Key 는 cron 워커 외 금지, Route Handler 는 user JWT 만 사용 | Test 4-1 (다른 user JWT 로 타 user 레코드 select → 0 rows), Test 4-2 (anon 으로 insert → RLS 거부), Test 4-3 (policy DDL snapshot) |
| Compliance (PIPA) | 수집 항목은 `skin_uuid` + `created_at` 뿐 (개인 식별 정보 추가 없음), `/privacy` 에 항목 명시 | Test 3-3 (schema columns 검증), `/privacy` 문서 diff 확인 |
| Operability | Supabase dashboard 의 pg_stat + Vercel Function 로그만 사용, 별도 APM 없음. RLS 거부는 Supabase `postgres_logs` 로 추적 | Supabase Logs → `postgres_logs` WHERE error ~ 'row-level security' |
| Cost | 추가 서비스 없음. 카탈로그 ISR 재사용, 페이지 CSR 로 Function invocation 감소, Supabase storage 1000 × ~80B ≈ 80KB (500MB 한도 대비 무시) | Supabase Dashboard usage, Vercel Function invocation 카운터 월 1회 |
| Maintainability | 포트-어댑터 분리 (`WishlistRepo` + fake), critical-path 테스트는 네트워크/DB 금지, integration 테스트에 RLS 검증 격리 | `npm test` 로 CRUD 유닛 실행, `npm run test:integration` 으로 RLS 확인 |

### 가정 (Assumptions)

- **FR-1 (Auth) — `user_tokens` 테이블 소유권**: `user_tokens` 테이블 DDL 은 **Plan 0002 (Riot 인증/세션) 가 소유** 하며 `supabase/migrations/0001_user_tokens.sql` 로 제공된다. 본 plan 의 `0002_wishlist.sql` 은 해당 테이블이 선행 마이그레이션으로 존재함을 전제로 FK 를 건다.
- **FR-1 (Auth) — Supabase Auth 매핑**: Supabase Auth 세션이 확립되어 있고 `auth.uid()` 가 `user_tokens.user_id` 와 동일한 uuid 를 반환한다 (`user_tokens.user_id = auth.uid()` 관계). Supabase Auth user 계정 생성/매핑 (예: Riot 로그인 직후 upsert) 은 **Plan 0001 auth 플로우** 에서 수행한다 — 범위 외이나 계약 공백 해소를 위해 명시. 본 plan 의 Route Handler 는 `createServerClient(cookies)` 로 세션을 읽는다.
- **FR-1 (Auth) — SessionPayload 필드명**: 세션 객체는 **Plan 0002 에서 정의된 `SessionPayload { puuid, accessToken, ... }` 형태** 를 기준으로 사용한다 (필드명 통일).
- **FR-8 (Worker)**: `wishlist` 테이블 스키마는 Architecture §5.1 을 그대로 사용. 워커는 **Service Role Key** 로 RLS 우회하여 전체 스캔. 따라서 본 plan 의 RLS 정책은 워커 경로를 막지 않는다. 워커 쪽 알림 송신 이력 테이블(`notifications_sent`)은 **Plan 0008 이 `0004_*`/`0005_*` 번호를 사용** 하므로 본 plan 의 `0002`/`0003` 과 충돌하지 않는다.
- **Catalog 소스**: `lib/valorant-api/catalog.ts` 가 이미 존재 or 이 plan 과 동시/선행 구현되어 `Skin[]` 을 반환한다고 가정. 본 plan 에서 별도 구현 안 함 (범위 밖).

---

## Phase 1: 도메인 모델 + 포트 인터페이스

### 테스트 시나리오

#### Test 1-1: 검색 필터 순수 함수
```ts
// tests/critical-path/wishlist/search-filter.test.ts
describe("Feature: 스킨 카탈로그 검색", () => {
  describe("Scenario: 이름 부분 일치 대소문자 무시", () => {
    it("givenSkinList_whenFilterByQueryPhantom_thenReturnsPhantomSkinsOnly", () => {
      // Given: ["Reaver Vandal", "Phantom Prime", "Phantom Oni"] 카탈로그
      // When: filterSkinsByQuery(catalog, "phantom")
      // Then: 2개 Phantom 스킨만 반환, 원본 배열 불변
    });
    it("givenEmptyQuery_whenFilter_thenReturnsAllSkins", () => {
      // Given: 카탈로그 3개
      // When: filterSkinsByQuery(catalog, "")
      // Then: 3개 모두 반환
    });
    it("givenWhitespaceQuery_whenFilter_thenTreatAsEmpty", () => {
      // Given: "   " 쿼리
      // When: filter
      // Then: 전체 반환
    });
  });
});
```

#### Test 1-2: WishlistRepo 포트 계약 (fake 구현체 대상)
```ts
// tests/critical-path/wishlist/repo-contract.test.ts
describe("Feature: WishlistRepo 포트 계약", () => {
  it("givenEmptyRepo_whenAddAndList_thenContainsAddedSkin", async () => {
    // Given: in-memory fake repo
    // When: add("user-1","skin-A"); listFor("user-1")
    // Then: ["skin-A"]
  });
  it("givenAddedSkin_whenAddSameAgain_thenIdempotentNoDuplicate", async () => {
    // Given: add("u","s"); When: add("u","s")
    // Then: listFor("u").length === 1
  });
  it("givenAddedSkin_whenRemove_thenListEmpty", async () => {});
  it("givenUser1Skin_whenListForUser2_thenEmpty", async () => {
    // Given: add("u1","s"); When: listFor("u2") Then: []
    // → tenant isolation (RLS 사전 검증)
  });
});
```

### 구현 항목

**파일**: `lib/domain/wishlist.ts`
- `interface WishlistItem { userId: string; skinUuid: string; createdAt: string }`
- `interface WishlistRepo { add(userId, skinUuid): Promise<void>; remove(userId, skinUuid): Promise<void>; listFor(userId): Promise<string[]> }`
- `export function filterSkinsByQuery(skins: Skin[], q: string): Skin[]` — 순수 함수, 정규화 후 `name.includes`
- `createInMemoryWishlistRepo(): WishlistRepo` — 테스트용 fake (Set<string> 내부 상태)

---

## Phase 2: Supabase 어댑터 + Route Handler

### 테스트 시나리오

#### Test 2-1: Supabase 어댑터 happy path (MSW / Supabase mock)
```ts
// tests/critical-path/wishlist/supabase-adapter.test.ts
describe("Feature: Supabase Wishlist 어댑터", () => {
  it("givenMockedSupabase_whenAdd_thenUpsertIsCalledWithUserAndSkin", async () => {
    // Given: mockSupabaseClient with spy on from('wishlist').upsert
    // When: repo.add("u","s")
    // Then: upsert({user_id:"u", skin_uuid:"s"}, {onConflict:'user_id,skin_uuid'}) 호출
  });
  it("givenMockedSupabase_whenListFor_thenSelectSkinUuidWhereUserId", async () => {});
  it("givenMockedSupabase_whenRemove_thenDeleteEqUserAndSkin", async () => {});
});
```

#### Test 2-2: `/api/wishlist` Route Handler — 인증 경계
```ts
// tests/critical-path/wishlist/route.test.ts
describe("Feature: 위시리스트 API 인증", () => {
  it("givenNoSession_whenGET_then401", async () => {
    // Given: cookie 없음
    // When: testApiHandler 로 GET /api/wishlist
    // Then: 401
  });
  it("givenValidSession_whenGET_thenReturnsSkinUuidsForUser", async () => {
    // Given: Supabase session cookie + fake repo 주입
    // Then: 200 { skins: ["A","B"] }
  });
  it("givenValidSession_whenPOSTWithSkinUuid_thenRepoAddCalled", async () => {});
  it("givenValidSession_whenDELETEWithSkinUuid_thenRepoRemoveCalled", async () => {});
  it("givenValidSession_whenPOSTWithoutBody_then400", async () => {});
});
```

#### Test 2-3: Supabase 장애 내성
```ts
it("givenSupabaseReturns500_whenGET_then503WithRetryHint", async () => {
  // Given: repo.listFor throws
  // When: GET
  // Then: 503, body { error: "wishlist_unavailable" }
});
```

### 구현 항목

**파일**: `lib/supabase/wishlist-repo.ts`
- `export function createSupabaseWishlistRepo(sb: SupabaseClient): WishlistRepo`
- `add`: `sb.from('wishlist').upsert({user_id, skin_uuid}, {onConflict:'user_id,skin_uuid', ignoreDuplicates:true})`
- `listFor`: `sb.from('wishlist').select('skin_uuid').eq('user_id', userId)`
- `remove`: `sb.from('wishlist').delete().eq('user_id', u).eq('skin_uuid', s)`

**파일**: `lib/supabase/server.ts` (신규 또는 기존 확장)
- `createServerClient(cookieStore)` 헬퍼 — @supabase/ssr 사용

**파일**: `app/api/wishlist/route.ts`
- `GET`: 세션 확인 → repo.listFor(user.id) → `{ skins: string[] }`
- `POST`: body `{skin_uuid}` 검증 → repo.add → 204
- `DELETE`: query `?skin_uuid=` → repo.remove → 204
- 세션 없음 → 401, body 오류 → 400, repo 예외 → 503

---

## Phase 3: DB 마이그레이션 + RLS

### 테스트 시나리오

#### Test 3-1: 마이그레이션 스키마 스냅샷
```ts
// tests/integration/wishlist/schema.test.ts  (Supabase local 필요)
describe("Feature: wishlist 테이블 스키마", () => {
  it("givenMigrationsApplied_whenIntrospect_thenHasExpectedColumns", async () => {
    // Given: supabase db reset
    // When: information_schema.columns WHERE table_name='wishlist'
    // Then: [user_id uuid, skin_uuid text, created_at timestamptz]
  });
  it("givenMigrationsApplied_whenInspectPK_thenCompositePkUserSkin", async () => {});
});
```

#### Test 3-2: Scale — 1000 레코드 조회 p95
```ts
// tests/integration/wishlist/scale.test.ts
it("given1000Rows_whenListForUser_thenUnder100ms", async () => {
  // Given: 50 user × 20 skin seed
  // When: repo.listFor(randomUser) × 20회 측정
  // Then: p95 < 100ms (NFR 확인)
});
```

#### Test 3-3: Compliance — 수집 컬럼 최소성
```ts
it("givenSchema_whenListColumns_thenNoPIIColumn", () => {
  // Then: email/name/ip 등 식별 컬럼 존재하지 않음 (skin_uuid, user_id, created_at 만)
});
```

### 구현 항목

**파일**: `supabase/migrations/0002_wishlist.sql`
```sql
create table wishlist (
  user_id uuid references user_tokens(user_id) on delete cascade,
  skin_uuid text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, skin_uuid)
);
create index idx_wishlist_skin on wishlist(skin_uuid);
alter table wishlist enable row level security;
```

**파일**: `supabase/migrations/0003_wishlist_rls.sql` (분리 이유: RLS policy 가 Phase 4 테스트 전제)
```sql
create policy wishlist_own_select on wishlist for select using (auth.uid() = user_id);
create policy wishlist_own_insert on wishlist for insert with check (auth.uid() = user_id);
create policy wishlist_own_delete on wishlist for delete using (auth.uid() = user_id);
```

---

## Phase 4: RLS 정책 보안 테스트 (Security NFR 핵심)

### 테스트 시나리오

#### Test 4-1: 다른 user JWT 로 타 user 레코드 접근 차단
```ts
// tests/integration/wishlist/rls.test.ts
describe("Feature: Wishlist RLS — 본인 레코드만 접근", () => {
  it("givenUserAWishlist_whenUserBSelects_thenZeroRows", async () => {
    // Given: service role 로 userA row 삽입
    // When: anon client + userB JWT 로 select
    // Then: data.length === 0 (error 아님 — RLS 는 silent filter)
  });
  it("givenUserBJWT_whenInsertRowWithUserAId_thenRLSRejects", async () => {
    // When: userB 클라이언트가 {user_id: userA, skin_uuid:"x"} insert
    // Then: error code 42501 (insufficient_privilege) 또는 RLS violation
  });
  it("givenAnonJWT_whenSelect_thenZeroRows", async () => {});
  it("givenUserAJWT_whenDeleteUserBRow_thenZeroRowsAffected", async () => {});
});
```

#### Test 4-2: Service Role 은 RLS 우회 (워커 경로 보존)
```ts
it("givenServiceRoleClient_whenSelectAll_thenAllRowsVisible", async () => {
  // FR-8 워커 가정 검증
});
```

#### Test 4-3: 정책 DDL 존재 확인
```ts
it("givenDB_whenQueryPgPolicies_thenThreePoliciesExist", async () => {
  // select/insert/delete 3개 정책이 존재하는지 pg_policies 확인
});
```

### 구현 항목

(구현 항목 없음 — Phase 3 의 DDL 을 검증하는 테스트 전용 Phase. RLS 는 설계상 "테스트로 보증되지 않으면 없는 것과 같다" 는 원칙에 따라 독립 Phase 로 둠.)

---

## Phase 5: 검색 페이지 + 위시리스트 페이지 UI

### 테스트 시나리오

#### Test 5-1: 검색 페이지 상호작용 (@testing-library)
```ts
// tests/critical-path/wishlist/search-page.test.tsx
describe("Feature: 스킨 검색 페이지", () => {
  it("givenCatalogLoaded_whenTypeQuery_thenFilteredListRenders", async () => {
    // Given: MSW 로 카탈로그 3개 mock, WishlistRepo fake 주입
    // When: user.type(searchInput, "phantom")
    // Then: waitFor → "Phantom" 포함 카드만 렌더
  });
  it("givenSkinCard_whenClickHeart_thenOptimisticallyMarked", async () => {
    // Given: wishlist 비어있음
    // When: Heart 아이콘 클릭
    // Then: 즉시 filled 상태 렌더 + POST /api/wishlist 호출 관측
  });
  it("givenApiFails_whenClickHeart_thenRollsBackAndToasts", async () => {});
});
```

#### Test 5-2: 위시리스트 페이지
```ts
describe("Feature: 위시리스트 페이지", () => {
  it("givenThreeItems_whenMount_thenThreeCardsRender", async () => {});
  it("givenItem_whenClickRemove_thenCardDisappearsAndDeleteCalled", async () => {});
  it("givenEmpty_whenMount_thenEmptyStateMessageShown", async () => {});
});
```

### 구현 항목

**파일**: `app/(app)/search/page.tsx`
- Client Component. `useEffect` 로 카탈로그 + 현재 wishlist fetch 1회.
- `Input` (shadcn) + `useDeferredValue(query)` → `filterSkinsByQuery` → 결과 grid.
- `SkinCard` 재사용 + Heart 토글 버튼.

**파일**: `app/(app)/wishlist/page.tsx`
- 현재 wishlist fetch → 각 skinUuid 를 카탈로그와 조인 → `SkinCard` grid + 제거 버튼.
- 빈 상태: "검색에서 스킨을 찜해보세요" + `/search` 링크.

**파일**: `components/WishlistToggle.tsx`
- props: `{ skinUuid, initialInWishlist }`
- 낙관적 UI: `useOptimistic` 또는 로컬 state + 실패 시 rollback + `sonner` toast.

**파일**: `components/SkinCard.tsx` (기존 확장)
- `action?: ReactNode` prop 추가 → Heart 또는 제거 버튼 주입 가능.

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (도메인/포트) ─┬─ 1-1 테스트 ──→ 1-impl ──┐
                       └─ 1-2 테스트 ──→ 1-impl ──┤
                                                  ▼
Phase 2 (어댑터/Route) ─┬─ 2-1 ─┐                 (Phase 1 완료 필요)
                        ├─ 2-2 ─┤──→ 2-impl (adapter+route)
                        └─ 2-3 ─┘
                                                  ▼
Phase 3 (Migration) ────── 3-1/3-2/3-3 ──→ 3-impl (SQL)
                                                  ▼
Phase 4 (RLS 보안) ─────── 4-1/4-2/4-3 (test-only, 구현 Phase 3 에 의존)
                                                  ▼
Phase 5 (UI) ─────────── 5-1/5-2 ──→ 5-impl (pages + toggle)
                                     (Phase 2 완료 필요, Phase 3/4 선호하나 fake 로 독립 가능)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2 테스트 | 없음 | ✅ |
| G2 | 1-impl (`lib/domain/wishlist.ts`) | G1 | - (단일 파일) |
| G3 | 2-1, 2-2, 2-3 테스트 | G2 | ✅ |
| G4 | 2-impl-adapter (`lib/supabase/wishlist-repo.ts`), 2-impl-route (`app/api/wishlist/route.ts`), 2-impl-server (`lib/supabase/server.ts`) | G3 | ✅ (서로 다른 파일) |
| G5 | 3-1, 3-2, 3-3 테스트 | 없음 (migration 파일만 의존) | ✅ |
| G6 | 3-impl (`supabase/migrations/0002_wishlist.sql`, `0003_wishlist_rls.sql`) | G5 | ✅ (다른 파일) |
| G7 | 4-1, 4-2, 4-3 테스트 | G6 | ✅ |
| G8 | 5-1, 5-2 테스트 | G2 (포트만 있으면 fake 로 테스트 가능) | ✅ |
| G9 | 5-impl-search (`app/(app)/search/page.tsx`), 5-impl-wishlist (`app/(app)/wishlist/page.tsx`), 5-impl-toggle (`components/WishlistToggle.tsx`), 5-impl-card (`components/SkinCard.tsx`) | G4 + G8 | ✅ (다른 파일) |

### 종속성 판단 기준
- **종속**: `WishlistRepo` 포트는 G2 에서 정의되어야 G3/G4/G8 이 참조 가능.
- **종속**: Route Handler (G4) 와 UI (G9) 는 API 계약(JSON shape) 공유 → G9 는 G4 완료 후 실제 호출 가능.
- **독립**: Phase 3 마이그레이션은 Phase 2 코드와 런타임 독립 (Supabase local reset 으로만 검증).
- **독립**: Phase 5 UI 테스트는 MSW + fake repo 로 돌리므로 Phase 3/4 와 병렬 가능.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | 검색 필터 순수 함수 테스트 | ⬜ 미착수 | `tests/critical-path/wishlist/search-filter.test.ts` |
| 1-2 | WishlistRepo 포트 계약 테스트 | ⬜ 미착수 | `tests/critical-path/wishlist/repo-contract.test.ts` |
| 1-impl | `lib/domain/wishlist.ts` 구현 | ⬜ 미착수 | 포트 + `filterSkinsByQuery` + in-memory fake |
| 2-1 | Supabase 어댑터 유닛 테스트 | ⬜ 미착수 | Supabase mock |
| 2-2 | `/api/wishlist` Route Handler 테스트 | ⬜ 미착수 | `next-test-api-route-handler` |
| 2-3 | Supabase 장애 내성 테스트 | ⬜ 미착수 | 503 경로 |
| 2-impl-adapter | `lib/supabase/wishlist-repo.ts` | ⬜ 미착수 | |
| 2-impl-server | `lib/supabase/server.ts` | ⬜ 미착수 | `createServerClient(cookies)` |
| 2-impl-route | `app/api/wishlist/route.ts` | ⬜ 미착수 | GET/POST/DELETE |
| 3-1 | 스키마 스냅샷 테스트 | ⬜ 미착수 | integration |
| 3-2 | 1000 레코드 p95 테스트 | ⬜ 미착수 | Scale NFR |
| 3-3 | 컬럼 최소성 테스트 | ⬜ 미착수 | Compliance NFR |
| 3-impl-migration | `supabase/migrations/0002_wishlist.sql` | ⬜ 미착수 | 테이블 + `idx_wishlist_skin` |
| 3-impl-rls | `supabase/migrations/0003_wishlist_rls.sql` | ⬜ 미착수 | 3개 policy |
| 4-1 | 타 user 접근 차단 테스트 | ⬜ 미착수 | Security NFR 핵심 |
| 4-2 | Service Role RLS 우회 확인 | ⬜ 미착수 | 워커 경로 보존 |
| 4-3 | pg_policies DDL 존재 확인 | ⬜ 미착수 | |
| 5-1 | 검색 페이지 상호작용 테스트 | ⬜ 미착수 | @testing-library |
| 5-2 | 위시리스트 페이지 테스트 | ⬜ 미착수 | |
| 5-impl-toggle | `components/WishlistToggle.tsx` | ⬜ 미착수 | 낙관적 UI |
| 5-impl-card | `components/SkinCard.tsx` action prop 확장 | ⬜ 미착수 | |
| 5-impl-search | `app/(app)/search/page.tsx` | ⬜ 미착수 | |
| 5-impl-wishlist | `app/(app)/wishlist/page.tsx` | ⬜ 미착수 | |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
