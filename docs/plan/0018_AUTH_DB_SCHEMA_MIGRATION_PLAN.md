# Plan 0018: Auth 재설계 FR-R1 — DB 스키마 마이그레이션 + user-tokens-repo 확장

## 개요

`docs/superpowers/specs/2026-04-24-auth-redesign-design.md` § 7 FR-R1 을 단일 소스로 하여, Riot 인증 재설계(PW 프록시 + ssid 재인증 + Supabase 단일 vault)의 **DB 선결 조건**을 확보한다. 구체적으로 (a) `user_tokens` 테이블에 세션 vault 컬럼(`session_id`, `ssid_enc`, `tdid_enc`, `session_expires_at`) 추가, (b) 기존 행 전량 삭제(이전 implicit-grant 구현 미동작 → 재로그인 강제), (c) `rate_limit_buckets` 테이블 신설, (d) `lib/supabase/user-tokens-repo.ts` 에 신 API 4종(`upsertTokens` / `findBySessionId` / `deleteBySessionId` / `deleteByPuuid`) 노출, (e) `lib/supabase/types.ts` 에 확장 컬럼 타입 반영이다. 본 plan 은 후속 FR-R2 (auth-client), FR-R3 (session), FR-R4 (route handlers) 의 **선결 조건**이며 spec § 8 G1 독립 그룹에 속한다.

> 본 문서는 `~/.claude/commands/blueprint.md` 템플릿을 따른다. 모든 구현 항목에는 선행 테스트 시나리오가 정의되어 있다. spec FR-R1 의 인수조건/터치 파일/테스트/의존은 본 plan 의 **계약**이다.

## 제공 계약 (후속 plan 이 import)

본 plan 은 Supabase `user_tokens` 단일 vault 및 `rate_limit_buckets` 테이블의 **단일 소스 오브 트루스**로 승격된다. Plan 0019 (auth-client) / 0020 (session) / 0021 (route handlers) / 0024 (레거시 제거) 는 아래 export 만 참조한다.

### 모듈 시그니처

```ts
// lib/supabase/types.ts — 확장
export interface UserTokensRow {
  user_id: string;                 // 기존 UUID PK (legacy, 유지)
  puuid: string;                   // Riot PUUID, unique
  session_id: string;              // UUIDv4, unique, NOT NULL
  session_expires_at: Date;        // vault row 자체의 만료 (서버 세션 길이)
  ssid_enc: string;                // AES-GCM base64 (neutral text) — NOT NULL
  tdid_enc: string | null;         // AES-GCM base64 (nullable: trusted-device 미등록 가능)
  access_token_enc: Uint8Array;    // 기존 bytea (legacy 유지, 점진 전환)
  refresh_token_enc: Uint8Array;   // 기존 bytea (legacy 유지)
  entitlements_jwt_enc: Uint8Array;// 기존 bytea (legacy 유지)
  expires_at: Date;                // access_token 만료
  needs_reauth: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertTokensInput {
  puuid: string;
  sessionId: string;
  sessionExpiresAt: Date;
  ssidEnc: string;
  tdidEnc: string | null;
  accessTokenEnc: Uint8Array;
  entitlementsJwtEnc: Uint8Array;
  accessExpiresAt: Date;
}

// lib/supabase/user-tokens-repo.ts — 확장 API (spec FR-R1)
export interface UserTokensRepo {
  // 신규 (FR-R1)
  upsertTokens(input: UpsertTokensInput): Promise<{ user_id: string }>;
  findBySessionId(sessionId: string): Promise<UserTokensRow | null>;
  deleteBySessionId(sessionId: string): Promise<void>;
  deleteByPuuid(puuid: string): Promise<void>;

  // 기존 (유지 — Plan 0013 cron 워커 호환)
  listActive(): Promise<UserTokensRow[]>;
  get(userId: string): Promise<UserTokensRow | null>;
  markNeedsReauth(userId: string): Promise<void>;
  upsert(row: UserTokenInsertLegacy): Promise<{ user_id: string }>;
}
export function createUserTokensRepo(supabase: SupabaseClient): UserTokensRepo;
```

### 소유 DDL

| 파일 | 소유 범위 | 소비 plan |
|------|-----------|-----------|
| `supabase/migrations/0009_auth_redesign.sql` (신규) | `user_tokens` ALTER (4 컬럼 추가 + NOT NULL 승격 + idx + RLS 확인), 기존 데이터 삭제, `rate_limit_buckets` CREATE | 0019/0020/0021 |

**DDL (spec § 4-4 그대로):**

```sql
alter table user_tokens
  add column if not exists session_id uuid unique,
  add column if not exists session_expires_at timestamptz,
  add column if not exists ssid_enc text,
  add column if not exists tdid_enc text;

-- 기존 행 무효화 (implicit-grant 미동작 → 재로그인 강제)
delete from user_tokens;

-- NOT NULL 승격 (행 없는 상태에서 안전)
alter table user_tokens
  alter column session_id set not null,
  alter column session_expires_at set not null,
  alter column ssid_enc set not null;

create index if not exists user_tokens_session_id_idx on user_tokens (session_id);

-- RLS: 기본 deny. service_role 은 RLS bypass.
alter table user_tokens enable row level security;

-- Rate limit 테이블
create table if not exists rate_limit_buckets (
  bucket_key text primary key,
  count int not null,
  window_start timestamptz not null
);
alter table rate_limit_buckets enable row level security;
```

---

## 설계 결정사항

| 항목 | 결정 | 근거 (NFR) |
|------|------|------|
| 암호화 컬럼 타입 (신규) | `ssid_enc` / `tdid_enc` 는 **`text`** (AES-GCM base64 문자열). 기존 bytea 컬럼(`access_token_enc` 등) 은 레거시 유지 | Maintainability: spec § 4-4 가 text 를 명시. bytea hex 직렬화(Plan 0014) 복잡도 신규 컬럼엔 도입 안 함. Operability: 재현 가능한 이식 |
| 기존 bytea 컬럼 처리 | **유지** (삭제 금지). Plan 0013 cron 워커가 여전히 `access_token_enc` 를 소비. FR-R1 범위는 "컬럼 추가"이지 "기존 제거"가 아님 | Availability: 실수로 제거 시 cron 워커 즉시 장애. Non-goal 명시 |
| 기존 행 삭제 | `delete from user_tokens` 실행. 데이터 자체가 implicit-grant 시절 토큰이라 복원 가치 없음 | Security: 동작하지 않던 토큰 잔존은 공격 표면. Compliance(PIPA) 최소수집 원칙 강화 |
| NOT NULL 타이밍 | `delete` 직후, 신규 insert 가능해지기 전에 `set not null`. 무결성 틈 없음 | Security / Operability: 스키마 일관성 |
| 마이그레이션 idempotent | `add column if not exists`, `create index if not exists`, `create table if not exists`. ALTER NOT NULL 은 한 번만 성공(두 번째 실행은 이미 NOT NULL → no-op) | Operability: 재실행 안전, rollback 용이 |
| 마이그레이션 파일 번호 | `0009_auth_redesign.sql` — 현재 마지막 번호 `0008_drop_wishlist_dup_index.sql` 다음 | Operability: Supabase CLI 순차 적용 규약 |
| repo 신규 API — 서비스 롤 전용 | 4종 신규 함수는 **모두 service_role client** 를 전제. anon 접근 테스트에서 deny 검증 | Security: spec § 6 정책. RLS 정책 미정의 = 기본 deny |
| repo 신규 API — DI | `createUserTokensRepo(supabase)` 시그니처 유지. `SupabaseClient` 주입으로 테스트가 `@supabase/supabase-js` 실 호출 없이 fake 로 검증 | Maintainability: ADR-0006 포트-어댑터, 단위 테스트 격리 |
| `findBySessionId` 결과 형상 | null vs row. PGRST116 (not found) → null, 그 외 에러는 throw | Operability: 에러 분류. Availability: 기존 `get()` 와 동일 패턴 |
| `upsertTokens` conflict target | `onConflict: "puuid"` (PUUID 는 유일). 같은 유저 재로그인 시 덮어쓰기 | Security: 1 PUUID = 1 활성 session (spec § 10 non-goal 다중 세션). Scale: row 수 제어 |
| `upsertTokens` — session_id 갱신 | 매 재로그인마다 새 UUIDv4. 이전 session_id cookie 는 DB miss → resolve null → 재로그인 유도 | Security: session rotation, cookie 탈취 내성 |
| `deleteBySessionId` 멱등성 | 존재하지 않는 session_id 도 no-op 성공 (0 rows affected). 에러 아님 | Availability: 이중 로그아웃 안전 (Plan 0002 A1b 기조 유지) |
| `deleteByPuuid` 용도 | 관리 / 후속 FR-R4 logout route 에서 PUUID 기반 전면 파기 시 사용. FR-R1 스코프에선 API 노출만 | Maintainability: 후속 plan 불확실성 완충. Operability: 수동 파기 창구 |
| `rate_limit_buckets` 인덱스 | PK(`bucket_key`) 만. `window_start` 는 TTL 필드이지만 cron/cleanup 은 FR-R1 범위 밖 (후속) | Cost: 인덱스 추가 비용 회피. Scale: ~50 concurrent 에서 PK lookup O(1) |
| `rate_limit_buckets` RLS | `enable row level security` + 정책 미정의 = deny. service_role 전용 | Security: middleware 만 접근 |
| 타입 파일 분리 | `lib/supabase/types.ts` 에 `UserTokensRow` 확장 + `UpsertTokensInput` 추가. 기존 `UserTokenInsert` 는 legacy 호환 alias 로 유지 | Maintainability: 신/구 혼재 기간 최소 파손 |
| RLS 통합 테스트 위치 | `tests/integration/auth/user-tokens-rls.test.ts` (신규). 기존 `tests/integration/wishlist/rls.test.ts` 패턴 복제 | Maintainability: 테스트 구조 일관성, `/implement` 시 참조 용이 |
| 테스트 스택 | Vitest (단위) + `@supabase/supabase-js` (실 Supabase local, integration) | ADR-0006 |

---

## 가정사항 (Assumptions)

- **A1 (마이그레이션 번호)**: 현재 `supabase/migrations/` 의 마지막 파일은 `0008_drop_wishlist_dup_index.sql`. 본 plan 은 `0009_auth_redesign.sql` 로 할당한다. `/implement` 단계에서 사이에 다른 번호가 추가되었으면 순번 조정.
- **A2 (기존 행 삭제의 영향)**: `delete from user_tokens` 는 Plan 0013 cron 워커가 읽을 행도 삭제한다. 운영상 현재 로컬/개발 환경엔 유효 행이 없고 (implicit-grant 미동작), 프로덕션 배포 시에도 유저에게 재로그인 UX 안내가 이미 spec § 1 에 전제돼 있다.
- **A3 (legacy bytea 컬럼과의 공존)**: `access_token_enc` / `refresh_token_enc` / `entitlements_jwt_enc` bytea 컬럼은 **유지**. 신규 `ssid_enc` / `tdid_enc` 는 text 로 추가. 후속 FR 에서 `access_token_enc` 를 text 로 통일할지는 본 plan 의 결정이 아니다 (spec § 4-4 가 bytea 를 명시적으로 지우지 않음).
- **A4 (service_role client 전제)**: 본 plan 의 repo 함수는 항상 service_role 키로 생성된 client 를 주입받는다. anon client 로는 사용 금지 (RLS 기본 deny). 이는 test 에서 `createClient(url, ANON_KEY)` 로 접근 시 0 행/권한 거부가 나오는지를 검증한다.
- **A5 (암호화 로직 소유)**: `ssid_enc` / `tdid_enc` 의 AES-GCM 암복호화는 **plan 0020 (lib/session/crypto.ts) 소유**. 본 plan 은 "이미 암호화된 base64 문자열" 을 그대로 저장/조회하는 계약만 제공. repo 레벨에서 key load / encrypt call 없음.
- **A6 (`session_expires_at` 단위)**: `timestamptz`. 값은 호출자가 `new Date(Date.now() + N*1000)` 로 계산해 넘긴다. cookie Max-Age 는 후속 plan (0020 store.ts) 이 row 에서 읽어 계산.
- **A7 (MVP 동시성)**: 같은 PUUID 로 동시 upsert 2건은 `onConflict: puuid` 로 마지막 write 가 승리 (last-write-wins). spec § 9 "reauth race MVP 수용" 과 정합. advisory lock 미도입.
- **A8 (`rate_limit_buckets` 사용 주체)**: 본 plan 은 테이블 DDL 만 소유. 실제 bucket consume / refill 로직은 plan 0021 (`lib/middleware/rate-limit.ts`) 소유. 본 plan 은 schema 검증 테스트(Test 3-2)만 포함.
- **A9 (`deleteByPuuid` 와 cron 워커)**: cron 워커는 `markNeedsReauth` 경로 유지. `deleteByPuuid` 는 auth route 전용이며 cron 워커 경로와 분리.
- **A10 (RLS 테스트 격리)**: 통합 테스트는 로컬 Supabase(`supabase start`) 또는 CI Supabase test project 전제. `/implement` 단계에서 env 가 없으면 스킵 (기존 wishlist RLS 테스트 동일 패턴).

---

## NFR 반영

| 카테고리 | 목표/제약 | 반영 방법 | 검증 테스트 |
|---|---|---|---|
| Performance | API p95 ≤ 1s; session_id lookup O(1) | `user_tokens_session_id_idx` BTREE 인덱스로 `findBySessionId` O(log n). PostgREST .eq().single() 은 idx hit | Test 3-3 (idx 존재 DDL 스냅샷), Test 2-2 (findBySessionId happy path < 50ms) |
| Scale | ~50 concurrent, ~1000 rows | `user_tokens` 는 user 당 1 row (UNIQUE puuid) → 최대 ~50 rows. `rate_limit_buckets` 는 ip+kind 조합으로 O(100) 단위. 인덱스 불필요 | Test 3-1 (unique constraint), Test 2-4 (중복 upsert last-write-wins) |
| Availability | 99% best-effort | service_role 실패 시 throw → route 는 503 매핑 (후속 plan). repo 레벨에선 에러 전파만 | Test 2-5 (supabase error → throw), Test 2-6 (PGRST116 → null, 다른 에러는 throw) |
| Security | RLS 기본 deny + service_role 전용 + 암호화 컬럼 | `enable row level security` + 정책 미정의. 테스트: anon client 로 select → 0 rows/권한 거부. `ssid_enc`/`tdid_enc` 는 이미 암호화된 base64 만 수용(본 레이어는 암호화 안 함) | Test 4-1 (anon select deny), Test 4-2 (anon insert deny), Test 4-3 (pg_policies 에 user_tokens 정책 없음 = 기본 deny 확인), Test 3-4 (`rate_limit_buckets` RLS enable) |
| Compliance (PIPA) | 최소수집 — PUUID 외 PII 미저장 | 신규 컬럼 집합 = session_id / session_expires_at / ssid_enc / tdid_enc. 모두 Riot 세션 토큰 계열. 이메일/실명/IP 미저장 (rate_limit 의 bucket_key 는 IP 해시 예상이지만 본 plan 은 키 포맷 강제 안 함) | Test 3-5 (컬럼 화이트리스트 검증 — 신규 컬럼 4종 외 추가 없음) |
| Operability | Supabase CLI 적용, rollback 가능 idempotent SQL | `add column if not exists`, `create index if not exists`, `create table if not exists`. 재실행 안전. rollback 은 별도 down-migration(범위 외) 또는 수동 drop | Test 3-6 (마이그레이션 두 번 적용 no-op 검증 — 가능하면 통합 테스트로, 어렵다면 수동 smoke) |
| Cost | $0 — Supabase 무료 티어 | 신규 컬럼 4 + idx 1 + 테이블 1. row 수 ~50. storage < 50 KB. 쿼리 증가분은 session 당 1회 lookup | N/A — 이 요구사항 범위 외 (수동 월간 usage 확인) |
| Maintainability | repo 함수 DI, 단위 테스트 커버 | `createUserTokensRepo(supabase)` 시그니처 유지. 4종 신규 함수 각각 happy + not-found + error 분기 단위 테스트. fake supabase client 로 `@supabase/supabase-js` 실 호출 없이 검증 | Test 2-1 ~ 2-7 (단위 4종 × 분기) |

---

## Phase 1: 타입 확장 (types.ts)

### 테스트 시나리오

#### Test 1-1: `UserTokensRow` 가 신규 4 컬럼을 포함한다 (type-level)
```ts
// tests/critical-path/auth/user-tokens-types.test.ts
import type { UserTokensRow, UpsertTokensInput } from "@/lib/supabase/types";
describe("Feature: UserTokensRow 타입", () => {
  it("givenRowType_whenAssignSessionFields_thenTypeChecks", () => {
    const row: UserTokensRow = {
      user_id: "u", puuid: "p",
      session_id: "sid", session_expires_at: new Date(),
      ssid_enc: "base64", tdid_enc: null,
      access_token_enc: new Uint8Array(), refresh_token_enc: new Uint8Array(),
      entitlements_jwt_enc: new Uint8Array(),
      expires_at: new Date(), needs_reauth: false,
      created_at: new Date(), updated_at: new Date(),
    };
    expect(row.session_id).toBe("sid");
  });
  it("givenUpsertTokensInput_whenAssignRequired_thenTypeChecks", () => {
    const input: UpsertTokensInput = {
      puuid: "p", sessionId: "s", sessionExpiresAt: new Date(),
      ssidEnc: "x", tdidEnc: null,
      accessTokenEnc: new Uint8Array(), entitlementsJwtEnc: new Uint8Array(),
      accessExpiresAt: new Date(),
    };
    expect(input.puuid).toBe("p");
  });
});
```

### 구현 항목

**파일**: `lib/supabase/types.ts`
- `UserTokensRow` 에 `session_id: string`, `session_expires_at: Date`, `ssid_enc: string`, `tdid_enc: string | null` 추가.
- `UpsertTokensInput` 인터페이스 신규.
- 기존 `UserTokenInsert` 는 legacy alias 로 유지 (Plan 0013 cron 영향 없음).

---

## Phase 2: Repository 확장 (단위 테스트)

### 테스트 시나리오

#### Test 2-1: `upsertTokens` happy path — 신규 puuid 삽입
```ts
// tests/critical-path/auth/user-tokens-repo.test.ts
it("givenEmptyTable_whenUpsertTokens_thenInsertsAndReturnsUserId", async () => {
  // Given: fake supabase client 가 insert 성공 + user_id="u1" 반환
  // When: repo.upsertTokens({puuid, sessionId,...})
  // Then: { user_id: "u1" }, payload.puuid/session_id/ssid_enc 등 직렬화 검증
});
```

#### Test 2-2: `findBySessionId` happy path
```ts
it("givenExistingSessionId_whenFindBySessionId_thenReturnsRow", async () => {
  // Given: fake supabase .from('user_tokens').select().eq('session_id',id).single() → row
  // When
  // Then: row.session_id === id, bytea 컬럼은 Uint8Array 로 정규화
});
```

#### Test 2-3: `findBySessionId` not found → null
```ts
it("givenUnknownSessionId_whenFindBySessionId_thenNull", async () => {
  // Given: fake가 error.code='PGRST116' 반환
  // Then: null (throw 아님)
});
```

#### Test 2-4: `upsertTokens` 중복 puuid → 덮어쓰기 (last-write-wins)
```ts
it("givenSamePuuidTwice_whenUpsertTokens_thenLastWriteWins", async () => {
  // Given: 같은 puuid 로 2번 upsert (다른 session_id)
  // Then: 두 번째 호출 payload 가 onConflict:"puuid" 로 저장됨
  //       — fake 가 upsert 호출 인자를 기록해 두 번째 호출의 session_id 가 최종
});
```

#### Test 2-5: 에러 전파 — `findBySessionId` 의 DB 에러는 throw
```ts
it("givenDbError_whenFindBySessionId_thenThrowsWithMessage", async () => {
  // Given: fake 가 error.code='XX000', message='conn lost'
  // When/Then: rejects.toThrow(/Failed to find.*conn lost/)
});
```

#### Test 2-6: `deleteBySessionId` 멱등성 — 없는 id 도 성공
```ts
it("givenUnknownSessionId_whenDeleteBySessionId_thenResolvesWithoutError", async () => {
  // Given: fake가 0 rows affected
  // Then: resolves (no throw)
});
```

#### Test 2-7: `deleteByPuuid` 성공 + 에러 전파
```ts
it("givenPuuid_whenDeleteByPuuid_thenDeletesAndResolves", async () => {});
it("givenDbError_whenDeleteByPuuid_thenThrows", async () => {});
```

### 구현 항목

**파일**: `lib/supabase/user-tokens-repo.ts` (수정)
- `upsertTokens(input: UpsertTokensInput): Promise<{ user_id: string }>`
  - payload 직렬화: `session_id`, `session_expires_at` (ISO), `ssid_enc` (text), `tdid_enc` (text|null), 기존 bytea 는 `encodeBytea`.
  - `.upsert(..., { onConflict: "puuid" }).select("user_id").single()`.
- `findBySessionId(sessionId: string): Promise<UserTokensRow | null>`
  - `.select("*").eq("session_id", sessionId).single()`.
  - PGRST116 → null. 나머지 error → throw.
  - 성공 행은 `normalizeRow` (bytea 역직렬화) 후 `session_expires_at`/`expires_at`/`created_at`/`updated_at` 문자열 → Date 변환.
- `deleteBySessionId(sessionId: string): Promise<void>`
  - `.delete().eq("session_id", sessionId)`. `error && error.code !== "PGRST116"` 시 throw. 0 rows 는 성공.
- `deleteByPuuid(puuid: string): Promise<void>`
  - `.delete().eq("puuid", puuid)`. 같은 멱등 규칙.
- 기존 `listActive` / `get` / `markNeedsReauth` / `upsert` 는 **변경 없이 유지** (Plan 0013 cron 호환).

---

## Phase 3: 마이그레이션 SQL

### 테스트 시나리오

#### Test 3-1: 스키마 스냅샷 — 신규 컬럼 존재
```ts
// tests/integration/auth/user-tokens-schema.test.ts
it("givenMigrationApplied_whenIntrospect_thenUserTokensHasSessionColumns", async () => {
  // information_schema.columns where table='user_tokens'
  // expect: session_id (uuid, not null), session_expires_at (timestamptz, not null),
  //         ssid_enc (text, not null), tdid_enc (text, null)
});
```

#### Test 3-2: `rate_limit_buckets` 테이블 생성
```ts
it("givenMigrationApplied_whenIntrospect_thenRateLimitBucketsExists", async () => {
  // columns: bucket_key (text PK), count (int4, not null), window_start (timestamptz, not null)
});
```

#### Test 3-3: `user_tokens_session_id_idx` 인덱스 존재
```ts
it("givenMigrationApplied_whenInspectIndexes_thenSessionIdIdxExists", async () => {
  // pg_indexes where tablename='user_tokens' and indexname='user_tokens_session_id_idx'
});
```

#### Test 3-4: RLS enable
```ts
it("givenMigrationApplied_whenInspectRls_thenUserTokensAndRateLimitBucketsEnabled", async () => {
  // pg_tables.rowsecurity = true for both
});
```

#### Test 3-5: 컬럼 화이트리스트 (PIPA)
```ts
it("givenMigrationApplied_whenListUserTokensColumns_thenNoUnexpectedPII", async () => {
  // 허용 집합 = {user_id, puuid, session_id, session_expires_at, ssid_enc, tdid_enc,
  //              access_token_enc, refresh_token_enc, entitlements_jwt_enc,
  //              expires_at, needs_reauth, created_at, updated_at}
  // 차집합 === 0
});
```

#### Test 3-6: idempotent 재실행
```ts
it("givenMigrationAppliedTwice_whenRerun_thenNoError", async () => {
  // supabase db push 를 두 번 — 두 번째는 no-op (if not exists 덕분)
  // 실 supabase CLI 없으면 수동 smoke 로 대체 (테스트 주석 명시)
});
```

### 구현 항목

**파일**: `supabase/migrations/0009_auth_redesign.sql` (신규)
```sql
-- FR-R1: auth 재설계 스키마
-- Spec: docs/superpowers/specs/2026-04-24-auth-redesign-design.md § 4-4

-- 1) user_tokens 확장
alter table user_tokens
  add column if not exists session_id uuid unique,
  add column if not exists session_expires_at timestamptz,
  add column if not exists ssid_enc text,
  add column if not exists tdid_enc text;

-- 2) 기존 행 삭제 (implicit-grant 시절 토큰 무효)
delete from user_tokens;

-- 3) NOT NULL 승격
alter table user_tokens
  alter column session_id set not null,
  alter column session_expires_at set not null,
  alter column ssid_enc set not null;

-- 4) session_id lookup 인덱스 (O(1) resolve)
create index if not exists user_tokens_session_id_idx
  on user_tokens (session_id);

-- 5) RLS 재확인 (이미 enable 이지만 idempotent 보강)
alter table user_tokens enable row level security;

-- 6) rate_limit_buckets 신설
create table if not exists rate_limit_buckets (
  bucket_key   text primary key,
  count        int not null,
  window_start timestamptz not null
);
alter table rate_limit_buckets enable row level security;
```

---

## Phase 4: RLS 통합 테스트 (Security NFR 핵심)

### 테스트 시나리오

(파일: `tests/integration/auth/user-tokens-rls.test.ts`)

#### Test 4-1: anon client — select 권한 거부
```ts
it("givenAnonClient_whenSelectUserTokens_thenZeroRowsOrDenied", async () => {
  // Given: service_role 로 row 1건 seed
  // When: anon client 로 .from('user_tokens').select('*')
  // Then: data = [] 또는 error.code = permission_denied (기본 deny)
});
```

#### Test 4-2: anon client — insert 거부
```ts
it("givenAnonClient_whenInsertUserTokens_thenRejected", async () => {
  // anon 으로 insert → error (RLS 정책 없음 → 기본 deny)
});
```

#### Test 4-3: anon — `ssid_enc` / `tdid_enc` 컬럼도 접근 불가
```ts
it("givenAnonClient_whenSelectSsidEncColumn_thenDeniedOrEmpty", async () => {
  // select('ssid_enc, tdid_enc') → [] or denied
});
```

#### Test 4-4: service_role 우회 검증
```ts
it("givenServiceRoleClient_whenSelectAll_thenRowsVisible", async () => {
  // service_role 로 seed 후 select → rows 보임
});
```

#### Test 4-5: `rate_limit_buckets` anon 거부
```ts
it("givenAnonClient_whenSelectRateLimitBuckets_thenDenied", async () => {});
```

#### Test 4-6: repo 왕복 smoke (실 Supabase)
```ts
it("givenServiceRoleRepo_whenUpsertThenFindThenDelete_thenCycle", async () => {
  // upsertTokens → findBySessionId (same row) → deleteBySessionId → findBySessionId (null)
});
```

(이 Phase 는 신규 구현 파일 없음 — Phase 2/3 의 DDL + repo 를 검증하는 통합 테스트 전용.)

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (types)         ── 1-1 test ──→ 1-impl (types.ts 확장)
                                            │
                                            ▼
Phase 2 (repo unit)     ── 2-1..2-7 ──→ 2-impl (user-tokens-repo.ts 확장)
                                            │
Phase 3 (migration)     ── 3-1..3-6 ──→ 3-impl (0009_auth_redesign.sql)
  (Phase 2 와 독립: SQL 은 repo 코드와 런타임 비의존)
                                            │
Phase 4 (RLS integ)     ── 4-1..4-6 (Phase 2 + Phase 3 모두 필요)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1 테스트 | 없음 | - |
| G2 | 1-impl (`lib/supabase/types.ts`) | G1 | - (단일 파일) |
| G3 | 2-1 ~ 2-7 테스트 | G2 | 7개 테스트 병렬 |
| G4 | 2-impl (`lib/supabase/user-tokens-repo.ts`) | G3 | - |
| G5 | 3-1 ~ 3-6 테스트 | 없음 (SQL 스냅샷은 마이그레이션 결과 검증) | 6개 병렬 |
| G6 | 3-impl (`supabase/migrations/0009_auth_redesign.sql`) | G5 | - |
| G7 | 4-1 ~ 4-6 테스트 | G4 + G6 | 6개 병렬 |

> G2/G4 와 G6 는 서로 다른 파일 → **전체적으로 Phase 1+2 와 Phase 3 는 병렬** 가능. Phase 4 는 양쪽 완료 후.

### 종속성 판단 기준 적용
- **종속**: Phase 2 → Phase 1 (repo 가 `UserTokensRow` / `UpsertTokensInput` import). Phase 4 → Phase 2 + Phase 3 (실 DB + 실 repo).
- **독립**: Phase 3 (SQL) 은 Phase 2 (TS) 와 런타임 공유 없음 → 병렬.
- **독립 (plan 간)**: spec § 8 G1 — 본 plan(0018) 은 FR-R2(0019)와 병렬. FR-R3~R7 은 본 plan 완료 후.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | `UserTokensRow` / `UpsertTokensInput` 타입 테스트 | ✅ 완료 | type-level |
| 1-impl | `lib/supabase/types.ts` 확장 | ✅ 완료 | legacy `UserTokenInsert` 유지 |
| 2-1 | `upsertTokens` happy path | ✅ 완료 | fake client |
| 2-2 | `findBySessionId` happy path | ✅ 완료 | |
| 2-3 | `findBySessionId` not found → null | ✅ 완료 | PGRST116 |
| 2-4 | `upsertTokens` 중복 puuid last-write-wins | ✅ 완료 | onConflict:"puuid" |
| 2-5 | DB 에러 전파 | ✅ 완료 | throw |
| 2-6 | `deleteBySessionId` 멱등 | ✅ 완료 | |
| 2-7 | `deleteByPuuid` 성공/에러 | ✅ 완료 | |
| 2-impl | `lib/supabase/user-tokens-repo.ts` 4종 신규 API | ✅ 완료 | 기존 함수 유지 |
| 3-1 | 신규 컬럼 스키마 스냅샷 | ✅ 완료 | integration (env 없음 skip) |
| 3-2 | `rate_limit_buckets` 테이블 생성 | ✅ 완료 | |
| 3-3 | `user_tokens_session_id_idx` 존재 | ✅ 완료 | |
| 3-4 | RLS enable 재확인 | ✅ 완료 | 두 테이블 |
| 3-5 | 컬럼 화이트리스트 (PIPA) | ✅ 완료 | |
| 3-6 | idempotent 재실행 | ✅ 완료 | 수동 smoke 허용 |
| 3-impl | `supabase/migrations/0009_auth_redesign.sql` | ✅ 완료 | spec § 4-4 그대로 |
| 4-1 | anon select 거부 | ✅ 완료 | Security NFR |
| 4-2 | anon insert 거부 | ✅ 완료 | |
| 4-3 | anon `ssid_enc`/`tdid_enc` 거부 | ✅ 완료 | |
| 4-4 | service_role 우회 | ✅ 완료 | |
| 4-5 | `rate_limit_buckets` anon 거부 | ✅ 완료 | |
| 4-6 | repo 왕복 smoke | ✅ 완료 | upsert→find→delete |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
