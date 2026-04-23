# ADR-0002: token-storage-hybrid

- 작성일: 2026-04-23
- 상태: ACCEPTED
- 연관: [PRD](../PRD.md#5-기능-요구사항), [Architecture](../ARCHITECTURE.md#2-컴포넌트)

## Context

PRD § 6 Security 는 "RSO 토큰 AES 암호화 + PW 서버 미저장 + 서버측 Supabase token vault (암호화 저장)" 를 요구한다. 토큰이 담는 민감도는 유저 라이엇 계정의 상점·매치 정보 접근 권한이며, 탈취 시 계정 전체 권한은 아니지만 프라이버시 침해는 확실하다.

MVP 는 서버리스 Route Handler 가 즉시 응답하면 되므로 저장소가 없어도 동작하지만, 세션 유지 (FR-2) 를 위해 어딘가엔 토큰을 보관해야 한다. Phase 2 의 주기 워커 (FR-8) 는 유저가 접속하지 않은 상태에서도 토큰을 써야 하므로 서버측 저장이 반드시 필요하다.

여러 저장 위치 옵션이 있으며 각각 트레이드오프가 다르다: 브라우저 localStorage (간편·XSS 취약), httpOnly cookie (XSS 안전·CSRF 대응 필요), 서버 세션 스토어 (무상태 서버리스와 상충), Supabase vault (Phase 2 워커 필수, MVP 오버엔지니어링).

## Decision

**하이브리드 저장**: MVP 단계에서는 **AES-GCM 암호화된 토큰을 httpOnly + SameSite=Lax + Secure cookie** 로 설정하여 브라우저에 보관한다. Phase 2 진입 시점에 **Supabase `user_tokens` 테이블** 을 추가하여 cookie 와 **동시에 서버측 vault** 에 저장한다. 복호화 키 `TOKEN_ENC_KEY` 는 Vercel 환경변수.

이유:
1. MVP 에는 워커가 없으므로 서버 DB 불필요. cookie 만으로 세션 유지와 서버사이드 Route Handler 접근 모두 만족.
2. httpOnly 는 JS 에서 읽을 수 없어 XSS 토큰 탈취 차단. SameSite=Lax 는 CSRF 기본 대응.
3. AES-GCM 을 **추가로** 적용해 Vercel 로그·에러 리포트 등에 cookie 원본이 노출되어도 평문 토큰 유출 방지.
4. Phase 2 에서 vault 를 도입할 때 기존 cookie 는 그대로 유지 → 유저 재로그인 불필요한 migration.

## Alternatives Considered

- **Option A (선택)**: httpOnly cookie (AES-GCM) — MVP + Supabase vault — Phase 2 하이브리드. Pros: MVP 에 불필요한 DB 없음, Phase 2 워커 요구 충족, 점진적 migration 가능, XSS·CSRF 기본 대응. Cons: cookie ↔ DB 양쪽 동기화 책임 (Phase 2).
- **Option B**: AES-GCM 암호화된 토큰을 `localStorage` 에 저장. Pros: 서버 cookie 설정 없이 클라이언트만으로 제어. Cons: XSS 로 JS 가 직접 읽기 가능 (AES 키가 서버 전용이라도, 클라로 보내야 복호화되므로 키 노출), Route Handler 가 SSR 시 cookie 처럼 자동 전송되지 않음 → **기각 이유: 보안 · SSR UX 모두 열위**.
- **Option C**: Supabase `user_tokens` 테이블 MVP 부터 사용. Pros: 단일 소스, Phase 2 추가 작업 없음. Cons: MVP 에 DB 도입 오버헤드 (RLS 정책, 마이그레이션, Supabase client 셋업), 3일 데드라인 압박, Supabase 장애 시 로그인 불능 → **기각 이유: MVP 단순성·데드라인 우선**.
- **Option D**: NextAuth.js adapter. Pros: 세션·refresh 자동 관리. Cons: Riot OAuth provider 미지원 (비공식 flow 커스텀 작성 필요), 추상화 레이어가 커뮤니티 패턴과 마찰, 학습 곡선 → **기각 이유: 얻는 것 대비 복잡도 과함**.

## Consequences

- Positive: MVP 인프라 최소화 → 주말 데드라인 현실성 확보. httpOnly + AES-GCM 이중 방어로 Security NFR 충족. Phase 2 vault 도입 시 cookie 코드 재사용.
- Negative: Phase 2 에서 cookie ↔ vault 동기화 로직 필요 (로그인 시 양쪽 쓰기, 로그아웃 시 양쪽 삭제). AES 키 유출 시 서버 저장 토큰 전체 노출 (Security 가정이 키 보안에 의존).
- Neutral: cookie 크기 (암호화 후 ~1-2 KB) 가 4KB 한도 내에서 관리되어야 함. AES-GCM 구현은 Web Crypto API 로 외부 의존 없이 가능.
