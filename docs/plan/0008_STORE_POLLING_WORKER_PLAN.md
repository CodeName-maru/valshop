# Plan 0008: 상점 폴링 워커 및 이메일 알림 (Phase 2)

> Cross-plan 정합성 감사(2026-04-23) 반영 — 마이그레이션 번호, SessionPayload/user_tokens 컬럼, storefront parser shape, catalog 시그니처, RiotFetcher 포트, client version 리졸버, TokenVault 소비 정정.

## 개요

Phase 2 FR-8 / AC-7 을 구현한다. Vercel Hobby Cron 이 매시 정각 (`0 * * * *`) 에 `/api/cron/check-wishlist` 를 호출하고, 등록된 모든 유저의 Riot 상점을 폴링하여 위시리스트 스킨이 포함됐을 경우 해당 유저에게 Resend 이메일을 보낸다. 강한 제약은 $0 비용 (Vercel Hobby + Resend free + Supabase free) 과 공격적 폴링 금지 (시간당 1회) 이다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 트리거 | Vercel Cron `schedule: "0 * * * *"` (매시 정각) | ADR-0004. Compliance(Riot ToS - 시간당 1회 이하) + Cost($0, Hobby 내) + Operability(Vercel 단일 플랫폼 로그) |
| 알림 채널 | Resend Email (React Email 템플릿 아님, 단순 HTML) | ADR-0008. 디바이스 무관, iOS PWA 제약 회피, Cost(3000통/월 free) |
| 수신 주소 | Supabase Auth `users.email` 재사용, 구독 테이블 없음 | ADR-0008. 스키마 단순화, Maintainability |
| 워커 인증 | `CRON_SECRET` 환경변수 → `Authorization: Bearer` 헤더 검증 (Vercel 공식) | Security NFR — 공개 엔드포인트 남용 차단 |
| 토큰 소스 | Supabase `user_tokens` 테이블 → AES-GCM 복호화 | ADR-0002. Phase 2 vault. 서버 전용 `TOKEN_ENC_KEY` |
| 실패 정책 | 유저별 try/catch, 401 은 `user_tokens.needs_reauth=true` 마킹, 5xx/네트워크는 로그 후 skip, 재시도 없음 | Availability 99% best-effort, 다음 주기 자연 재시도, Cost(재시도 없어 cron 호출 수 고정) |
| 매칭 로직 | 순수 함수 `matchStoreAgainstWishlist(store, wish)` — 이미 Architecture § 6.1 에 정의 | Maintainability. 포트-어댑터 패턴, 단위 테스트 용이 |
| 중복 발송 방지 | `notifications_sent` 테이블 — `(user_id, skin_uuid, rotation_date)` UNIQUE | 로테이션 1회 = 최대 1통. 유저 체감 스팸 방지 + Resend 쿼터 보호 (Cost) |
| 실행 시간 예산 | 유저당 Riot API 2회 (storefront) × 50 유저 = ~100 호출, Vercel Hobby serverless 10s × 1회 내 처리 목표; 초과 시 유저 리스트를 batch 로 분할 (현재 50명은 단일 invocation 충분) | Performance(≤1시간 버짓에 여유), Scale(~50 users) |
| 테스트 | Vitest 단위(매칭) + 통합(워커 핸들러, MSW + fake repo) | ADR-0006 |
| 로깅 | `console.log` / `console.error` 만 (Vercel function logs 수집) | Operability — Sentry 없음 명시 (NFR) |

---

## Phase 1: 스키마 & 인프라 준비

### 테스트 시나리오

#### Test 1-1: `notifications_sent` 마이그레이션 적용 후 UNIQUE 제약 확인
```ts
describe("Feature: notifications_sent 중복 방지", () => {
  describe("Scenario: 같은 (user, skin, rotation_date) 두 번 insert", () => {
    it("Given 기존 row, When 동일 키로 insert, Then UNIQUE 위반 에러", async () => {
      // Given: (user_id=u1, skin_uuid=s1, rotation_date=2026-04-23) insert 완료
      // When: 동일 튜플 insert 재시도
      // When: await supabase.from('notifications_sent').insert({...}).throwOnError();
      // Then: error.code === '23505' (unique_violation)
    });
  });
});
```

### 구현 항목

**파일**: `supabase/migrations/0003_notifications_sent.sql`
- `notifications_sent(user_id uuid, skin_uuid text, rotation_date date, sent_at timestamptz default now())`
- `primary key (user_id, skin_uuid, rotation_date)` (자동 UNIQUE)
- RLS 활성화: `for all using (auth.uid() = user_id)` (워커는 service role 키 사용이라 RLS 우회)

**파일**: `supabase/migrations/0004_user_tokens_needs_reauth.sql`
- `alter table user_tokens add column needs_reauth boolean not null default false;`

**파일**: `vercel.json`
- `{ "crons": [{ "path": "/api/cron/check-wishlist", "schedule": "0 * * * *" }] }`

**파일**: `.env.example`
- 추가: `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`
- 기존 항목 (`TOKEN_ENC_KEY`) 재사용 명시

---

## Phase 2: 매칭 로직 & 이메일 디스패처 (순수 레이어)

### 테스트 시나리오

#### Test 2-1: 교집합 매칭
```ts
describe("Feature: 위시리스트-상점 매칭", () => {
  describe("Scenario: 위시리스트 스킨이 상점에 포함", () => {
    it("given위시A상점AB_when매칭_then매칭스킨A반환", () => {
      // Given
      const store = ["A", "B", "C", "D"];
      const wish = ["A", "Z"];
      // When
      const matched = matchStoreAgainstWishlist(store, wish);
      // Then
      expect(matched).toEqual(["A"]);
    });
  });
});
```

#### Test 2-2: 매칭 없음
```ts
it("given위시Z상점ABCD_when매칭_then빈배열", () => {
  // Given/When/Then
  expect(matchStoreAgainstWishlist(["A","B","C","D"], ["Z"])).toEqual([]);
});
```

#### Test 2-3: 빈 위시리스트 (경계값)
```ts
it("given빈위시_when매칭_then빈배열_그리고상점API호출스킵결정", () => {
  expect(matchStoreAgainstWishlist(["A"], [])).toEqual([]);
});
```

#### Test 2-4: 이메일 디스패처 — Resend 호출 포맷
```ts
describe("Feature: Email Dispatcher", () => {
  it("given매칭스킨2개_when디스패치_then한통의이메일_제목에스킨이름_본문html", async () => {
    // Given: fake Resend client (인자로 주입)
    const calls: any[] = [];
    const fakeResend = { emails: { send: async (p) => { calls.push(p); return { id: "x" }; } } };
    // When
    await dispatchWishlistMatch(fakeResend, {
      to: "u@e.com",
      matches: [{ uuid: "A", name: "Reaver Vandal", priceVp: 1775, iconUrl: "..." }],
    });
    // Then
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe("u@e.com");
    expect(calls[0].subject).toContain("Reaver Vandal");
    expect(calls[0].html).toContain("1775");
  });
});
```

#### Test 2-5: 디스패처 — Resend 실패 전파
```ts
it("givenResend5xx_when디스패치_then예외전파_워커가catch", async () => {
  const fake = { emails: { send: async () => { throw new Error("5xx"); } } };
  await expect(dispatchWishlistMatch(fake, {...})).rejects.toThrow("5xx");
});
```

### 구현 항목

**파일**: `lib/domain/wishlist.ts`
- 이미 선언된 `matchStoreAgainstWishlist(store: string[], wish: string[]): string[]` 재사용 (Architecture § 6.1)
- 본 plan 에서는 export 확인 + 단위 테스트 추가만

**파일**: `lib/email/dispatch.ts`
- `dispatchWishlistMatch(resend: ResendLike, payload: { to: string; matches: MatchedSkin[] }): Promise<void>`
- `ResendLike` 포트 인터페이스로 선언 (Resend SDK 직접 의존 X, 테스트 주입 가능)

**파일**: `lib/email/templates.ts`
- `buildWishlistMatchEmail(matches): { subject: string; html: string; text: string }` — 한국어 본문, 스킨 이름·VP·이미지 링크, 푸터에 "fan-made" 고지 포함 (Compliance NFR)

---

## Phase 3: 워커 엔드포인트 (통합)

### 테스트 시나리오

#### Test 3-1: 인증 실패
```ts
describe("Feature: /api/cron/check-wishlist 워커", () => {
  describe("Scenario: CRON_SECRET 불일치", () => {
    it("given잘못된Bearer_whenGET_then401_그리고핸들러내부미실행", async () => {
      // Given
      process.env.CRON_SECRET = "correct";
      // When
      const res = await testApiHandler(handler, { headers: { authorization: "Bearer wrong" }});
      // Then
      expect(res.status).toBe(401);
    });
  });
});
```

#### Test 3-2: 해피 패스 — 매칭 1명, 비매칭 1명
```ts
it("given유저2명_1명매칭_when워커실행_then이메일1통_notifications_sent1row", async () => {
  // Given:
  //   - userA: wish=["A"], storefront mock 반환 ["A","B","C","D"], email="a@e.com"
  //   - userB: wish=["Z"], storefront mock 반환 ["A","B","C","D"]
  //   - fake repos + fake resend 주입
  // When
  const res = await runWorker({ deps });
  // Then
  expect(res.status).toBe(200);
  expect(deps.resendCalls).toHaveLength(1);
  expect(deps.resendCalls[0].to).toBe("a@e.com");
  expect(deps.notificationsInserted).toHaveLength(1);
});
```

#### Test 3-3: 같은 로테이션 중복 발송 방지
```ts
it("given이미sent된스킨_when워커재실행_then이메일0통", async () => {
  // Given: notifications_sent 에 (userA, "A", today) 이미 존재
  // When
  await runWorker({ deps });
  // Then
  expect(deps.resendCalls).toHaveLength(0);
});
```

#### Test 3-4: Riot 401 → needs_reauth 마킹
```ts
it("givenstorefront401_when워커_then해당유저skip_그리고needs_reauth=true업데이트", async () => {
  // Given: storefront fetch 401 for userA
  // When / Then
  expect(deps.userTokensUpdates).toContainEqual({ user_id: "a", needs_reauth: true });
  expect(deps.resendCalls).toHaveLength(0);
});
```

#### Test 3-5: 유저별 실패 격리
```ts
it("givenuserA예외_userB정상_when워커_thenuserB는정상처리_200반환", async () => {
  // Given: storefront for A throws; for B returns match
  // When/Then
  expect(deps.resendCalls.map(c => c.to)).toEqual(["b@e.com"]);
});
```

#### Test 3-6: 빈 위시리스트 유저는 storefront 호출 스킵 (Cost/Compliance — 불필요한 Riot 호출 금지)
```ts
it("given빈위시_when워커_thenstorefront호출0회", async () => {
  expect(deps.storefrontCalls).toHaveLength(0);
});
```

#### Test 3-7: Resend 실패 시 notifications_sent 롤백 (중복 발송 재시도 가능)
```ts
it("givenResend5xx_when워커_thennotifications_sent insert없음_다음주기재시도가능", async () => {
  // Given: resend.send throws; notifications_sent insert 는 send 성공 후
  // Then
  expect(deps.notificationsInserted).toHaveLength(0);
});
```

### 구현 항목

**파일**: `app/api/cron/check-wishlist/route.ts`
- `export const runtime = "nodejs";` (Web Crypto + Supabase SDK)
- `export const maxDuration = 60;` (Hobby 한계 내, 50 유저 × ~200ms = 10s 여유 버퍼)
- `GET` handler: `authorization === \`Bearer ${process.env.CRON_SECRET}\`` 검증
- DI: `runWorker({ userRepo, wishlistRepo, tokenVault, storefrontClient, resend, notificationsRepo, now })` 를 내부 함수로 분리 — 테스트가 직접 호출

**파일**: `lib/worker/check-wishlist.ts`
- `runWorker(deps)` 구현. 로직:
  1. `userRepo.listActive()` (needs_reauth=false)
  2. 각 유저:
     - `wishlistRepo.listFor(userId)` — 비면 skip
     - `tokenVault.get(userId)` → AES-GCM 복호화
     - `storefrontClient.fetchStore({ puuid, tokens })` — 401 시 `userRepo.markNeedsReauth(userId)` 후 continue
     - `matchStoreAgainstWishlist(store.skinUuids, wish)` — 빈 배열이면 continue
     - `notificationsRepo.filterUnsent(userId, matched, rotationDate)` 로 중복 제거
     - 이메일 보낼 게 있으면 `catalog.lookup(matched)` → `dispatchWishlistMatch(resend, { to, matches })`
     - 발송 성공 후 `notificationsRepo.insert(...)` (성공시에만 기록 → Test 3-7)
  3. 유저별 try/catch, 집계 로그 출력 (`processed`, `notified`, `errors`)

**파일**: `lib/supabase/user-tokens-repo.ts`
- service role client 로 `listActive`, `get`, `markNeedsReauth` 어댑터

**파일**: `lib/supabase/notifications-repo.ts`
- `filterUnsent`, `insert` — 현재 KST 기준 `rotationDate` 계산 헬퍼 포함 (Riot 상점이 KST 00:00 로테이션)

**파일**: `lib/riot/storefront-server.ts` (기존 `lib/riot/storefront.ts` 가 cookie 기반이라면 서버 워커용 분리 — 토큰 객체 인자로 수락)
- FR-3 인터페이스 가정: `fetchStore({ puuid, accessToken, entitlementsJwt, clientVersion }) => Promise<{ skinUuids: string[]; endsAtEpoch: number }>`

---

## Phase 4: NFR 검증 & 운영

### 테스트 시나리오

#### Test 4-1: Performance — 워커 실행 시간 버짓
```ts
it("given유저50명_storefront평균200ms_when워커_then총실행시간≤30s", async () => {
  // Given: 50 유저, mock storefront 200ms latency
  // When: Date.now() 측정
  const elapsed = await timed(() => runWorker({ deps }));
  // Then
  expect(elapsed).toBeLessThan(30_000);
});
```

#### Test 4-2: Compliance — 유저당 storefront 호출 ≤ 1
```ts
it("given동일유저_when워커1회_thenstorefront호출이유저당1회이하", async () => {
  expect(deps.storefrontCallsByUser["userA"]).toBeLessThanOrEqual(1);
});
```

#### Test 4-3: Security — 매칭 없어도 토큰 로깅 금지 (회귀 가드)
```ts
it("given정상실행_when로그캡처_then평문토큰문자열미포함", () => {
  expect(loggedOutput).not.toContain("eyJ"); // JWT prefix
});
```

### 구현 항목

**파일**: `tests/critical-path/worker-check-wishlist.test.ts`
- Test 3-1 ~ 3-7 + 4-1 ~ 4-3 수용
- MSW 로 Riot storefront 모킹, Resend/Supabase 는 포트 fake 로 주입

**파일**: `tests/critical-path/match-store.test.ts`
- Test 2-1 ~ 2-3

**파일**: `tests/critical-path/email-dispatch.test.ts`
- Test 2-4 ~ 2-5

**파일**: `tests/critical-path/notifications-migration.test.ts`
- Test 1-1 (Supabase local 필요 시 integration 으로 이전 가능, 기본은 mock client)

**파일**: `README.md` (업데이트)
- Phase 2 섹션: `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` env 추가 방법, Resend 도메인 verify, Vercel Cron 활성화, 수동 실행 (`curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/check-wishlist`)
- 롤백: `vercel.json` 의 `crons` 배열 비우고 재배포 → Cron 즉시 정지 (Operability)

---

## NFR 반영

| 카테고리 | 실현 방법 | 측정 / 테스트 |
|---|---|---|
| **Performance** (≤1시간) | Cron `0 * * * *` + 단일 invocation 내 50 유저 처리; 유저당 Riot 호출 1회 (storefront) | Test 4-1 (≤30s 상한), Vercel function 실행 로그 duration, 로테이션 직후 체감 모니터링 |
| **Scale** (~50 users) | 순차 루프 충분; 스케일 초과 시 `Promise.all` + 배치로 확장 여지 (현재는 간결함 우선) | Test 3-2 (2명), Test 4-1 (50명 모킹) |
| **Availability** (99% best-effort) | 유저별 try/catch 격리, 401 은 플래그 후 다음 주기 자연 재시도, 실패 알림 없음 | Test 3-4, Test 3-5 |
| **Security** | `CRON_SECRET` Bearer 검증, Supabase service role 키는 Vercel 환경변수 전용, AES-GCM 복호화는 서버에서만 (`TOKEN_ENC_KEY`), 토큰 평문 로깅 금지 | Test 3-1 (401), Test 4-3 (로그 회귀 가드), manual: Vercel env var 확인 |
| **Compliance** (Riot ToS 1회/시간, PIPA) | schedule `0 * * * *` 고정, 유저당 storefront 호출 ≤1, 빈 위시리스트는 storefront 호출 스킵, 이메일 본문에 "fan-made" 푸터 | Test 3-6 (빈 위시 skip), Test 4-2 (유저당 호출 수), 코드 리뷰 |
| **Operability** | 집계 로그 (`processed/notified/errors`), Vercel function logs 에 일원화, Resend 대시보드로 발송 확인, 롤백은 `vercel.json` 편집 | 수동 Vercel 로그 확인, Resend 대시보드 |
| **Cost** ($0 — 본 요구사항 강한 제약) | (a) Vercel Hobby Cron 시간당 1회 (24회/일 << Hobby 한도), (b) Resend free 3000통/월 (50유저 × 매칭률 낮음 → 월 수십통 예상), (c) `notifications_sent` 중복 방지로 쿼터 보호, (d) 실패 재시도 없음 → cron 호출 수 고정 | Vercel dashboard usage, Resend dashboard usage, Test 3-3 (중복 방지) |
| **Maintainability** | 매칭 로직 순수 함수 분리 (단위 테스트), 워커 핸들러 DI 로 통합 테스트 용이, 포트-어댑터로 Resend/Supabase 교체 가능 | Test 2-1~2-3 (단위), Test 3-1~3-7 (통합), ADR-0006 테스트 스택 준수 |

---

## 가정사항 (선행 FR 인터페이스)

본 plan 은 다음이 이미 존재한다고 가정한다. 구현 시 실제 시그니처 차이가 있으면 어댑터 얇게 추가.

- **FR-1 / FR-2 (토큰)**: `lib/crypto/aes-gcm.ts` 에 `encrypt(bytes): Uint8Array` / `decrypt(Uint8Array): bytes` 존재. `user_tokens` 테이블 스키마는 Architecture § 5.1 대로 `access_token_enc`, `refresh_token_enc`, `entitlements_jwt_enc`, `expires_at`.
- **FR-3 (상점 응답 파싱)**: `lib/riot/storefront.ts` 에 storefront 응답을 `{ skinUuids: string[4], endsAtEpoch: number }` 로 파싱하는 함수 존재. 워커는 이 파서를 재사용하되 **쿠키 대신 토큰 객체를 인자로 받는** 서버용 바리앙트가 필요할 수 있음 → Phase 3 에서 `lib/riot/storefront-server.ts` 로 분리.
- **FR-7 (위시리스트)**: `wishlist` 테이블 `(user_id, skin_uuid)` 존재. `WishlistRepo.listFor(userId): Promise<string[]>` 어댑터 가용.
- **Supabase Auth**: `auth.users` 의 `email` 컬럼 접근 가능 (service role 필요).
- **Catalog**: `lib/valorant-api/catalog.ts` 의 `lookup(uuid): Promise<{ name; priceVp; iconUrl }>` 존재 (없다면 `lib/riot/storefront` 응답의 가격 필드 + valorant-api 메타 조합으로 보강).

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (스키마/인프라)
  1-1 test ──► 1-impl (0003, 0004 migrations, vercel.json, .env.example)
       │
       ▼
Phase 2 (순수 레이어)
  2-1..2-3 test ──► 2-impl-match (lib/domain/wishlist export+tests)
  2-4..2-5 test ──► 2-impl-email (lib/email/dispatch.ts, templates.ts)
       │
       ▼
Phase 3 (워커 통합)
  3-1..3-7 test ──► 3-impl-worker (route.ts, lib/worker/check-wishlist.ts,
                                    user-tokens-repo, notifications-repo,
                                    storefront-server)
       │
       ▼
Phase 4 (NFR 검증 / 운영)
  4-1..4-3 test ──► 4-impl-readme (README.md 업데이트)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | 1-1 test | 없음 | - |
| G2 | 1-impl (migrations + vercel.json + .env.example) | G1 | ✅ (서로 다른 파일) |
| G3 | 2-1, 2-2, 2-3, 2-4, 2-5 test | G2 | ✅ (테스트 작성 단계, 독립 파일) |
| G4 | 2-impl-match, 2-impl-email | G3 | ✅ (서로 다른 모듈, 독립) |
| G5 | 3-1 ~ 3-7 test | G4 | ✅ (같은 파일 `tests/critical-path/worker-check-wishlist.test.ts` → 단일 작업으로 취급, 내부 시나리오 병렬 X) |
| G6 | 3-impl-worker (route.ts, lib/worker, repos, storefront-server) | G5 | ❌ (상호 참조, 순차 작성 권장) |
| G7 | 4-1 ~ 4-3 test | G6 | ✅ (같은 파일에 append → 실제론 G5 와 같은 파일, 같은 순차 그룹) |
| G8 | 4-impl-readme | G7 | - |

> G5 와 G7 은 동일 테스트 파일(`worker-check-wishlist.test.ts`)을 수정하므로 `/implement` 에서 반드시 순차 실행.

### 종속성 판단 기준

- **종속**: `lib/worker/check-wishlist.ts` 는 Phase 2 의 `matchStoreAgainstWishlist`, `dispatchWishlistMatch`, Phase 1 의 `notifications_sent` 스키마에 의존.
- **종속**: `route.ts` 는 `lib/worker/check-wishlist.ts` 의 export 와 `CRON_SECRET` env 에 의존.
- **독립**: `lib/email/dispatch.ts` 와 `lib/domain/wishlist.ts` (매칭) 는 동시 작성 가능.
- **파일 충돌**: Phase 3 와 Phase 4 테스트가 같은 파일이면 한 Phase 안에서 merge 하여 작성.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | notifications_sent UNIQUE 제약 테스트 | ✅ 완료 | |
| 1-impl | 0003/0004 migrations + vercel.json + .env.example | ✅ 완료 | |
| 2-1 | 교집합 매칭 테스트 | ✅ 완료 | |
| 2-2 | 매칭 없음 테스트 | ✅ 완료 | |
| 2-3 | 빈 위시리스트 경계값 테스트 | ✅ 완료 | |
| 2-4 | 이메일 디스패처 포맷 테스트 | ✅ 완료 | |
| 2-5 | 이메일 디스패처 실패 전파 테스트 | ✅ 완료 | |
| 2-impl-match | `lib/domain/wishlist.ts` export 확정 | ✅ 완료 | |
| 2-impl-email | `lib/email/dispatch.ts`, `templates.ts` | ✅ 완료 | |
| 3-1 | CRON_SECRET 인증 실패 테스트 | ✅ 완료 | |
| 3-2 | 해피 패스 (1 매칭 / 1 비매칭) 테스트 | ✅ 완료 | |
| 3-3 | 동일 로테이션 중복 발송 방지 테스트 | ✅ 완료 | |
| 3-4 | storefront 401 → needs_reauth 테스트 | ✅ 완료 | |
| 3-5 | 유저별 실패 격리 테스트 | ✅ 완료 | |
| 3-6 | 빈 위시리스트 storefront 호출 스킵 테스트 | ✅ 완료 | |
| 3-7 | Resend 실패 시 notifications_sent 롤백 테스트 | ✅ 완료 | |
| 3-impl-worker | `route.ts` + `lib/worker/check-wishlist.ts` + repos + storefront-server | ✅ 완료 | |
| 4-1 | 실행 시간 버짓 테스트 | ✅ 완료 | Performance |
| 4-2 | 유저당 storefront 호출 ≤1 테스트 | ✅ 완료 | Compliance |
| 4-3 | 평문 토큰 로깅 금지 회귀 가드 | ✅ 완료 | Security |
| 4-impl-readme | README Phase 2 env / 수동 실행 / 롤백 가이드 | ✅ 완료 | Operability |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
