# Plan 0014: BYTEA_HEX_DECODE_FIX

## 개요
`lib/supabase/user-tokens-repo.ts` 가 PostgREST 의 bytea 직렬화 규약(`\x` 접두사 hex 문자열) 을 인식하지 못해, worker (`lib/worker/check-wishlist.ts`) 의 `decryptTokens` 입력 base64 가 깨진다. 본 plan 은 (1) repo 레벨에서 PostgREST/pg 의 bytea 응답을 명시적으로 base64 정규화하고, (2) `scripts/dev-demo-worker.ts` 가 임시 우회 중인 pg-기반 repo 를 표준 supabase-js 경로로 재통합하며, (3) repo 를 mock 하지 않는 진짜 round-trip 통합 테스트를 도입해 회귀를 막는다.

## 배경 / 문제 정의
- `0001_user_tokens.sql` 에서 `access_token_enc bytea not null` 로 저장 (실제 내용: AES-GCM IV‖ciphertext‖tag 의 raw bytes).
- `aes-gcm.ts#encrypt` 는 base64 문자열을 반환 → 호출처가 `Buffer.from(base64, "base64")` 로 디코드해 raw bytes 로 INSERT 해야 함.
- `user-tokens-repo.get/listActive` 는 `select("*")` 결과를 그대로 `UserTokensRow` 로 캐스트하고, worker 는 `Buffer.from(user.access_token_enc).toString("base64")` 를 호출함.
- 그런데 PostgREST 는 bytea 컬럼을 **`\x` 접두사 hex string** 으로 직렬화함 (예: `\x4855efa3...`).
  - 결과적으로 `user.access_token_enc` 는 `Uint8Array` 가 아니라 `string` ("\\x..." hex).
  - `Buffer.from("\\x4855...")` 는 UTF-8 바이트 변환 → base64 → AES decrypt 단계에서 OperationError (Plan 0011 의 `decryptTokens` 가 throw) → worker 가 사용자별 error 로 카운트.
- `scripts/dev-demo-worker.ts` 의 주석 (L12–15, L102–107) 이 이 임피던스 미스매치를 명시적으로 기록하고 있으며, 이를 우회하기 위해 pg(postgres-js) 기반 repo 를 별도로 재구현 중.
- **회귀 위험**: `tests/critical-path/worker-check-wishlist.test.ts` 는 `userTokensRepo` 자체를 mock 하므로 실제 직렬화 경로를 한 번도 검증하지 않음 (Plan 0008/0011 의 사각지대).

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 문제 위치 | repo 레이어 (어댑터) 에서 정규화 | 단일 책임. worker / cron / 향후 다른 호출처 모두에서 동일한 형태(`Uint8Array`) 보장 (Maintainability NFR) |
| `UserTokensRow.access_token_enc` 타입 | `Uint8Array` 유지 (이미 정의됨) | 도메인 레이어가 문자열 hex 를 다루지 않게 함. 누수 방지 (Security NFR) |
| 정규화 함수 위치 | `lib/supabase/bytea.ts` (신규, 순수 함수) | 단위 테스트 용이. repo/script/test 에서 재사용 |
| 입력 변형 처리 | `\x` hex 문자열, base64 문자열, `Uint8Array`/`Buffer`, `{ type: "Buffer", data: number[] }` 4가지 모두 수용 → `Uint8Array` 반환 | PostgREST(\x hex), pg-node(`Buffer`), supabase-js v2 (driver 버전에 따라 base64 가능), JSON round-trip 테스트 fixture 대응 |
| `\x` 판별 규칙 | `typeof v === "string" && v.startsWith("\\x")` → 짝수 hex 검증 후 `Buffer.from(slice(2), "hex")` | PostgREST 공식 직렬화 규약 |
| base64 판별 규칙 | `\x` 가 아니고 string 이면 base64 로 시도, 디코드 실패시 throw | 명시적 fallback. 잘못된 입력을 silent 로 통과시키지 않음 (Security) |
| 알 수 없는 입력 | `BytEaParseError` (Error 서브클래스) throw, 컬럼명 + 일부 prefix 만 로깅 | 토큰 평문/ciphertext 가 로그에 새지 않도록 (Security NFR) |
| Worker 입력 변환 | worker 는 `Buffer.from(user.access_token_enc).toString("base64")` 유지 (Uint8Array 입력은 정상 동작) | 변경 최소화. repo 가 보장하면 worker 는 신뢰 |
| 통합 테스트 인프라 | local Supabase (`supabase start` → Postgres 54322) 사용. supabase-js + service role | ADR-0006 (Vitest + 실제 Postgres). CI 부재 → 로컬 전제 |
| 통합 테스트 격리 | `vitest` 의 `it.runIf(process.env.SUPABASE_INTEGRATION === "1")` 게이트 + `tests/integration/` 디렉터리 분리 | 일반 `npm test` 에서는 스킵 (Cost/Operability: $0/월, CI 없음). README 에 실행법 명시 (Maintainability) |
| dev-demo-worker pg 우회 제거 여부 | repo 정상화 후 `scripts/dev-demo-worker.ts` 가 표준 `createUserTokensRepo` + supabase-js 를 사용하도록 리팩터 | 두 코드 경로 분기 제거. Maintainability |
| 쓰기 경로 (insert/upsert) 추가 | 본 plan 범위에 `upsert(row)` API 를 repo 에 신규 추가 — bytea 컬럼은 raw `Uint8Array` 가 아니라 **`\x<hex>` 문자열로 직렬화해 전송** (PostgREST 가 raw binary 를 받지 못함) | PostgREST + supabase-js 는 bytea write 시 hex literal 입력만 허용. dev-demo-worker 가 이 패턴을 사용해 표준 경로로 통합 가능해짐 |
| 마이그레이션 / 데이터 변환 | 불필요 — DB 의 byte 표현은 변하지 않음. 코드 측 직렬화만 수정 | 데이터 무결성 유지 |

---

## Phase 1: bytea 정규화 헬퍼 (`lib/supabase/bytea.ts`)

### 테스트 시나리오

#### Test 1-1: PostgREST `\x` hex 문자열을 Uint8Array 로 디코드
```ts
test("given_postgrestHexString_whenParseBytea_thenReturnsRawBytes", () => {
  // Given: "\x48656c6c6f" (PostgREST 직렬화)
  // When: parseBytea(input)
  // Then: Uint8Array([0x48,0x65,0x6c,0x6c,0x6f])
});
```

#### Test 1-2: `\x` prefix 없는 base64 문자열 디코드
```ts
test("given_base64String_whenParseBytea_thenReturnsRawBytes", () => {
  // Given: "SGVsbG8="
  // When: parseBytea(input)
  // Then: Uint8Array([0x48,0x65,0x6c,0x6c,0x6f])
});
```

#### Test 1-3: Buffer/Uint8Array 입력은 그대로 통과
```ts
test("given_uint8Array_whenParseBytea_thenReturnsSameBytes", () => {
  // Given: Uint8Array([0xde,0xad])
  // When: parseBytea(input)
  // Then: Uint8Array([0xde,0xad])
});
```

#### Test 1-4: JSON round-tripped Buffer (`{type:"Buffer",data:[…]}`) 처리
```ts
test("given_jsonBufferShape_whenParseBytea_thenReturnsRawBytes", () => {
  // Given: { type:"Buffer", data:[0x01,0x02] }
  // When: parseBytea(input)
  // Then: Uint8Array([0x01,0x02])
});
```

#### Test 1-5: 홀수 길이 hex / 잘못된 hex 거부
```ts
test("given_invalidHexAfterPrefix_whenParseBytea_thenThrowsBytEaParseError", () => {
  // Given: "\\xZZ" 또는 "\\xabc"
  // When: parseBytea
  // Then: BytEaParseError, 메시지에 "invalid hex"
});
```

#### Test 1-6: 알 수 없는 형태 거부
```ts
test("given_numericInput_whenParseBytea_thenThrowsBytEaParseError", () => {
  // Given: 12345
  // When: parseBytea
  // Then: BytEaParseError
});
```

#### Test 1-7: 에러 메시지에 ciphertext 본문이 포함되지 않음 (Security)
```ts
test("given_invalidInput_whenParseBytea_thenErrorOmitsContent", () => {
  // Given: 200B 길이의 잘못된 hex
  // When: parseBytea(input).catch(e=>e.message)
  // Then: 메시지 길이 ≤ 120자, 입력 prefix 8자 + "..." 만 노출
});
```

#### Test 1-8: encodeBytea — Uint8Array → `\x<hex>` 직렬화
```ts
test("given_uint8Array_whenEncodeBytea_thenReturnsBackslashHexLiteral", () => {
  // Given: Uint8Array([0x48,0x65])
  // When: encodeBytea(input)
  // Then: "\\x4865"
});
```

### 구현 항목

**파일**: `lib/supabase/bytea.ts`
- `export class BytEaParseError extends Error`
- `export function parseBytea(input: unknown, columnLabel?: string): Uint8Array`
- `export function encodeBytea(bytes: Uint8Array): string` — `\x` + hex literal (PostgREST write 용)
- 입력 분기: Uint8Array | Buffer | `\x` hex string | base64 string | `{type:"Buffer",data}` | else throw
- 에러 메시지 sanitization: 입력 prefix 8자만 + label

---

## Phase 2: Repo 어댑터 통합 (`lib/supabase/user-tokens-repo.ts`)

### 테스트 시나리오

#### Test 2-1: 단위 — listActive 가 PostgREST hex 응답을 정규화
```ts
test("given_supabaseReturnsHexBytea_whenListActive_thenRowsHaveUint8ArrayFields", async () => {
  // Given: supabase mock 이 access_token_enc:"\\x4855", refresh_token_enc:"\\x4856", entitlements_jwt_enc:"\\x4857" 반환
  // When: createUserTokensRepo(mock).listActive()
  // Then: rows[0].access_token_enc instanceof Uint8Array && bytes [0x48,0x55]
});
```

#### Test 2-2: 단위 — get 도 동일 정규화
```ts
test("given_supabaseReturnsHexBytea_whenGet_thenFieldsAreUint8Array", async () => {
  // Given/When/Then: 위와 동일하지만 .single() 경로
});
```

#### Test 2-3: 단위 — 잘못된 bytea 응답 시 BytEaParseError 전파
```ts
test("given_invalidBytea_whenGet_thenThrowsBytEaParseError", async () => {
  // Given: access_token_enc:"not-bytea-and-not-base64"
  // When: get()
  // Then: throw BytEaParseError, 컬럼명 "access_token_enc" 포함
});
```

#### Test 2-4: 단위 — upsert 가 Uint8Array 를 `\x<hex>` 로 직렬화해 전송
```ts
test("given_uint8ArrayPayload_whenUpsert_thenSupabaseReceivesHexLiterals", async () => {
  // Given: Uint8Array AES ciphertext bytes
  // When: repo.upsert({ puuid, access_token_enc: bytes, ... })
  // Then: supabase.from().upsert() spy 가 access_token_enc:"\\x..." 형태로 호출됨
});
```

#### Test 2-5: 단위 — markNeedsReauth 회귀 가드 (기존 동작 유지)
```ts
test("given_userId_whenMarkNeedsReauth_thenUpdateCalledWithFlag", async () => {
  // Given: supabase mock
  // When: markNeedsReauth("u1")
  // Then: update({ needs_reauth: true }) called once with eq("user_id","u1")
});
```

### 구현 항목

**파일**: `lib/supabase/user-tokens-repo.ts`
- `UserTokensRepo` 에 `upsert(row: UserTokenInsert): Promise<{ user_id: string }>` 추가 (callback / dev-demo-worker 가 사용)
- `listActive`, `get` 결과 row 의 bytea 3컬럼을 `parseBytea(value, columnName)` 로 변환
- `upsert` 입력의 bytea 3컬럼을 `encodeBytea(bytes)` 로 변환 후 supabase 호출
- `UserTokenInsert` 타입을 `lib/supabase/types.ts` 에 추가 (`expires_at`, `puuid`, `*_enc: Uint8Array`, `needs_reauth?`)

**파일**: `lib/supabase/types.ts`
- `UserTokenInsert` 인터페이스 추가

---

## Phase 3: dev-demo-worker 표준 경로 재통합

### 테스트 시나리오

#### Test 3-1: dev-demo-worker 가 표준 supabase repo 로 happy-path 완주 (수동/skipped, 통합 테스트로 흡수)
> Phase 4 의 통합 테스트가 동일 경로를 자동화하므로 별도 테스트는 추가하지 않고, 스크립트는 Phase 4 통과 후 동작 확인만 수동.

### 구현 항목

**파일**: `scripts/dev-demo-worker.ts`
- `createPgRepos` 제거. `createUserTokensRepo`, `createWishlistRepo`, `createNotificationsRepo` (이미 표준 repo 존재 가정, 없으면 wishlist/notifications 는 pg 유지) 사용
- INSERT 부분도 `userTokensRepo.upsert({ access_token_enc: Buffer.from(accessEnc,"base64"), ... })` 로 교체
- 주석 블록 (L12–15, L102–107) 의 임피던스 미스매치 설명 제거하고 Plan 0014 fix 참조로 대체

---

## Phase 4: 진짜 round-trip 통합 테스트 (`tests/integration/user-tokens-repo.test.ts`)

### 사전 조건 / 인프라
- `supabase start` 로 로컬 Postgres + PostgREST 기동되어 있어야 함
- 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENC_KEY`
- `vitest` describe 블록을 `describe.runIf(process.env.SUPABASE_INTEGRATION === "1")` 로 게이트
- `beforeAll`: 테스트용 puuid prefix `"plan0014-test-"` 로 기존 데이터 cleanup
- `afterAll`: 동일 prefix 의 row 삭제

### 테스트 시나리오

#### Test 4-1: AES 암호문 라운드트립 (핵심 회귀 가드)
```ts
test("given_aesCiphertextWritten_whenReadBack_thenDecryptsToOriginalPlaintext", async () => {
  // Given: 원본 평문 "access-XYZ"/"refresh-XYZ"/"ent-XYZ" 를 aes-gcm.encrypt 로 base64 ciphertext 생성
  //        → Uint8Array 로 디코드해 repo.upsert
  // When: repo.get(userId) 후 Buffer.from(row.access_token_enc).toString("base64") 를 decrypt
  // Then: 원본 평문 3개와 모두 일치
});
```

#### Test 4-2: listActive 에서도 동일하게 라운드트립 성립
```ts
test("given_twoUsersInserted_whenListActive_thenAllBytEaFieldsDecryptable", async () => {
  // Given: 서로 다른 ciphertext 2명 INSERT (needs_reauth=false)
  // When: repo.listActive()
  // Then: 두 row 모두 decrypt 시 원본 일치
});
```

#### Test 4-3: needs_reauth 필터링 (기존 동작 회귀 가드)
```ts
test("given_userMarkedNeedsReauth_whenListActive_thenExcluded", async () => {
  // Given: 2명 INSERT, 1명에 markNeedsReauth
  // When: listActive
  // Then: 1명만 반환
});
```

#### Test 4-4: worker happy-path (`runWorker`) 가 실제 DB 로 1번 notify
```ts
test("given_realDbAndMockedRiotResend_whenRunWorker_thenNotifiedEqualsOne", async () => {
  // Given: upsert 로 시드 + wishlist insert + mock storefront/catalog/resend
  // When: runWorker(deps)
  // Then: result.notified === 1, result.errors === 0
  // 이 테스트가 곧 Plan 0011 + 0014 회귀 가드.
});
```

#### Test 4-5: 동일 worker 2회 실행 시 idempotent (notifications_sent UNIQUE 보호)
```ts
test("given_workerRunTwice_whenSecondRun_thenNotifiedZero", async () => {
  // Given/When/Then: dev-demo-worker 의 idempotency 가정을 자동화
});
```

### 구현 항목

**파일**: `tests/integration/user-tokens-repo.test.ts`
- `describe.runIf(...)` 가드
- `createClient(url, serviceRoleKey)` + `createUserTokensRepo`
- 픽스처 헬퍼: `seedUser({ puuid, plaintexts })`, `cleanup(prefix)`

**파일**: `vitest.config.ts` (이미 존재 가정)
- `test.include` 에 `tests/integration/**/*.test.ts` 추가 (게이트는 describe.runIf 로 처리)

**파일**: `README.md`
- "Integration tests" 섹션 추가: `supabase start && SUPABASE_INTEGRATION=1 npm test` 실행법 명시 (Maintainability NFR)

---

## Phase 5: 회귀 가드 — 단위 테스트의 mock 이 새 계약을 지키도록 보강

### 테스트 시나리오

#### Test 5-1: `worker-check-wishlist.test.ts` 의 mock repo 가 `Uint8Array` 를 반환하도록 fixture 갱신 (이미 그러함을 단언)
```ts
test("given_workerUnitTestFixtures_whenInspect_thenAccessTokenEncIsUint8Array", () => {
  // Given: 테스트 fixture 생성 함수
  // When: 반환 row.access_token_enc 의 타입 확인
  // Then: instanceof Uint8Array (string hex 가 아님)
});
```
> 이 테스트는 향후 누군가 mock 을 `\x...` string 으로 바꿔 단위 테스트가 통합 동작을 잘못 흉내내지 않도록 가드함.

### 구현 항목
**파일**: `tests/critical-path/worker-check-wishlist.test.ts`
- 기존 fixture 의 `access_token_enc` 등이 string 인 경우 `Buffer.from(base64,"base64")` 로 교체
- 위 Test 5-1 추가

---

## NFR 반영

| 카테고리 | 반영 내용 | 연관 테스트 |
|---------|-----------|-------------|
| Performance | `parseBytea` 는 O(N) 단일 패스, 추가 메모리 1회 할당. listActive ~50명 × 3컬럼 × 평균 60B → 무시 가능. p95 ≤ 1s 유지 | 4-2, 4-4 |
| Scale | ~50 동시 유저 × 3 bytea 컬럼 round-trip 검증 | 4-2, 4-4, 4-5 |
| Availability | 잘못된 bytea 응답 시 silent corruption 대신 명시적 throw → worker 가 사용자별 isolate (기존 try/catch) → 99% best-effort 보존 | 2-3 |
| Security | (1) 토큰 평문/ciphertext 가 에러 메시지·로그에 누출되지 않도록 prefix-only sanitization. (2) raw bytes ↔ base64 경로 명확화로 AES-GCM 무결성 검증이 실제 호출됨 | 1-7, 4-1 |
| Compliance | N/A — Riot ToS / PIPA 변동 없음. 데이터 최소수집 정책 그대로 | N/A |
| Operability | 통합 테스트가 `SUPABASE_INTEGRATION=1` 게이트로 옵트인 → 일반 dev 워크플로 영향 0. README 에 실행 절차 문서화 | 4-1, 4-4 |
| Cost | CI 미사용. 통합 테스트는 로컬 Supabase (free) 에서만 실행. Vercel 배포 비용 변동 없음 ($0/월) | 4-1 (게이트 확인) |
| Maintainability | (1) bytea 직렬화 책임을 어댑터로 단일화. (2) dev-demo-worker 의 pg 분기 제거로 코드 경로 1개로 수렴. (3) 통합 테스트 신설 — critical path (로그인 후 토큰 → worker 알림) 의 직렬화 누락 회귀 차단 | 1-1~1-8, 2-1~2-5, 4-1~4-5, 5-1 |

---

## 가정사항
1. 로컬 `supabase start` (Supabase CLI) 가 개발자 머신에서 동작 가능 (ADR-0006 인프라 전제와 동일).
2. 현재 production DB 에 저장된 bytea 데이터는 raw bytes 로 올바르게 저장되어 있고, 단지 **읽기 경로만** 깨져 있다 — 즉 데이터 마이그레이션 불필요. (만약 잘못된 데이터가 저장돼 있었다면 별도 backfill plan 필요. 본 plan 범위 외.)
3. supabase-js v2 가 `from(...).upsert([{ access_token_enc: "\\x..." }])` 형식을 PostgREST 로 그대로 전달함 (PostgREST 의 bytea write 표준).
4. `wishlist-repo` / `notifications-repo` 의 표준 어댑터가 이미 존재하거나, 본 plan 의 Phase 3 에서 dev-demo-worker 는 user_tokens 만 표준 repo 로 전환하고 나머지는 pg 유지 (혼용 허용).
5. 통합 테스트는 CI 가 없으므로 PR 머지 전 작성자 로컬 실행을 신뢰 — `npm run test:integration` 스크립트를 `package.json` 에 추가해 진입점을 단일화한다.
6. `.claude/worktrees/` 하위 사본은 무시 (생성/소유자 책임 외).

---

## 작업 종속성

### 종속성 그래프
```
Phase 1 (bytea 헬퍼)  ──→ Phase 2 (repo 통합)  ──┬──→ Phase 3 (dev-demo-worker 리팩터)
                                                  │
                                                  └──→ Phase 4 (통합 테스트)  ──→ Phase 5 (단위 mock 가드)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3, 1-4, 1-5, 1-6, 1-7, 1-8 테스트 | 없음 | ✅ |
| G2 | 1-impl (`bytea.ts` + `BytEaParseError` + `parseBytea` + `encodeBytea`) | G1 | - |
| G3 | 2-1, 2-2, 2-3, 2-4, 2-5 테스트 | G2 | ✅ |
| G4 | 2-impl (`user-tokens-repo.ts` 정규화 + upsert), `types.ts` (`UserTokenInsert`) | G3 | ✅ (서로 다른 export) |
| G5 | 3-impl (`scripts/dev-demo-worker.ts` 리팩터) | G4 | - |
| G6 | 4-1, 4-2, 4-3, 4-4, 4-5 테스트 + impl (게이트 / fixture 헬퍼 / README) | G4 | ✅ |
| G7 | 5-1 테스트 + `worker-check-wishlist.test.ts` fixture 갱신 | G4 | - |

> G5, G6, G7 은 G4 완료 후 서로 독립 (다른 파일) → 병렬 가능.

### 종속성 판단 기준
- G2 → G3: `parseBytea` 시그니처에 G3 가 의존
- G4 → G5: dev-demo-worker 가 새 `upsert` API 에 의존
- G4 → G6: 통합 테스트가 새 repo 동작 검증
- G4 → G7: 단위 테스트 fixture 가 새 row 타입(Uint8Array) 계약에 맞춰져야 함

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | parseBytea: \x hex → bytes | ✅ 완료 | |
| 1-2 | parseBytea: base64 → bytes | ✅ 완료 | |
| 1-3 | parseBytea: Uint8Array passthrough | ✅ 완료 | |
| 1-4 | parseBytea: JSON Buffer shape | ✅ 완료 | |
| 1-5 | parseBytea: invalid hex 거부 | ✅ 완료 | |
| 1-6 | parseBytea: unknown shape 거부 | ✅ 완료 | |
| 1-7 | parseBytea: 에러 sanitization | ✅ 완료 | Security |
| 1-8 | encodeBytea: bytes → \x hex | ✅ 완료 | |
| 1-impl | `lib/supabase/bytea.ts` 구현 | ✅ 완료 | |
| 2-1 | repo.listActive 정규화 | ✅ 완료 | |
| 2-2 | repo.get 정규화 | ✅ 완료 | |
| 2-3 | repo: invalid bytea 시 BytEaParseError | ✅ 완료 | |
| 2-4 | repo.upsert: Uint8Array → \x hex | ✅ 완료 | |
| 2-5 | repo.markNeedsReauth 회귀 가드 | ✅ 완료 | |
| 2-impl | `user-tokens-repo.ts` + `types.ts` 변경 | ✅ 완료 | |
| 3-impl | `scripts/dev-demo-worker.ts` 표준 repo 로 리팩터 | ✅ 완료 | |
| 4-1 | 통합: AES round-trip (get) | ✅ 완료 | 핵심 회귀 가드 |
| 4-2 | 통합: listActive round-trip (2명) | ✅ 완료 | |
| 4-3 | 통합: needs_reauth 필터링 | ✅ 완료 | |
| 4-4 | 통합: runWorker happy-path | ✅ 완료 | |
| 4-5 | 통합: runWorker 2회 idempotent | ✅ 완료 | |
| 4-impl | 통합 테스트 인프라 + README + npm script | ✅ 완료 | |
| 5-1 | 단위 mock fixture 가 Uint8Array 보장 | ✅ 완료 | |
| 5-impl | `worker-check-wishlist.test.ts` fixture 갱신 | ✅ 완료 | |

**상태 범례**: ✅ 완료 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
