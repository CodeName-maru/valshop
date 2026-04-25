# Plan 0005: 로그아웃 (FR-5)

## 개요

<!-- Cross-plan 정합성 감사(2026-04-23) 반영: TokenStore → TokenVault, clear → delete, 경로/소유 정정. -->

유저가 로그아웃 버튼으로 세션을 즉시 종료하고, 로컬(httpOnly cookie) + 서버(Phase 2 Supabase vault) 에 저장된 모든 RSO 토큰을 **원자적으로 파기**하는 기능을 구현한다. 본 요구사항의 핵심 NFR 은 **토큰 파기 완전성 (Security)** 으로, 파기 후 어떤 저장 위치에도 잔여 토큰이 존재하지 않아야 하며 이를 단위 테스트로 보장한다. MVP 에서는 cookie 파기 + (있을 경우) localStorage 키 파기 경로를 구현하고, Phase 2 에서는 Supabase `user_tokens` row 삭제 경로를 동일 파이프라인에 연결한다.

## 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| 로그아웃 엔드포인트 | `POST /api/auth/logout` (Next.js Route Handler) | ARCHITECTURE §3 폴더 구조에 이미 `app/api/auth/logout/route.ts` 슬롯 존재. 서버가 httpOnly cookie 를 지워야 하므로 클라이언트 단독 처리 불가 (NFR Security) |
| HTTP method | POST | GET 은 prefetch/crawler 가 자동 호출 가능 → CSRF 및 사용자 의도 보호 관점에서 상태 변경은 POST 가 관례 |
| 파기 인터페이스 | `TokenVault` 포트 (`put` / `get` / `delete`) — Plan 0002 에서 선언된 인터페이스 재사용 | ARCHITECTURE §6.1 포트-어댑터 규칙. `delete(userId)` 로 서버측 vault 파기 책임을 단일화 → 테스트 용이 |
| 원자성 | `TokenVault.delete(userId)` 호출 + `Set-Cookie` 파기 헤더 세팅을 단일 핸들러에서 수행. `delete` 실패 시 500 반환하되 **cookie 파기 헤더는 응답에 포함시켜 로컬 파기는 계속** (파기는 "더 파괴적인" 방향으로만 재시도) | 파기 실패 시 토큰을 살려두는 것은 Security NFR 위반. "모두 시도, 실패는 재시도 힌트로 표시" 가 안전 방향 |
| 오프라인 동작 | 클라이언트 로그아웃 버튼은 fetch 실패(network error) 시에도 **document.cookie 만료 세팅 + localStorage.clear() 를 선제 실행** | NFR Availability: 오프라인에서도 로컬 토큰 파기 보장 |
| 성공 응답 | 302 → `/login?logout=1` (브라우저 폼 POST), 또는 JSON `{ ok: true }` (fetch 호출) — Accept 헤더로 분기 | 버튼이 `<form>` 인지 `fetch()` 인지에 따라 UX 최적 선택 |
| Set-Cookie 파기 방식 | 동일 name/path/domain 에 `Max-Age=0` + 빈 값 + `HttpOnly; Secure; SameSite=Lax` | RFC 6265 준수, 브라우저 즉시 삭제 |
| UI 위치 | `components/Footer.tsx` 또는 `components/LogoutButton.tsx` (대시보드 헤더에 배치) | PRD FR-5 "로그아웃 버튼" 접근성 |
| 스타일 | shadcn/ui `Button` + `lucide-react` `LogOut` 아이콘 | ADR-0007 (Tailwind + shadcn/ui) |
| 테스트 러너 | Vitest + `next-test-api-route-handler` + MSW | ADR-0006 |
| 성능 | 서버 처리 ≤ 100ms (단순 Set-Cookie + optional DB delete); 클라이언트 즉시 리다이렉트 — 500ms NFR 여유 확보 | PRD §6 Performance "로그아웃 < 500ms" |

## 가정사항 (Cross-plan 경계)

- **`TokenVault` 포트·메서드·경로는 Plan 0002 산출물이다.** 본 plan 은 해당 포트를 소비만 하며 구현/수정하지 않는다.
  - 파일: `lib/vault/token-vault.ts` (Plan 0002 소유)
  - 메서드 계약: `put(userId, tokens)` / `get(userId)` / **`delete(userId)`** — 본 plan 이 의존하는 메서드는 `delete(userId)`.
  - MVP 구현체: `NoopTokenVault` (Plan 0002 제공) — MVP 단계에서 서버측 vault 파기는 no-op 이지만 호출 계약은 유지.
  - Phase 2 구현체: Supabase 기반 `TokenVault` (Plan 0002 Phase 2) — `delete(userId)` 가 `user_tokens` row 삭제로 확장.
- **`buildLogoutCookie()` 는 Plan 0002 export 이다.** 본 plan 의 logout route 는 이를 import 하여 `Set-Cookie` 파기 헤더를 구성한다.
  - 함께 제공되는 `readSessionFromCookies()` 도 Plan 0002 export 이며, 요청에서 현재 userId 를 복원할 때 사용한다.
- **`app/api/auth/logout/route.ts` 는 본 plan 단독 소유이다.** Plan 0002 는 route 파일을 생성/수정하지 않는다.

```ts
// lib/vault/token-vault.ts (Plan 0002 산출물)
export interface TokenVault {
  put(userId: string, tokens: EncryptedTokenSet): Promise<void>;
  get(userId: string): Promise<EncryptedTokenSet | null>;
  delete(userId: string): Promise<void>;   // ← 본 plan 이 의존하는 메서드
}
```

- MVP 구현체: `NoopTokenVault` (Plan 0002)
- Phase 2 구현체: Supabase 어댑터 (Plan 0002 Phase 2)
- 로그아웃 파이프라인은 `TokenVault.delete(userId)` + 클라이언트측 localStorage/cookie 파기로 구성된다.

---

## Phase 1 (MVP): 서버 로그아웃 엔드포인트

### 테스트 시나리오

#### Test 1-1: cookie 파기 성공 경로

```ts
// tests/critical-path/logout.test.ts
import { describe, it, expect, vi } from "vitest";
import { testApiHandler } from "next-test-api-route-handler";
import * as handler from "@/app/api/auth/logout/route";

describe("Feature: 로그아웃 — 서버 토큰 파기", () => {
  describe("Scenario: 유효한 세션 cookie 로 로그아웃 호출", () => {
    it("given유효세션쿠키_when로그아웃POST_then세션쿠키Max-Age0으로덮어쓰기", async () => {
      // Given: 암호화된 토큰이 담긴 session cookie 를 가진 유저
      const fakeStore = { clear: vi.fn().mockResolvedValue(undefined) };
      // When: POST /api/auth/logout 호출
      await testApiHandler({
        appHandler: handler,
        requestPatcher: (req) => req.headers.set("cookie", "session=ENC_PAYLOAD"),
        test: async ({ fetch }) => {
          const res = await fetch({ method: "POST", headers: { Accept: "application/json" } });
          // Then: 200, Set-Cookie 에 Max-Age=0, body { ok: true }
          expect(res.status).toBe(200);
          const setCookie = res.headers.get("set-cookie") ?? "";
          expect(setCookie).toMatch(/session=;/);
          expect(setCookie).toMatch(/Max-Age=0/i);
          expect(setCookie).toMatch(/HttpOnly/i);
          expect(setCookie).toMatch(/Secure/i);
          expect(setCookie).toMatch(/SameSite=Lax/i);
        },
      });
    });
  });
});
```

#### Test 1-2: 세션이 없는 상태에서도 멱등

```ts
it("given쿠키없음_when로그아웃POST_then200과파기헤더반환(멱등)", async () => {
  // Given: cookie 헤더 없음
  // When: POST /api/auth/logout
  // Then: 200 OK + Set-Cookie 파기 헤더 (이미 없어도 안전)
});
```

#### Test 1-3: 서버 저장 위치 clear 호출 검증 (파기 완전성 — Security NFR 핵심)

```ts
it("given서버토큰스토어주입_when로그아웃_then모든등록어댑터의clear가호출된다", async () => {
  // Given: TokenStore 두 개 (primary cookie, secondary vault) 가 레지스트리에 등록
  const cookieClear = vi.fn().mockResolvedValue(undefined);
  const vaultClear = vi.fn().mockResolvedValue(undefined);
  // When: 로그아웃 처리
  await runLogout({ stores: [{ clear: cookieClear }, { clear: vaultClear }], ctx });
  // Then: 각 스토어 clear 가 정확히 1회씩 호출됨
  expect(cookieClear).toHaveBeenCalledTimes(1);
  expect(vaultClear).toHaveBeenCalledTimes(1);
});
```

#### Test 1-4: 어댑터 일부 실패 시 나머지 파기는 계속 진행

```ts
it("given쿠키파기성공_vault파기실패_when로그아웃_then쿠키는파기되고500응답", async () => {
  // Given: cookie.clear 정상, vault.clear reject
  // When: 로그아웃
  // Then: Set-Cookie Max-Age=0 헤더는 응답에 포함, status=500, body.error="partial-clear-failure"
  // (토큰 파기는 한 방향 — 살려두지 않는다)
});
```

#### Test 1-5: GET 요청은 405 (prefetch 방어)

```ts
it("givenGET메서드_when로그아웃엔드포인트호출_then405반환", async () => {
  // Given/When: GET /api/auth/logout
  // Then: 405 Method Not Allowed
});
```

### 구현 항목

**파일**: `app/api/auth/logout/route.ts`
- `export async function POST(req: Request)` 구현
- 등록된 `TokenStore[]` 순회 → `Promise.allSettled(stores.map(s => s.clear(ctx)))`
- 응답에 `Set-Cookie: session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` 설정
- Accept 헤더가 `text/html` 이면 `302 /login?logout=1`, 그 외엔 JSON
- `export async function GET()` → 405

**파일**: `lib/auth/logout.ts` (신규, 순수 함수)
- `runLogout({ stores, ctx }): Promise<{ partial: boolean; errors: Error[] }>` — 파기 파이프라인 단일 진입점. Route Handler 와 테스트가 공유

**파일**: `lib/auth/token-store-registry.ts` (신규)
- MVP: `[cookieTokenStore]` 만 반환
- Phase 2: `[cookieTokenStore, supabaseVaultTokenStore]` 반환 (Phase 3 에서 확장)

---

## Phase 2 (MVP): 클라이언트 로그아웃 UI + 오프라인 파기

### 테스트 시나리오

#### Test 2-1: 버튼 클릭 시 POST 호출 + 리다이렉트

```ts
// tests/critical-path/logout-button.test.tsx
it("given로그인상태_when로그아웃버튼클릭_thenPOST호출되고login으로이동", async () => {
  // Given: 대시보드 렌더, fetch mock 이 { ok:true } 반환
  // When: 버튼 클릭
  // Then: fetch("/api/auth/logout", { method:"POST" }) 호출, router.push("/login") 실행
});
```

#### Test 2-2: 오프라인(네트워크 실패) 시에도 로컬 토큰 파기 — Availability NFR

```ts
it("given네트워크실패_when로그아웃버튼클릭_thenlocalStorage와document.cookie즉시파기", async () => {
  // Given: fetch 가 TypeError 로 reject, localStorage 에 잔존 키 존재
  localStorage.setItem("val_refresh_hint", "x");
  document.cookie = "session=dummy; path=/";
  // When: 버튼 클릭
  // Then: localStorage 에 val_* 키 없음, document.cookie 에 session 없음, /login 으로 이동
  expect(localStorage.getItem("val_refresh_hint")).toBeNull();
  expect(document.cookie).not.toMatch(/session=/);
});
```

#### Test 2-3: 500ms 이내 UI 반응 (Performance NFR)

```ts
it("given버튼클릭_when로그아웃_then500ms이내login으로라우팅트리거", async () => {
  // Given: fetch mock 이 50ms 뒤 resolve
  // When: 버튼 클릭
  // Then: performance.now() 기준 router 호출까지 < 500ms
});
```

### 구현 항목

**파일**: `components/LogoutButton.tsx`
- shadcn/ui `<Button variant="ghost">` + `lucide-react` `<LogOut />`
- `onClick`:
  1. `localStorage.clear()` 또는 `val_*` 프리픽스 키만 제거 (원자적 먼저)
  2. 만료 cookie 덮어쓰기 (`document.cookie = "session=; Max-Age=0; path=/"`)
  3. `fetch("/api/auth/logout", { method:"POST" })` 시도 (실패해도 catch 후 진행)
  4. `router.push("/login")`
- 중복 클릭 방지용 `isPending` 상태

**파일**: `app/(app)/dashboard/page.tsx` (수정)
- 헤더 영역에 `<LogoutButton />` 배치

---

## Phase 3 (Phase 2 확장): Supabase vault 파기 연결

### 테스트 시나리오

#### Test 3-1: vault row 삭제 호출

```ts
// tests/integration/logout-vault.test.ts (critical-path 아님)
it("given위저등록된vault어댑터_when로그아웃_thenuser_tokens행삭제쿼리실행", async () => {
  // Given: SupabaseVaultTokenStore 가 registry 에 포함 + 테스트용 local supabase
  // When: runLogout 호출
  // Then: user_tokens where user_id=ctx.userId 행 count = 0
});
```

#### Test 3-2: 파기 완전성 종단 검증 (Security NFR — 잔여 토큰 없음)

```ts
it("given쿠키+localStorage+vault모두토큰보유_when로그아웃_then세위치모두잔여토큰0", async () => {
  // Given:
  //   - httpOnly cookie session=ENC (서버 set)
  //   - localStorage["val_refresh_hint"] = "x"
  //   - user_tokens row 존재
  // When: POST /api/auth/logout + 클라이언트 side-effect 수행
  // Then:
  //   - 응답 Set-Cookie Max-Age=0
  //   - localStorage 에 val_* 프리픽스 키 0개
  //   - SELECT count(*) FROM user_tokens WHERE user_id=$1 → 0
});
```

### 구현 항목

**파일**: `lib/auth/token-store-registry.ts` (수정)
- Phase 2 조건에서 `supabaseVaultTokenStore` 를 배열에 추가

**파일**: `lib/supabase/vault-token-store.ts` (Plan 0002 산출물에 `clear()` 구현 보강)
- `clear(ctx)`: `supabase.from("user_tokens").delete().eq("user_id", ctx.userId)` — RLS 하에서 본인 행만

**파일**: `supabase/migrations/0001_user_tokens.sql`
- 이미 존재 (Plan 0002). 본 plan 에서는 신규 마이그레이션 없음

---

## NFR 반영

PRD §6 의 8개 카테고리 전부를 본 plan 이 어떻게 다루는지 명시. 핵심 NFR 인 **Security (토큰 파기 완전성)** 는 테스트 번호로 직접 연결한다.

| 카테고리 | 반영 방식 | 연결 테스트 |
|---|---|---|
| **Performance** (< 500ms) | Route Handler 는 Set-Cookie + 병렬 `allSettled` 만 수행; DB 호출 1회(P2). 클라이언트는 fetch 완료 전이라도 로컬 파기를 선행 실행 → 체감 반응 즉시 | Test 2-3 |
| **Scale** (N/A) | 개별 사용자 단일 요청. 서버리스 자동 스케일로 충분, 별도 처리 없음 | — |
| **Availability** (오프라인에서도 로컬 파기) | 클라이언트가 fetch 실패를 catch 후에도 `localStorage.clear()` + 만료 cookie 덮어쓰기를 보장 | Test 2-2 |
| **Security (핵심) — 토큰 파기 완전성** | 서버: 모든 `TokenStore` 어댑터의 `clear()` 호출. 클라이언트: localStorage + non-HttpOnly cookie 선제 파기. 종단 검증으로 세 저장 위치(localStorage / cookie / vault) 모두 잔여 0 확인 | **Test 1-3, Test 1-4, Test 2-2, Test 3-1, Test 3-2** |
| **Compliance (PIPA — 파기 요청 즉시 이행)** | 로그아웃 = 파기 요청 = 즉시 서버/클라이언트 동기 파기. 지연 큐 없음. `/privacy` 에 "로그아웃 시 수집 데이터(PUUID, 토큰) 즉시 파기" 명시 업데이트는 별도 plan | Test 1-3, Test 3-2 |
| **Operability** (N/A) | Vercel 기본 로그에 logout 호출 기록. 별도 모니터링 없음 | — |
| **Cost** ($0) | 추가 인프라 없음. Supabase DELETE 1회, Vercel Serverless 호출 1회 — 무료 티어 내 | — |
| **Maintainability** (단위 테스트 — 파기 완전성) | `tests/critical-path/logout.test.ts` + `tests/critical-path/logout-button.test.tsx` 에 핵심 시나리오. Phase 3 는 `tests/integration/` 로 분리 | Test 1-1..1-5, 2-1..2-3, 3-1..3-2 |

---

## 작업 종속성

### 종속성 그래프

```
Phase 1 (서버)
  ├─ Test 1-1 테스트 ─┐
  ├─ Test 1-2 테스트 ─┤
  ├─ Test 1-3 테스트 ─┼──→ 1-impl (route.ts + logout.ts + registry)
  ├─ Test 1-4 테스트 ─┤
  └─ Test 1-5 테스트 ─┘
                               │
Phase 2 (클라이언트) ◄──────────┘ (registry/route 사용)
  ├─ Test 2-1 테스트 ─┐
  ├─ Test 2-2 테스트 ─┼──→ 2-impl (LogoutButton.tsx + dashboard 수정)
  └─ Test 2-3 테스트 ─┘
                               │
Phase 3 (P2 vault) ◄───────────┘ (registry 확장)
  ├─ Test 3-1 테스트 ─┐
  └─ Test 3-2 테스트 ─┴──→ 3-impl (registry 수정 + vault clear 구현)
```

### 병렬 실행 그룹

| 그룹 | 포함 항목 | 선행 조건 | 병렬 가능 |
|------|-----------|-----------|-----------|
| G1 | Test 1-1, 1-2, 1-3, 1-4, 1-5 테스트 스텁 작성 | Plan 0002 의 `TokenStore` 인터페이스 | ✅ |
| G2 | 1-impl (`app/api/auth/logout/route.ts`, `lib/auth/logout.ts`, `lib/auth/token-store-registry.ts`) | G1 완료 | - (3파일 모두 신규, 같은 서브시스템이라 순차) |
| G3 | Test 2-1, 2-2, 2-3 테스트 스텁 | G2 완료 (route.ts 계약 확정) | ✅ |
| G4 | 2-impl (`components/LogoutButton.tsx`, `app/(app)/dashboard/page.tsx` 수정) | G3 완료 | - (dashboard 수정은 Button 작성 후) |
| G5 | Test 3-1, 3-2 테스트 스텁 | G4 완료 + Phase 2 진입 결정 | ✅ |
| G6 | 3-impl (registry 수정 + vault-token-store `clear()`) | G5 완료 | - |

> 같은 파일을 수정하는 작업은 동일 그룹 또는 순차 그룹에 배치함. `token-store-registry.ts` 는 G2 와 G6 에서 수정되므로 그룹이 분리되어 순서 강제.

---

## 진행 상황

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1-1 | 테스트: cookie 파기 성공 | ⬜ 미착수 | |
| 1-2 | 테스트: 세션 없음 상태 멱등 | ⬜ 미착수 | |
| 1-3 | 테스트: 모든 store.clear 호출 검증 (Security 핵심) | ⬜ 미착수 | |
| 1-4 | 테스트: 부분 실패 시 동작 | ⬜ 미착수 | |
| 1-5 | 테스트: GET 405 | ⬜ 미착수 | |
| 1-impl | 구현: `app/api/auth/logout/route.ts` + `lib/auth/logout.ts` + `lib/auth/token-store-registry.ts` | ⬜ 미착수 | Plan 0002 `TokenStore` 의존 |
| 2-1 | 테스트: 버튼 클릭 → POST + 라우팅 | ⬜ 미착수 | |
| 2-2 | 테스트: 오프라인 로컬 파기 (Availability) | ⬜ 미착수 | |
| 2-3 | 테스트: < 500ms 응답 (Performance) | ⬜ 미착수 | |
| 2-impl | 구현: `components/LogoutButton.tsx` + dashboard 헤더 배치 | ⬜ 미착수 | shadcn/ui Button + lucide LogOut |
| 3-1 | 테스트: vault row 삭제 (P2 integration) | ⬜ 미착수 | Phase 2 진입 후 |
| 3-2 | 테스트: 세 저장 위치 잔여 0 종단 검증 (Security 완전성) | ⬜ 미착수 | Phase 2 진입 후 |
| 3-impl | 구현: registry 에 vault 어댑터 등록 + `clear()` 구현 | ⬜ 미착수 | Phase 2 진입 후 |

**상태 범례**: ⬜ 미착수 | 🔨 진행중 | ✅ 완료 | ❌ 차단됨
