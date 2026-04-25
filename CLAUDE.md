# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VAL-Shop — Valorant 스킨 상점 알림 PWA. Next.js 15 (App Router) + React 19 풀스택 단일 레포. Vercel Serverless 배포, Phase 2 에서 Supabase / Vercel Cron / Resend 추가.

비공식 (fan-made) 프로젝트로 Riot 비공식 auth flow 와 비공식 API (`pd.kr.a.pvp.net`) 를 프록시한다.

## Commands

```bash
npm run dev                # next dev
npm run build              # next build (배포 전 항상 통과 확인)
npm run lint               # next lint (eslint flat config, strictTypeChecked)
npm test                   # vitest (jsdom, tests/**/*.test.ts(x))
npm run test:integration   # SUPABASE_INTEGRATION=1 vitest run tests/integration
npm run test:e2e           # playwright (자동으로 next dev 기동)

# 단일 테스트 실행
npx vitest run tests/critical-path/auth.test.ts
npx vitest run -t "test name pattern"
npx playwright test tests/e2e/dashboard.spec.ts
```

`tests/integration/` 은 `SUPABASE_INTEGRATION=1` 환경에서만 실행된다 (기본 `npm test` 에서는 제외되지 않지만 환경변수 없으면 skip 처리). E2E 는 vitest include 에서 제외돼 있다.

## High-level Architecture

권위 있는 설계 문서: `docs/ARCHITECTURE.md`, `docs/PRD.md`, `docs/adr/000X-*.md`. 변경 전 ADR 확인 필수.

### 의존성 방향 (단방향, 순환 금지)
```
Web UI → Auth Proxy / Store Proxy
Auth Proxy → Crypto, (P2) Token Vault
Store Proxy → Crypto, Client Version Resolver, Meta Catalog
Notification Worker (P2) → Token Vault, Store internals, Wishlist, Email
```

### 핵심 모듈
- `app/api/auth/*` — Riot 비공식 auth flow (ssid → access_token → entitlements → PUUID). 브라우저는 `auth.riotgames.com` 과 직접 통신 (PW 가 서버를 거치지 않음). `AUTH_MODE` 환경변수로 모드 분기 (ssid/login/mfa route 들).
- `app/api/store/route.ts` + `lib/riot/storefront.ts` — `pd.kr.a.pvp.net/store/v2/storefront/{puuid}` 호출. `X-Riot-ClientVersion`, `X-Riot-ClientPlatform`, `X-Riot-Entitlements-JWT`, `Authorization: Bearer` 헤더 주입.
- `lib/riot/version.ts` — `valorant-api.com/v1/version` ISR 1h 캐시. 클라이언트 버전 하드코딩 회피.
- `lib/valorant-api/catalog.ts` — 스킨 메타 카탈로그 ISR 24h (`revalidate: 86400`). UUID → 이름/이미지/티어. ADR-0003.
- `lib/crypto/aes-gcm.ts` — Web Crypto API AES-GCM. 키는 `TOKEN_ENC_KEY` (서버 전용, `openssl rand -base64 32`).
- `lib/session/` — 세션 쿠키 / store / pending-jar / reauth / guard. `lib/auth/cookie.ts` 와 함께 인증 상태 관리.
- `lib/middleware/` — origin-check, rate-limit. Route Handler 진입 가드.
- `lib/domain/` — DB 에 묶이지 않은 순수 TypeScript 타입 (Spring `domain/` + `@Value` 대응). DB row 타입은 `lib/supabase/types.ts` 와 분리.
- `lib/worker/` + `app/api/cron/check-wishlist` (P2) — Vercel Cron 일 1회 (ADR-0009: Hobby 플랜 일 1회 한도). 스케줄 `5 15 * * *` (UTC) = KST 00:00~00:59 window. `notifications_sent` 테이블 idempotency 로 중복 메일 0.

### Riot auth 토큰 저장 (ADR-0002 hybrid)
- MVP: httpOnly cookie 한정.
- Phase 2: Supabase `user_tokens` 테이블 (pgcrypto + RLS user_id 본인) — 워커가 백그라운드에서 토큰을 사용해야 하기 때문에 서버 DB 로 확장. `user_tokens.needs_reauth` 플래그로 재인증 유도.

### Supabase migrations
순서대로 실행. `supabase/migrations/0001..0004_*.sql`. 신규 마이그레이션은 다음 번호로 추가 (수정 금지).

## Conventions

- 사용자 관련 docs/PRD/ADR 는 한국어. 코드 식별자/주석은 상황에 맞게 (기존 패턴 따름).
- ESLint flat config + `strictTypeChecked`. `no-console: error` (전역). 로깅은 `lib/logger.ts` 사용.
- `next.config.ts` 에 보안 헤더 (HSTS, X-Frame-Options, X-Content-Type-Options, CSP) 가 박혀 있음. 외부 origin 추가 시 CSP `connect-src` / `img-src` 둘 다 갱신.
- `typedRoutes: true` — `Route<...>` 타입 깨지지 않게 링크/router 사용 시 주의.
- 비공식 API 호출 헤더는 `lib/riot/` 에서 단일 책임으로 관리. Route Handler 에서 직접 fetch 하지 말 것.
- 시크릿 (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `TOKEN_ENC_KEY`, `RESEND_API_KEY`) 은 서버 전용. 클라이언트 번들로 새지 않도록 `NEXT_PUBLIC_` 접두사 금지.

## Plan / ADR workflow

작업 단위는 `docs/plan/NNNN_*.md` 로 관리되고 (현재 0001~0024), 커밋 메시지 컨벤션은 `impl(NNNN): <summary>`. 새 기능은 plan 파일 또는 ADR 을 먼저 확인/추가한 뒤 구현.
