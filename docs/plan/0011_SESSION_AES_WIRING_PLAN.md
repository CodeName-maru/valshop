# Plan 0011: SESSION_AES_WIRING

## 개요
`lib/session/cookie.ts`(빌더), `lib/auth/cookie.ts`(리더), `lib/session/guard.ts`(가드)가 현재 `Buffer.from(JSON.stringify(...)).toString("base64")` 평문 스텁을 사용 중이다. 이미 구현된 `lib/crypto/aes-gcm.ts` 를 `TOKEN_ENC_KEY` 환경변수 기반으로 배선해 **세션 쿠키를 AES-GCM 로 암/복호화**하도록 교체한다. PRD §6 Security NFR ("RSO 토큰 AES 암호화") 및 ADR-0002 하이브리드 정책을 충족하고, 기존 평문 쿠키 소지자 재방문 시 graceful 실패(재로그인 유도)를 보장한다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 암호화 알고리즘 | AES-256-GCM (Web Crypto) | ADR-0002 + Security NFR. 기존 `lib/crypto/aes-gcm.ts` 재사용 |
| 키 주입 경로 | `TOKEN_ENC_KEY` 환경변수 (base64 32B) | ADR-0002 §Decision. Vercel Env Vars |
| 키 로딩 전략 | 모듈 스코프 `Promise<CryptoKey>` 캐시 (`getSessionKey()`) | Performance NFR: 요청당 key import 비용 제거. p95 ≤ 1s 유지 |
| 키 부재 처리 | `loadKeyFromEnv()` throw → 서버 부팅/콜백 경로에서 500 fail-fast | Security: 암호화 없이 쿠키 발급 금지 |
| 쿠키 payload 형식 | `encrypt(JSON.stringify(SessionPayload), key)` → base64(IV‖ciphertext‖tag) | AES-GCM IV(12B)+tag(16B) = 28B 오버헤드. payload ≈ 500–800B → base64 후 ~1.1–1.5KB, 4KB 한도 내 |
| 복호화 실패 graceful | 모든 실패(잘못된 키/tampered/평문 스텁 쿠키) → `null` 반환 (리더) / `UNAUTHENTICATED` throw (guard) | 기존 base64 쿠키 소지자 crash 금지. 재로그인 유도 |
| 만료 검증 위치 | 복호화 성공 후 `expiresAt ≤ now()` 면 reject | 만료 쿠키 재사용 차단. Security NFR |
| `SESSION_COOKIE_NAME` | 기존 `"session"` 유지 | Plan 0001/0005 호환 |
| 기존 평문 쿠키 migration | 별도 dual-read 없음. GCM 복호화 실패 → null → 재로그인 flow | MVP: 사용자 규모 ~50, 단순성 우선 (Maintainability NFR) |
| 모듈 경계 | 새 헬퍼 `lib/session/crypto.ts`: `encryptSession()`, `decryptSession()` | guard/cookie/auth 세 곳의 중복 제거. 단일 책임 |
| 비동기 전파 | `buildSessionCookie()` / `readSessionFromCookies()` → `Promise` 반환으로 변경 | Web Crypto 는 async. 호출부(callback route, guard) 모두 이미 async 문맥 |
| 테스트 키 주입 | `process.env.TOKEN_ENC_KEY = <fixture>` in test setup | 단위 테스트 결정성 |

---

## Phase 1: 세션 암호화 헬퍼 (`lib/session/crypto.ts`)

### 테스트 시나리오

#### Test 1-1: 왕복 암복호화
```ts
test("given_validKey_whenEncryptThenDecrypt_thenReturnsOriginalPayload", async () => {
  // Given: 유효한 TOKEN_ENC_KEY 와 SessionPayload
  // When: encryptSession → decryptSession
  // Then: 원본과 동일한 payload 반환
});
```

#### Test 1-2: 잘못된 키로 복호화 실패
```ts
test("given_wrongKey_whenDecrypt_thenThrows", async () => {
  // Given: keyA 로 암호화된 ciphertext + keyB
  // When: decryptSession(ct, keyB)
  // Then: throw (GCM auth 실패)
});
```

#### Test 1-3: tampered ciphertext 거부
```ts
test("given_tamperedCiphertext_whenDecrypt_thenThrows", async () => {
  // Given: 정상 ciphertext 의 마지막 바이트 flip
  // When: decryptSession
  // Then: throw (GCM tag 검증 실패)
});
```

#### Test 1-4: 평문(base64 stub) 쿠키 거부
```ts
test("given_legacyBase64PlaintextCookie_whenDecrypt_thenThrows", async () => {
  // Given: Buffer.from(JSON.stringify(payload)).toString("base64")
  // When: decryptSession
  // Then: throw (길이 < 28B 아니면 GCM decrypt 실패)
});
```

#### Test 1-5: `TOKEN_ENC_KEY` 미설정 에러
```ts
test("given_missingEnvKey_whenGetSessionKey_thenThrowsWithClearMessage", async () => {
  // Given: delete process.env.TOKEN_ENC_KEY
  // When: getSessionKey()
  // Then: Error("TOKEN_ENC_KEY environment variable is not set")
});
```

#### Test 1-6: 키 캐싱
```ts
test("given_repeatedCalls_whenGetSessionKey_thenReturnsSameCryptoKey", async () => {
  // Given: 환경변수 설정됨
  // When: getSessionKey() 를 두 번 호출
  // Then: 동일 CryptoKey 참조 (import 1회)
});
```

### 구현 항목

**파일**: `lib/session/crypto.ts` (신규)
- `getSessionKey(): Promise<CryptoKey>` — 모듈 스코프 `Promise<CryptoKey> | null` 캐시, 최초 호출 시 `loadKeyFromEnv()` 호출
- `encryptSession(payload: SessionPayload): Promise<string>` — `JSON.stringify` → `encrypt()` 위임
- `decryptSession(ciphertext: string): Promise<SessionPayload>` — `decrypt()` → `JSON.parse` → 타입 검증 (필수 필드 존재 확인)
- `resetKeyCacheForTest()` — 테스트 전용 reset helper (NODE_ENV !== production 가드)

---

## Phase 2: 쿠키 빌더 배선 (`lib/session/cookie.ts`)

### 테스트 시나리오

#### Test 2-1: 쿠키 헤더 포맷 (속성 유지)
```ts
test("given_validPayload_whenBuildSessionCookie_thenIncludesSecurityAttributes", async () => {
  // Given: SessionPayload (expiresAt = now + 3600)
  // When: await buildSessionCookie(payload)
  // Then: "session=<ct>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600"
});
```

#### Test 2-2: 쿠키 값이 암호문 (평문 JSON 미포함)
```ts
test("given_payload_whenBuildSessionCookie_thenValueDoesNotContainPlaintextPuuid", async () => {
  // Given: SessionPayload with puuid="abc-123"
  // When: buildSessionCookie
  // Then: cookie value 에 "abc-123" 문자열 미포함
});
```

#### Test 2-3: Max-Age 음수 방지
```ts
test("given_expiredPayload_whenBuildSessionCookie_thenMaxAgeIsZero", async () => {
  // Given: expiresAt = now - 100
  // When: buildSessionCookie
  // Then: "Max-Age=0"
});
```

#### Test 2-4: 암호화 결과 4KB 이하
```ts
test("given_realisticPayload_whenBuildSessionCookie_thenUnder4KB", async () => {
  // Given: accessToken/entitlementsJwt 각 ~800B (실측 근사)
  // When: buildSessionCookie
  // Then: 전체 Set-Cookie 헤더 길이 < 4096
});
```

### 구현 항목

**파일**: `lib/session/cookie.ts` (수정)
- `buildSessionCookie(payload)` → `Promise<string>` 으로 시그니처 변경
- 본문: `const value = await encryptSession(payload);` 로 교체
- 나머지 속성 문자열 동일 유지

**파일**: `app/api/auth/callback/route.ts` (수정)
- 호출부: `await buildSessionCookie(payload)` 로 await 추가 (이미 async 핸들러)

---

## Phase 3: 쿠키 리더 / 가드 배선

### 테스트 시나리오

#### Test 3-1: 정상 복호화 → userId 반환
```ts
test("given_encryptedSessionCookie_whenReadSessionFromCookies_thenReturnsUserId", async () => {
  // Given: buildSessionCookie 로 생성된 Cookie 헤더
  // When: await readSessionFromCookies(header)
  // Then: payload.puuid === userId
});
```

#### Test 3-2: 평문 base64 레거시 쿠키 → null
```ts
test("given_legacyPlaintextCookie_whenReadSessionFromCookies_thenReturnsNull", async () => {
  // Given: Buffer.from(JSON.stringify({userId:"x"})).toString("base64")
  // When: readSessionFromCookies
  // Then: null (crash 금지, 재로그인 유도)
});
```

#### Test 3-3: 만료된 세션 거부
```ts
test("given_decryptSucceedsButExpired_whenReadSessionFromCookies_thenReturnsNull", async () => {
  // Given: expiresAt = now - 1 로 암호화된 쿠키
  // When: readSessionFromCookies
  // Then: null
});
```

#### Test 3-4: tampered 쿠키 → null
```ts
test("given_tamperedCookie_whenReadSessionFromCookies_thenReturnsNull", async () => {
  // Given: 정상 ct 의 중간 바이트 flip
  // When: readSessionFromCookies
  // Then: null
});
```

#### Test 3-5: 쿠키 부재 → null
```ts
test("given_noCookieHeader_whenReadSessionFromCookies_thenReturnsNull", async () => {
  // Given: cookieHeader = null
  // When: readSessionFromCookies
  // Then: null
});
```

#### Test 3-6: `requireSession` 정상 경로
```ts
test("given_validEncryptedCookie_whenRequireSession_thenReturnsPayload", async () => {
  // Given: next/headers cookies() mock 이 암호화된 session 제공
  // When: await requireSession()
  // Then: SessionPayload 반환 (puuid/accessToken 등 필드 보존)
});
```

#### Test 3-7: `requireSession` 만료 거부
```ts
test("given_expiredEncryptedCookie_whenRequireSession_thenThrowsUnauthenticated", async () => {
  // Given: 만료된 암호화 쿠키
  // When: requireSession
  // Then: throw Error("UNAUTHENTICATED")
});
```

#### Test 3-8: `requireSession` 레거시 쿠키 graceful 거부
```ts
test("given_legacyPlaintextCookie_whenRequireSession_thenThrowsUnauthenticated", async () => {
  // Given: base64(JSON) 스텁 쿠키 값
  // When: requireSession
  // Then: throw Error("UNAUTHENTICATED") (crash 없음)
});
```

### 구현 항목

**파일**: `lib/auth/cookie.ts` (수정)
- `readSessionFromCookies(header)` → `Promise<string | null>` 시그니처 변경
- 본문: `atob` + `JSON.parse` 제거. `decryptSession(sessionCookieValue)` try/catch → 성공 시 `payload.puuid` 반환 (userId semantic), `expiresAt` 체크하여 만료면 `null`
- `buildLogoutCookie()` 기존 로직 유지

**파일**: `lib/session/guard.ts` (수정)
- `requireSession()` 내부: `atob`/`JSON.parse` 제거 → `await decryptSession(sessionCookie.value)` try/catch
- 복호화 성공 후 `Date.now() / 1000 >= payload.expiresAt` 이면 `throw new Error("UNAUTHENTICATED")`
- 그 외 모든 에러 동일하게 `UNAUTHENTICATED` 로 정규화
- `getSession()` 기존 try/catch 래퍼 유지

**호출부 확인 (수정 최소화)**:
- `readSessionFromCookies` 호출부 전수 조사 → 전부 `await` 추가 필요 여부 확인
- `app/api/auth/callback/route.ts` — `buildSessionCookie` await 추가 (Phase 2 포함)

---

## Phase 4: 환경 설정 및 문서

### 테스트 시나리오

#### Test 4-1: 런타임에서 env 부재 시 명확한 에러
```ts
test("given_missingTokenEncKey_whenBuildSessionCookie_thenThrowsWithEnvHint", async () => {
  // Given: delete process.env.TOKEN_ENC_KEY; resetKeyCacheForTest()
  // When: buildSessionCookie(payload)
  // Then: Error message contains "TOKEN_ENC_KEY"
});
```

### 구현 항목

**파일**: `.env.example` (수정 또는 추가)
- `TOKEN_ENC_KEY=` 항목 추가, 주석으로 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 생성 명령 명시

**파일**: `docs/plan/0011_SESSION_AES_WIRING_PLAN.md` (본 문서)
- 운영 노트: Vercel Env Vars 에 Production/Preview/Development 3개 값 별도 설정 권장 (preview 누출 시 prod 무영향)

> `.env.example` 수정은 plan 경계 외이므로 `/implement` 단계에서 처리.

---

## 작업 종속성

### 종속성 그래프
```
Phase 1 (crypto.ts)
 ├─ 1-1..1-6 테스트 ──→ 1-impl (lib/session/crypto.ts)
 │
 ▼
Phase 2 (cookie builder) ─── 2-1..2-4 테스트 ──→ 2-impl (cookie.ts 배선 + callback await)
 │
 ▼
Phase 3 (reader + guard)
 ├─ 3-1..3-5 테스트 ──→ 3-impl-reader (auth/cookie.ts)
 └─ 3-6..3-8 테스트 ──→ 3-impl-guard  (session/guard.ts)
 │
 ▼
Phase 4 ─── 4-1 테스트 ──→ 4-env (.env.example)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1, 1-2, 1-3, 1-4, 1-5, 1-6 테스트 | 없음 | ✅ |
| G2 | 1-impl (`lib/session/crypto.ts`) | G1 | - |
| G3 | 2-1, 2-2, 2-3, 2-4 테스트 | G2 | ✅ |
| G4 | 2-impl (cookie.ts + callback await) | G3 | - (같은 caller 체인 수정) |
| G5 | 3-1..3-5 테스트, 3-6..3-8 테스트 | G2 | ✅ (서로 다른 파일 대상) |
| G6 | 3-impl-reader (`lib/auth/cookie.ts`), 3-impl-guard (`lib/session/guard.ts`) | G5 | ✅ (서로 다른 파일) |
| G7 | 4-1 테스트 + 4-env | G2, G4, G6 | - |

### 종속성 판단 기준
- Phase 1 의 `crypto.ts` 가 Phase 2/3 의 import 대상 → 반드시 선행
- Phase 2 와 Phase 3 는 서로 다른 파일을 수정하고 `crypto.ts` 에만 의존 → **후속 구현은 병렬 가능**하나, 테스트 단계에서 암호화/복호화 왕복을 서로 필요로 하므로 테스트 작성 시 `encryptSession` 픽스처 사용 (3-impl 은 2-impl 의 런타임 결과에 의존하지 않음)
- `app/api/auth/callback/route.ts` 의 `await` 추가는 `buildSessionCookie` 시그니처 변경과 동일 PR → Phase 2 내부 처리

---

## NFR 반영

| 카테고리 | 반영 내용 |
|---------|----------|
| Performance | `getSessionKey()` 모듈 스코프 캐시로 요청당 `importKey` 제거. AES-GCM encrypt/decrypt 는 Web Crypto 네이티브 (µs 단위) → API p95 ≤ 1s 영향 무시 가능. TTI 미영향 (서버 전용) |
| Scale | 암호화 쿠키 ~1.5KB × 50 concurrent = 75KB 네트워크 오버헤드, 무시 가능. wishlist 1000 rows 와 무관 |
| Availability | 환경변수 부재 시 fail-fast → 로그인 불능은 명확한 에러로 가시화 (silent corruption 금지). 기존 평문 쿠키 소지자 graceful degrade (재로그인 유도) → 99% best-effort 유지 |
| **Security (핵심)** | **AES-256-GCM**: 기밀성(encrypt) + 무결성/인증(auth tag) 동시 제공. IV 매 요청 랜덤(12B). 키는 `TOKEN_ENC_KEY` 환경변수(32B) Vercel secret. httpOnly+Secure+SameSite=Lax 속성 유지. tampered/wrong-key 복호화는 모두 throw → 쿠키 위변조 차단. 만료 검증으로 replay 제한. ADR-0002 MVP 브랜치 100% 충족 |
| Compliance | Riot 토큰을 평문으로 서버/로그에 남기지 않음 → Riot ToS 데이터 보호 원칙 부합. PIPA 최소수집과 직접 관계 없음 (기존 payload 유지) |
| Operability | Vercel Env Vars 로 키 주입 (Production/Preview/Development 분리 권장). 로그에 쿠키 값이 찍혀도 ciphertext 라 민감정보 노출 최소화 |
| Cost | Web Crypto 는 Node.js 내장, 외부 의존/비용 0. Vercel 환경변수 무료 티어 포함 |
| Maintainability | `lib/session/crypto.ts` 단일 진입점 → reader/builder/guard 3곳 중복 제거. 레거시 dual-read 없이 단순 throw→null 로 테스트 경로 최소화. 모든 변경 지점에 대응 단위 테스트 존재 (1-1 ~ 4-1) |

---

## 가정사항

1. **레거시 쿠키 migration 없음**: MVP 사용자 규모(≤50)와 데드라인(2026-04-26)을 고려, 기존 base64 평문 쿠키 소지자는 복호화 실패 시 자연스럽게 `/login` 으로 유도된다. dual-read (base64 → plaintext fallback) 는 의도적으로 **구현하지 않는다** (보안 퇴행 방지).
2. **`TOKEN_ENC_KEY` 는 배포 전 Vercel Env Vars 에 사전 설정**된다. Production 용 32B base64 키는 `openssl rand -base64 32` 또는 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 로 운영자가 생성.
3. **`SessionPayload.puuid` 가 `userId` semantic** 을 대체한다. 기존 `readSessionFromCookies` 가 `parsed.userId` 를 반환하던 부분은 `puuid` 로 교체 (호출부 Plan 0005 logout 포함 전수 확인 필요).
4. **Node.js 런타임**에서만 동작한다 (Edge runtime 미지원). Next.js route handler 들이 이미 Node runtime 을 사용하는 것으로 가정 (기존 `lib/crypto/aes-gcm.ts` 가 `Buffer` 사용하므로 동일 제약).
5. **`buildSessionCookie` / `readSessionFromCookies` 를 async 로 변경**해도 모든 호출부가 이미 async 핸들러 내에 있다. 예외 발견 시 `/implement` 단계에서 await 추가.
6. **만료 검증 책임은 reader/guard** 에 두고 builder 는 Max-Age 만 설정한다 (브라우저 자동 삭제와 서버 검증 이중 안전망).
7. 테스트 프레임워크는 기존 `tests/critical-path/` 와 동일 (Vitest 가정 — `tests/critical-path/auth.test.ts` 패턴 준수).
8. 쿠키 크기 추정은 `accessToken ≈ 800B`, `entitlementsJwt ≈ 800B` (Riot OAuth 실측 근사). 총 payload JSON ≈ 1.8KB → base64(IV+ct+tag) ≈ 2.5KB, 4KB 한도 여유.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | 왕복 암복호화 테스트 | ✅ 완료 | |
| 1-2 | 잘못된 키 throw 테스트 | ✅ 완료 | |
| 1-3 | tampered ciphertext throw 테스트 | ✅ 완료 | |
| 1-4 | 레거시 base64 거부 테스트 | ✅ 완료 | |
| 1-5 | `TOKEN_ENC_KEY` 미설정 에러 테스트 | ✅ 완료 | |
| 1-6 | 키 캐싱 테스트 | ✅ 완료 | |
| 1-impl | `lib/session/crypto.ts` 구현 | ✅ 완료 | |
| 2-1 | 쿠키 헤더 속성 테스트 | ✅ 완료 | |
| 2-2 | 쿠키 값 평문 미포함 테스트 | ✅ 완료 | |
| 2-3 | Max-Age 음수 방지 테스트 | ✅ 완료 | |
| 2-4 | 4KB 이하 크기 테스트 | ✅ 완료 | |
| 2-impl | `buildSessionCookie` async+암호화 배선 + callback await | ✅ 완료 | |
| 3-1 | 정상 복호화 → userId 테스트 | ✅ 완료 | |
| 3-2 | 레거시 쿠키 null 테스트 | ✅ 완료 | |
| 3-3 | 만료 세션 거부 테스트 | ✅ 완료 | |
| 3-4 | tampered 쿠키 null 테스트 | ✅ 완료 | |
| 3-5 | 쿠키 부재 null 테스트 | ✅ 완료 | |
| 3-6 | requireSession 정상 경로 테스트 | ✅ 완료 | |
| 3-7 | requireSession 만료 거부 테스트 | ✅ 완료 | |
| 3-8 | requireSession 레거시 graceful 테스트 | ✅ 완료 | |
| 3-impl-reader | `lib/auth/cookie.ts` 복호화 배선 | ✅ 완료 | |
| 3-impl-guard | `lib/session/guard.ts` 복호화 배선 | ✅ 완료 | |
| 4-1 | env 부재 명확 에러 테스트 | ✅ 완료 | |
| 4-env | `.env.example` `TOKEN_ENC_KEY` 추가 | ✅ 완료 | |

**상태 범례**: ✅ 완료 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
