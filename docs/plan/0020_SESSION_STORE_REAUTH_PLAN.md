# Plan 0020: SESSION_STORE_REAUTH

## 개요
`lib/session/` 을 **세션 라이프사이클(store) + ssid 재인증(reauth) + MFA 중간상태(pending-jar) + 이중키 crypto** 4개 축으로 재조직한다. spec `2026-04-24-auth-redesign-design.md` § 4-3 재방문 flow 5분기(miss/session-expired/fresh/near-expiry-reauth-ok/reauth-fail)를 코드 문서화 수준으로 명시하고 단위 테스트 1:1 매핑한다. `TOKEN_ENC_KEY`(DB 토큰 컬럼) 와 `PENDING_ENC_KEY`(auth_pending cookie) 를 분리해 키 유출 blast radius 를 최소화한다. 복호화 실패는 `throw` 대신 `null` 반환으로 정규화해 공격 탐지 시그널(warn 로그)과 정상 플로우(재로그인 유도)를 구분한다. 본 plan 은 FR-R4 route handler 가 소비할 상위 API 계약(`createSession`, `resolve`, `destroy`, `encodePendingJar`, `decodePendingJar`) 을 확정한다.

## 설계 결정사항

| 항목 | 결정 | 근거 (NFR 카테고리) |
|------|------|---------------------|
| session_id 생성 | `crypto.randomUUID()` (UUIDv4, Web Crypto 내장) | Security (122bit entropy) · Cost ($0) |
| session TTL | 14일 (1209600s). `session_expires_at = now + TTL` at upsert | Operability (spec § 4-4) · UX (재로그인 주기) |
| resolve() 분기 순서 | 1) row miss 2) session_expires_at ≤ now 3) access_expires_at > now+60s 4) reauthWithSsid 성공 5) reauth 실패 처리 | Maintainability (spec § 4-3 과 1:1), Performance (fast-path fresh 만 DB 1-hop) |
| near-expiry 임계 | **60s 여유**. `access_expires_at <= now+60s` 면 reauth 트리거 | Availability (클라이언트 요청 중 만료 회피) |
| reauth 5xx 정책 | Riot 5xx/timeout & 기존 access_token 이 아직 유효(> now) → **optimistic 반환 + warn 로그** | Availability (spec § 4-3 "5xx & access 유효 → 기존 반환") |
| reauth auth_failure | ssid invalid → **row 삭제 + null 반환** | Security (stale 토큰 즉시 폐기), spec § 4-3 |
| reauth ok 후 DB update | `access_token_enc`, `entitlements_enc`, `access_expires_at`, (필요 시 rotated `ssid_enc`) UPDATE — last-write-wins | Scale (spec § 9 race 수용) |
| resolve 동시성 | **advisory lock 미도입**. 같은 session_id 의 2 reauth 요청 중 1 실패는 상위 retry 로 수용 | Scale (spec § 9) · Maintainability (MVP 단순성) |
| pending-jar 형식 | `AES-GCM_PENDING(JSON.stringify({jar, username, exp}))` — exp 내장 | Security (§ 6 stateless, 10분 TTL) |
| pending-jar 실패 처리 | 복호화 실패/exp 만료 → `null` 반환 (throw 금지) | Security (공격자 throw pattern oracle 차단), Operability (warn 로그 분리) |
| crypto 키 분리 | `TOKEN_ENC_KEY` / `PENDING_ENC_KEY` 두 env, 캐시 2개 | Security (ADR-0002 개정 · spec § 4-6) |
| crypto 복호화 에러 반환 | `decryptWithKey(ct, key): Promise<string \| null>` — auth tag 실패/bad key 시 null. 단, **환경변수 부재는 throw** (config error vs data error 구분) | Security (null = 데이터 무결성 실패, throw = 시스템 설정 오류), Operability (log level 구분) |
| 기존 `SessionPayload` 소유권 | **본 plan 이 소유**. `refreshToken` 필드 제거, spec § 4-4 스키마와 정렬 (이전 plan 0002/0011 의 cookie payload 모델은 더 이상 cookie 에 실리지 않음 — session_id 불투명 cookie 로 전환) | Maintainability (cross-plan 계약) |
| `ResolvedSession` 타입 | `{ puuid, accessToken, entitlementsJwt, region, accessExpiresAt }` — `ssid` 는 외부 노출 금지 | Security (ssid 는 store 내부 컨텍스트에서만 사용) |
| DB 접근 | `lib/supabase/user-tokens-repo.ts` 의 `upsertTokens`/`findBySessionId`/`deleteBySessionId`/`deleteByPuuid` (plan 0018) service_role 경유만 | Security (§ 6 · ADR-0002 개정) |
| reauth 호출 대상 | `lib/riot/auth-client.ts` 의 `reauthWithSsid(ssid, tdid?)` (plan 0019) — `{kind:"ok"\|"expired"\|"upstream"}` | Maintainability (cross-plan 계약) |
| 로그 masking | `session_id[:8]`, `puuid[:8]` prefix 만 기록. ssid/access_token 절대 미출력 | Security · Operability (§ 6) |
| 테스트 DB | 실 Supabase test project (wishlist RLS 테스트 패턴 재사용). env `SUPABASE_TEST_URL/KEY` | Compliance (운영 DB 미오염) |

---

## Phase 1: crypto.ts 확장 (이중 키 + null 반환)

### 테스트 시나리오

#### Test 1-1: TOKEN_ENC_KEY 왕복
```ts
test("given_tokenKey_whenEncryptThenDecryptWithSameKey_thenReturnsPlaintext", async () => {
  // Given: TOKEN_ENC_KEY 설정, 평문 "hello"
  // When: encryptWithKey(pt, tokenKey) → decryptWithKey(ct, tokenKey)
  // Then: "hello" 반환
});
```

#### Test 1-2: PENDING_ENC_KEY 왕복 (독립 캐시)
```ts
test("given_pendingKey_whenEncryptThenDecryptWithSameKey_thenReturnsPlaintext", async () => {
  // Given: PENDING_ENC_KEY 설정
  // When: pending key 로 암/복호화
  // Then: 원문 반환 (TOKEN 캐시와 섞이지 않음)
});
```

#### Test 1-3: 키 교차 복호화 실패 → null
```ts
test("given_ciphertextFromTokenKey_whenDecryptWithPendingKey_thenReturnsNull", async () => {
  // Given: tokenKey 로 암호화된 ct
  // When: decryptWithKey(ct, pendingKey)
  // Then: null (throw 금지) — GCM auth tag 실패
});
```

#### Test 1-4: tampered ciphertext → null
```ts
test("given_tamperedCiphertext_whenDecryptWithKey_thenReturnsNull", async () => {
  // Given: 정상 ct 의 마지막 바이트 flip
  // When: decryptWithKey
  // Then: null
});
```

#### Test 1-5: TOKEN_ENC_KEY env 부재 → throw
```ts
test("given_missingTokenEncKey_whenGetTokenKey_thenThrowsConfigError", async () => {
  // Given: delete process.env.TOKEN_ENC_KEY; resetAllKeyCachesForTest()
  // When: getTokenKey()
  // Then: throw Error(/TOKEN_ENC_KEY/) — config error 는 throw 유지
});
```

#### Test 1-6: PENDING_ENC_KEY env 부재 → throw
```ts
test("given_missingPendingEncKey_whenGetPendingKey_thenThrowsConfigError", async () => {
  // Given: delete process.env.PENDING_ENC_KEY
  // When: getPendingKey()
  // Then: throw Error(/PENDING_ENC_KEY/)
});
```

#### Test 1-7: 키 캐싱 독립성
```ts
test("given_bothKeysConfigured_whenGetCalledTwice_thenEachKeyCachedIndependently", async () => {
  // Given: 두 env 설정
  // When: getTokenKey() 2회, getPendingKey() 2회
  // Then: 동일 참조 반환 (key import 는 각 1회)
});
```

#### Test 1-8: 기존 `encryptSession`/`decryptSession` 하위호환
```ts
test("given_existingSessionApi_whenEncryptAndDecrypt_thenStillWorksAgainstTokenKey", async () => {
  // Given: 기존 SessionPayload
  // When: encryptSession → decryptSession
  // Then: 원본 반환 (plan 0011 회귀 없음)
});
```

### 구현 항목

**파일**: `lib/session/crypto.ts` (수정/확장)
- `getTokenKey(): Promise<CryptoKey>` — `TOKEN_ENC_KEY` 로드 + 모듈 캐시. 기존 `getSessionKey` 는 `getTokenKey` 의 deprecated alias 로 유지(호출부 점진 이관).
- `getPendingKey(): Promise<CryptoKey>` — `PENDING_ENC_KEY` 로드 + 모듈 캐시.
- `encryptWithKey(plaintext: string, key: CryptoKey): Promise<string>` — `encrypt()` 위임.
- `decryptWithKey(ciphertext: string, key: CryptoKey): Promise<string | null>` — GCM 실패/bad input 을 catch → null. JSON parse 는 호출부 책임.
- `resetAllKeyCachesForTest()` — 기존 `resetKeyCacheForTest()` 확장, 두 키 캐시 모두 invalidate. NODE_ENV guard 유지.
- `encryptSession`/`decryptSession`/`isSessionExpired` 기존 시그니처 유지(회귀 금지) — 내부적으로 `getTokenKey` 사용.

**파일**: `lib/session/types.ts` (수정)
- `SessionPayload` 유지 (plan 0011 쿠키 페이로드 하위 호환). 단 주석에 "세션 쿠키 재설계 이후 DB row 기반 `ResolvedSession` 선호" 명시.
- `ResolvedSession` 신규 export — 아래 Phase 2 에서 정의.

---

## Phase 2: lib/session/store.ts (createSession / resolve / destroy)

### 테스트 시나리오

#### Test 2-1: createSession happy
```ts
test("given_puuidAndTokens_whenCreateSession_thenUpsertsRowAndReturnsUuid", async () => {
  // Given: 신규 puuid, tokens 번들 (access, entitlements, ssid, expiresIn=3600)
  // When: createSession(puuid, tokens)
  // Then: { sessionId:<uuidv4>, maxAge:1209600 }. DB row 에 세 컬럼 암호화되어 저장. session_expires_at = now+14d.
});
```

#### Test 2-2: createSession 중복 puuid → 덮어쓰기
```ts
test("given_existingPuuidRow_whenCreateSessionAgain_thenReplacesRowWithNewSessionId", async () => {
  // Given: 동일 puuid 로 이미 row 존재 (old session_id)
  // When: createSession 재호출
  // Then: old session_id 로 findBySessionId 는 null, 새 session_id 로만 조회 가능 (1 puuid = 1 active session, spec § 10)
});
```

#### Test 2-3: resolve - row miss
```ts
test("given_unknownSessionId_whenResolve_thenReturnsNull", async () => {
  // Given: DB 에 없는 uuid
  // When: resolve(uuid)
  // Then: null. reauth 호출 0회.
});
```

#### Test 2-4: resolve - session_expires_at 만료
```ts
test("given_sessionExpiredRow_whenResolve_thenDeletesRowAndReturnsNull", async () => {
  // Given: session_expires_at = now-1
  // When: resolve
  // Then: null + deleteBySessionId 호출. reauth 미호출.
});
```

#### Test 2-5: resolve - fresh (access 유효)
```ts
test("given_freshAccessToken_whenResolve_thenReturnsDecryptedTokensWithoutReauth", async () => {
  // Given: access_expires_at = now+600
  // When: resolve
  // Then: ResolvedSession 반환. reauth 호출 0회. DB write 0회 (read-only fast path).
});
```

#### Test 2-6: resolve - near-expiry reauth ok
```ts
test("given_nearExpiryRow_whenResolveAndReauthSucceeds_thenUpdatesRowAndReturnsFreshTokens", async () => {
  // Given: access_expires_at = now+30 (60s 임계 이하), reauthWithSsid mock → {kind:"ok", accessToken, expiresIn:3600}
  // When: resolve
  // Then: 새 access 로 UPDATE 후 ResolvedSession.accessToken = 새 토큰. entitlements 재교환 포함.
});
```

#### Test 2-7: resolve - reauth auth_failure
```ts
test("given_nearExpiryRow_whenReauthReturnsExpired_thenDeletesRowAndReturnsNull", async () => {
  // Given: reauthWithSsid mock → {kind:"expired"}
  // When: resolve
  // Then: null + deleteBySessionId 호출 (stale ssid 폐기).
});
```

#### Test 2-8: resolve - reauth upstream & access still valid → optimistic
```ts
test("given_reauthReturns5xxButAccessStillValid_whenResolve_thenReturnsExistingTokensWithWarn", async () => {
  // Given: access_expires_at = now+45 (임계 이하지만 > now), reauth mock → {kind:"upstream"}
  // When: resolve
  // Then: 기존 access 반환 (null 아님). logger.warn 호출 확인. DB update 없음.
});
```

#### Test 2-9: resolve - reauth upstream & access expired → null
```ts
test("given_reauthReturns5xxAndAccessExpired_whenResolve_thenReturnsNull", async () => {
  // Given: access_expires_at = now-10, reauth mock → {kind:"upstream"}
  // When: resolve
  // Then: null (optimistic 반환 불가). row 는 유지 (일시장애 가정, destroy 는 auth_failure 일 때만).
});
```

#### Test 2-10: destroy
```ts
test("given_existingSessionId_whenDestroy_thenDeletesRow", async () => {
  // Given: DB row 존재
  // When: destroy(sessionId)
  // Then: findBySessionId → null. idempotent (두 번 호출해도 throw 없음).
});
```

#### Test 2-11: 로그 masking 검증
```ts
test("given_resolveCall_whenLogged_thenOnlyPrefixesAppear", async () => {
  // Given: logger spy
  // When: resolve / reauth / destroy
  // Then: session_id prefix 8자 + puuid prefix 8자만 기록. 전체 uuid/ssid/accessToken 부재.
});
```

### 구현 항목

**파일**: `lib/session/types.ts` (확장)
- `ResolvedSession = { puuid; accessToken; entitlementsJwt; region; accessExpiresAt: number }` — ssid 미포함.
- `SessionTokens = { accessToken; entitlementsJwt; ssid; tdid?: string; region: string; accessExpiresIn: number }` — createSession 입력 DTO.

**파일**: `lib/session/store.ts` (신규)
- `createSession(puuid: string, tokens: SessionTokens): Promise<{sessionId: string; maxAge: number}>` — `crypto.randomUUID()` 발급, `upsertTokens(puuid, {...encrypted, session_id, session_expires_at})` 호출. maxAge = 14d(1209600).
- `resolve(sessionId: string): Promise<ResolvedSession | null>` — 5분기 로직(위 테스트와 1:1). 내부에서 `reauth.ts` 의 `reauthAccess()` 호출.
- `destroy(sessionId: string): Promise<void>` — `deleteBySessionId` 위임, idempotent.
- 내부 helper `decryptRow(row): DecryptedRow | null` — TOKEN_ENC_KEY 로 3개 컬럼 복호화. 하나라도 null 이면 row 삭제 + 경고.

**의존 import**:
- `@/lib/supabase/user-tokens-repo` (plan 0018)
- `@/lib/session/reauth` (Phase 3)
- `@/lib/session/crypto`
- `@/lib/logger` (plan 0024 예정; 없으면 console.warn 임시 — 이 plan 에서는 정의되어 있다고 가정)

---

## Phase 3: lib/session/reauth.ts

### 테스트 시나리오

#### Test 3-1: reauthAccess ok
```ts
test("given_validSsid_whenReauthAccess_thenReturnsNewAccessAndEntitlements", async () => {
  // Given: reauthWithSsid mock → {kind:"ok", accessToken, expiresIn:3600}, exchangeEntitlements mock → jwt
  // When: reauthAccess(ssid, tdid, region)
  // Then: {kind:"ok", accessToken, entitlementsJwt, accessExpiresAt}
});
```

#### Test 3-2: reauthAccess expired
```ts
test("given_invalidSsid_whenReauthAccess_thenReturnsExpired", async () => {
  // Given: reauthWithSsid mock → {kind:"expired"}
  // When: reauthAccess
  // Then: {kind:"expired"} (entitlements 호출 0회)
});
```

#### Test 3-3: reauthAccess upstream
```ts
test("given_riot5xx_whenReauthAccess_thenReturnsUpstream", async () => {
  // Given: reauthWithSsid mock → {kind:"upstream"}
  // When: reauthAccess
  // Then: {kind:"upstream"}
});
```

#### Test 3-4: entitlements 재교환 실패 → upstream 정규화
```ts
test("given_accessOkButEntitlementsFails_whenReauthAccess_thenReturnsUpstream", async () => {
  // Given: reauth ok, exchangeEntitlements throw
  // When: reauthAccess
  // Then: {kind:"upstream"} (Availability: store 상위에서 optimistic 경로 살림)
});
```

#### Test 3-5: 3s 예산
```ts
test("given_slowRiot_whenReauthAccess_thenAbortsAt3s", async () => {
  // Given: fetcher 가 5s delay
  // When: reauthAccess
  // Then: {kind:"upstream"} 이 3s 이내 반환 (AbortController)
});
```

### 구현 항목

**파일**: `lib/session/reauth.ts` (신규)
- `type ReauthResult = {kind:"ok"; accessToken: string; entitlementsJwt: string; accessExpiresAt: number} | {kind:"expired"} | {kind:"upstream"}`
- `reauthAccess(ssid: string, tdid: string | null, region: string): Promise<ReauthResult>`
  - plan 0019 `reauthWithSsid(ssid, tdid)` 호출 → kind 분기
  - ok → `exchangeEntitlements(accessToken)` 호출, 실패 시 upstream 으로 정규화
  - `accessExpiresAt = Math.floor(Date.now()/1000) + expiresIn`
- store.ts 가 유일한 caller.

---

## Phase 4: lib/session/pending-jar.ts

### 테스트 시나리오

#### Test 4-1: 왕복
```ts
test("given_jarAndUsername_whenEncodeThenDecode_thenReturnsOriginal", async () => {
  // Given: { jar: [{name:"asid",value:"x"}], username:"user@x"}
  // When: blob = await encodePendingJar(jar, username); decoded = await decodePendingJar(blob)
  // Then: decoded.jar deep-equal, decoded.username = "user@x"
});
```

#### Test 4-2: 10분 TTL 만료
```ts
test("given_blobOlderThan10min_whenDecodePendingJar_thenReturnsNull", async () => {
  // Given: exp = now-1
  // When: decodePendingJar
  // Then: null (expired, warn 로그)
});
```

#### Test 4-3: PENDING_ENC_KEY 와 TOKEN_ENC_KEY 섞임 → null
```ts
test("given_blobEncryptedWithTokenKey_whenDecodePendingJar_thenReturnsNull", async () => {
  // Given: tokenKey 로 encrypt 한 blob 을 decodePendingJar 에 주입
  // When: decodePendingJar
  // Then: null (키 분리 확인)
});
```

#### Test 4-4: tampered blob → null
```ts
test("given_tamperedBlob_whenDecodePendingJar_thenReturnsNull", async () => {
  // Given: 정상 blob 의 1바이트 변조
  // When: decodePendingJar
  // Then: null
});
```

#### Test 4-5: exp 필드 누락 → null
```ts
test("given_blobWithoutExp_whenDecodePendingJar_thenReturnsNull", async () => {
  // Given: 구버전 blob (exp 없음)
  // When: decodePendingJar
  // Then: null (구조 검증)
});
```

#### Test 4-6: 크기 제약 (4KB 이내)
```ts
test("given_realisticJar_whenEncodePendingJar_thenBlobUnder4KB", async () => {
  // Given: asid+clid+tdid+ssid 4개 쿠키 각 ~200B
  // When: encodePendingJar
  // Then: base64 blob.length < 4096
});
```

### 구현 항목

**파일**: `lib/session/pending-jar.ts` (신규)
- `type PendingCookie = { name: string; value: string; domain?: string; path?: string }`
- `type PendingJar = PendingCookie[]`
- `encodePendingJar(jar: PendingJar, username: string): Promise<string>`
  - payload = `{ jar, username, exp: Math.floor(Date.now()/1000) + 600 }`
  - `encryptWithKey(JSON.stringify(payload), getPendingKey())`
- `decodePendingJar(blob: string): Promise<{jar: PendingJar; username: string} | null>`
  - `decryptWithKey(blob, getPendingKey())` → null propagate
  - JSON.parse try/catch → null
  - 구조 검증(jar array, username string, exp number) → fail 시 null
  - `exp > now` 체크 → fail 시 null
- TTL 상수 `PENDING_JAR_TTL_SEC = 600` export.

---

## Phase 5: 통합 테스트 (실 Supabase 사이클)

### 테스트 시나리오

#### Test 5-1: create → resolve(fresh) → destroy 사이클
```ts
test("given_realSupabase_whenCreateResolveDestroy_thenStateTransitionsCorrectly", async () => {
  // Given: SUPABASE_TEST_URL/KEY 환경, fake Riot reauth mock (불필요 — fresh path 만 검증)
  // When:
  //   1) createSession(puuid, tokens w/ accessExpiresIn=3600)
  //   2) resolve(sessionId) — fresh path
  //   3) destroy(sessionId)
  //   4) resolve(sessionId) — null
  // Then: 2) ResolvedSession.puuid === puuid, 4) null
});
```

#### Test 5-2: resolve - reauth ok 통합 (reauth 만 mock)
```ts
test("given_realDbWithNearExpiryRow_whenResolveTriggersReauth_thenRowUpdatedInDb", async () => {
  // Given: upsertTokens 로 access_expires_at = now+30 직접 삽입. reauthWithSsid mock → ok.
  // When: resolve
  // Then: DB 재조회 시 access_expires_at > now+3000, accessToken 암호화값 변경 확인.
});
```

### 구현 항목

**파일**: `tests/integration/session-store.test.ts` (신규)
- 상단 skip gate: `SUPABASE_TEST_URL` 부재 시 `describe.skip`.
- afterEach 에서 `deleteByPuuid(testPuuid)` cleanup.
- spec § 4-3 의 "한 사이클" 검증에 집중, 분기별 단위는 Phase 2 에서 이미 커버.

---

## 작업 종속성

### 종속성 그래프
```
Phase 1 (crypto 이중키)
 ├─ 1-1..1-8 테스트 ──→ 1-impl (lib/session/crypto.ts 확장)
 │
 ▼
Phase 2 (store)                 Phase 3 (reauth)                  Phase 4 (pending-jar)
 ├─ 2-1..2-11 테스트             ├─ 3-1..3-5 테스트                ├─ 4-1..4-6 테스트
 │  └─ 2-impl (store.ts)        │  └─ 3-impl (reauth.ts)          │  └─ 4-impl (pending-jar.ts)
 │     └─ depends on Phase 3    │                                 │
 │                               │                                 │
 └──┬───────────┬────────────────┘                                 │
    │           │ (store imports reauth)                           │
    ▼           ▼                                                   │
Phase 5 (통합) ── 5-1, 5-2 테스트 ── needs real Supabase ◄──────────┘
                                    (pending-jar 는 독립 경로)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3, 1-4, 1-5, 1-6, 1-7, 1-8 테스트 | 없음 | ✅ |
| G2 | 1-impl (`lib/session/crypto.ts` 확장) | G1 | - |
| G3a | 3-1..3-5 테스트 | G2 | ✅ |
| G3b | 4-1..4-6 테스트 | G2 | ✅ (G3a 와 별개 파일) |
| G4a | 3-impl (`lib/session/reauth.ts`) | G3a | - |
| G4b | 4-impl (`lib/session/pending-jar.ts`) | G3b | ✅ (G4a 와 독립) |
| G5 | 2-1..2-11 테스트 | G4a (reauth 시그니처 필요) | ✅ |
| G6 | 2-impl (`lib/session/store.ts`) | G5 | - |
| G7 | 5-1, 5-2 통합 테스트 + 실행 | G4a, G4b, G6 | - (실 Supabase I/O 직렬화) |

### 종속성 판단 기준
- Phase 1 은 모든 후속 phase 의 import 기반 → 반드시 선행.
- Phase 3 (reauth) 은 Phase 2 (store) 가 import → reauth 구현/시그니처 확정 후 store 테스트 작성.
- Phase 4 (pending-jar) 는 store/reauth 와 무관 → Phase 1 이후 병렬 가능.
- Phase 5 통합은 모든 런타임 코드 완성 후.

---

## NFR 반영

| 카테고리 | 반영 내용 | 관련 테스트 |
|---------|----------|-------------|
| Performance | `resolve()` fresh path 는 DB 1-hop + AES-GCM decrypt 3회 (µs). p95 ≤ 200ms 목표. reauth 발동 시 Riot 2 hop(authorize + entitlements) 3s 예산, AbortController 로 하드컷. crypto 키 캐시로 importKey 비용 제거. | 2-5 (fresh 0 DB write), 3-5 (3s 예산), 1-7 (키 캐시) |
| Scale | stateless store (row 단위). 동시 reauth race 는 last-write-wins 수용(spec § 9). 14d TTL row 단순 delete 로 정리, GC cron 불필요. | 2-2 (중복 upsert), 문서 § 설계결정 "resolve 동시성" |
| Availability | Riot 5xx/timeout & access_token 유효 시 optimistic 반환 (spec § 4-3). entitlements 재교환 실패는 upstream 으로 강등해 상위 optimistic 경로에 합류. reauth 3s timeout 으로 요청 stall 방지. | 2-8 (optimistic), 2-9 (expired + upstream), 3-4 (entitlements 실패 정규화), 3-5 (3s) |
| Security | AES-256-GCM, IV 12B 랜덤(기존 primitive). **TOKEN_ENC_KEY vs PENDING_ENC_KEY 키 분리** — 한쪽 유출이 다른 쪽을 감염시키지 않음. service_role key 만 DB 접근 (repo 계층 책임). 복호화 실패 시 null 반환으로 oracle 방지 + warn 로그로 공격 탐지. ssid 는 `ResolvedSession` 밖으로 유출 금지. session_id UUIDv4 122bit entropy. | 1-3 (키 교차 null), 1-4 (tampered null), 4-3 (키 섞임 null), 4-4 (tampered null), 2-11 (masking) |
| Compliance | PUUID 외 PII (이메일 본체, 이름) 저장 금지 — pending-jar 에 username 저장하지만 cookie 내 클라이언트 보관만, 서버 persist X. PRD § 6 PIPA 최소수집. | 4-1 (username 은 pending 만), 설계결정 "로그 masking" |
| Operability | `session_id[:8]` + `puuid[:8]` prefix masking 으로 운영 로그 유용성 확보. config 오류(env 부재)는 throw, 데이터 오류(복호화 실패)는 null — 로그 severity 구분. 키 rotate 시 전 유저 재로그인 강제 수용(알려진 제약 § 9). | 2-11 (masking), 1-5/1-6 (config throw), 1-3/1-4 (data null) |
| Cost | Supabase free tier + Web Crypto 내장. 외부 의존/vendor $0. rate_limit_buckets (spec § 4-4) 는 FR-R4 소관, 본 plan 비포함. | 설계결정 전반 |
| Maintainability | `resolve()` 5분기가 테스트 2-3/2-4/2-5/2-6~7/2-8~9 에 1:1 매핑되어 코드 문서화 자립. 기존 `SessionPayload`/`encryptSession` 시그니처 유지(plan 0011 회귀 금지), 새 API (`ResolvedSession`, `getTokenKey`/`getPendingKey`) 추가 전용. pending-jar 는 단일 책임 모듈로 store 와 분리 — MFA flow 변경이 세션 코드에 파급 금지. | 1-8 (plan 0011 하위호환), Phase 분리 |

---

## 가정사항

1. **plan 0018 의 `user_tokens` 스키마** (`session_id`, `session_expires_at`, `ssid_enc`, `tdid_enc`, `access_token_enc`, `entitlements_enc`, `access_expires_at`, `region`, `puuid`) 가 본 plan 실행 시점에 마이그레이션 적용 완료된 상태다. 컬럼명은 spec § 4-4 와 일치.
2. **plan 0019 의 `reauthWithSsid(ssid: string, tdid: string | null): Promise<{kind:"ok"; accessToken: string; expiresIn: number} | {kind:"expired"} | {kind:"upstream"}>`** 계약을 그대로 소비한다. entitlements 재교환은 본 plan 책임(§ Phase 3).
3. **`exchangeEntitlements(accessToken): Promise<string>`** 이 `lib/riot/auth-client.ts` (plan 0019) 에 이미 정의되어 있다 — spec § 4-1 에 따라 auth.ts 에서 이관된 상태.
4. **env 변수**: `TOKEN_ENC_KEY`, `PENDING_ENC_KEY` 는 Vercel Env Vars (Production/Preview/Development 분리) 에 32B base64 로 사전 설정. 로컬 테스트는 `.env.test` 고정 fixture.
5. **`lib/logger.ts`** 는 plan 0024(FR-R7) 에서 완성되지만, 본 plan 단계에서는 최소한의 `logger.warn/info` 스텁이 사용 가능하다고 가정. 없다면 임시 `console.warn` 으로 구현 후 plan 0024 에서 치환.
6. **세션 TTL 14일**은 Riot ssid 유효기간(수주~수개월 관찰값) 하한 근처로 설정. 더 짧으면 재로그인 UX 저하, 더 길면 stale ssid 축적. spec 에 고정치 없어 본 plan 에서 확정.
7. **`SessionPayload` 는 plan 0011 에서 세션 쿠키 payload** 로 쓰였지만, 본 spec 재설계 후 cookie 는 불투명 session_id 만 담는다. 따라서 `SessionPayload` 자체는 deprecated 경로이며, `ResolvedSession` 이 런타임 주요 타입. 타입 제거는 FR-R4 route handler 이관 이후 plan 0024 에서 처리.
8. **동시성 race** (같은 session_id 2 동시 reauth) 는 spec § 9 에 따라 수용. 한 요청이 성공하면 ssid rotate 로 다른 요청이 `{kind:"expired"}` 를 받을 수 있으며, 이 경우 row 삭제되어 유저에게 재로그인 화면 1회 노출됨 — MVP 허용 범위.
9. **통합 테스트 (Phase 5)** 는 `SUPABASE_TEST_URL/SUPABASE_TEST_SERVICE_ROLE_KEY` 부재 시 자동 skip. CI 환경 미구성 시 단위 테스트만으로 정확성 검증.
10. **`createSession` 시 기존 puuid row 삭제(덮어쓰기)** 로 1 puuid = 1 active session 을 보장 (spec § 10 non-goal: 다중 세션 미지원). `upsertTokens` 의 `on conflict (puuid) do update` 전략 사용.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | TOKEN 키 왕복 테스트 | ⬜ 미착수 | |
| 1-2 | PENDING 키 왕복 테스트 | ⬜ 미착수 | |
| 1-3 | 키 교차 null 테스트 | ⬜ 미착수 | |
| 1-4 | tampered null 테스트 | ⬜ 미착수 | |
| 1-5 | TOKEN_ENC_KEY 부재 throw 테스트 | ⬜ 미착수 | |
| 1-6 | PENDING_ENC_KEY 부재 throw 테스트 | ⬜ 미착수 | |
| 1-7 | 두 키 캐시 독립 테스트 | ⬜ 미착수 | |
| 1-8 | 기존 encryptSession 하위호환 테스트 | ⬜ 미착수 | |
| 1-impl | `lib/session/crypto.ts` 이중 키 확장 | ⬜ 미착수 | |
| 3-1 | reauthAccess ok 테스트 | ⬜ 미착수 | |
| 3-2 | reauthAccess expired 테스트 | ⬜ 미착수 | |
| 3-3 | reauthAccess upstream 테스트 | ⬜ 미착수 | |
| 3-4 | entitlements 실패 → upstream 정규화 테스트 | ⬜ 미착수 | |
| 3-5 | 3s 예산 abort 테스트 | ⬜ 미착수 | |
| 3-impl | `lib/session/reauth.ts` 구현 | ⬜ 미착수 | |
| 4-1 | pending-jar 왕복 테스트 | ⬜ 미착수 | |
| 4-2 | pending-jar 10분 만료 테스트 | ⬜ 미착수 | |
| 4-3 | pending-jar 키 섞임 null 테스트 | ⬜ 미착수 | |
| 4-4 | pending-jar tampered null 테스트 | ⬜ 미착수 | |
| 4-5 | pending-jar exp 누락 null 테스트 | ⬜ 미착수 | |
| 4-6 | pending-jar 4KB 크기 테스트 | ⬜ 미착수 | |
| 4-impl | `lib/session/pending-jar.ts` 구현 | ⬜ 미착수 | |
| 2-1 | createSession happy 테스트 | ⬜ 미착수 | |
| 2-2 | createSession 덮어쓰기 테스트 | ⬜ 미착수 | |
| 2-3 | resolve row miss 테스트 | ⬜ 미착수 | |
| 2-4 | resolve session 만료 테스트 | ⬜ 미착수 | |
| 2-5 | resolve fresh 테스트 | ⬜ 미착수 | |
| 2-6 | resolve near-expiry reauth ok 테스트 | ⬜ 미착수 | |
| 2-7 | resolve reauth expired 테스트 | ⬜ 미착수 | |
| 2-8 | resolve upstream + access 유효 optimistic 테스트 | ⬜ 미착수 | |
| 2-9 | resolve upstream + access 만료 null 테스트 | ⬜ 미착수 | |
| 2-10 | destroy idempotent 테스트 | ⬜ 미착수 | |
| 2-11 | 로그 masking 테스트 | ⬜ 미착수 | |
| 2-impl | `lib/session/store.ts` 구현 + `types.ts` ResolvedSession/SessionTokens 추가 | ⬜ 미착수 | |
| 5-1 | 실 Supabase create→resolve→destroy 사이클 | ⬜ 미착수 | SUPABASE_TEST_URL 부재 시 skip |
| 5-2 | 실 DB near-expiry reauth update 통합 | ⬜ 미착수 | reauth mock 필요 |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
