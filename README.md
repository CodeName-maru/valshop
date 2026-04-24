# VAL-Shop

Valorant 스킨 상점 알림 PWA (Web App)

## 개요

VAL-Shop은 Riot Games의 Valorant 게임 내 상점 로테이션을 모니터링하고, 위시리스트에 담은 스킨이 상점에 등장하면 이메일로 알림을 보내주는 비공식 팬 프로젝트입니다.

**중요**: 이 프로젝트는 Riot Games와 제휴하지 않은 비공식(fan-made) 프로젝트입니다.

## 기능

- **MVP (Phase 1)**:
  - Riot 계정으로 로그인 (비공식 auth flow)
  - 오늘의 상점 4개 스킨 표시
  - 로테이션 종료 카운트다운
  - 로그아웃

- **Phase 2**:
  - 스킨 검색 및 위시리스트 CRUD
  - 일 1회 폴링 워커 실행 (ADR-0009: Vercel Hobby 일 1회 cron 한도 준수)
  - 위시리스트 스킨 상점 등장 시 이메일 알림

## 시작하기

### 사전 요구사항

- Node.js 18+
- npm or yarn

### 환경변수 설정

`.env.local` 파일을 생성하고 다음 환경변수를 설정하세요:

```bash
# Core (MVP)
TOKEN_ENC_KEY=  # openssl rand -base64 32

# Phase 2: Supabase (Database + Auth)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Phase 2: Email Notifications (Resend)
RESEND_API_KEY=
RESEND_FROM_EMAIL=  # Resend에서 검증된 이메일 주소

# Phase 2: Cron Worker Security
CRON_SECRET=  # openssl rand -base64 32
```

### 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build
npm start
```

## 데이터베이스 마이그레이션

Supabase 프로젝트를 생성한 후, `supabase/migrations/` 폴더의 SQL 파일을 순서대로 실행하세요:

1. `0001_user_tokens.sql` - 사용자 토큰 저장소
2. `0002_wishlist.sql` - 위시리스트 테이블
3. `0003_notifications_sent.sql` - 알림 발송 기록
4. `0004_user_tokens_needs_reauth.sql` - 재인증 필요 플래그

## 배포

### Vercel 배포

1. Vercel 프로젝트 생성
2. 환경변수 설정 (Environment Variables 탭)
3. `vercel.json` 에 정의된 Cron이 자동으로 활성화됩니다

#### Cron 스케줄 (Phase 2)

- 스케줄: `5 15 * * *` — UTC 15:05 = KST 00:05
- 실제 발동: Vercel Hobby 는 해당 hour 내 임의 시점에 발동하므로 **KST 00:00~00:59 window**
  에서 1일 1회 실행됩니다. 상점 로테이션(KST 00:00) 직후 폴링이 보장됩니다.
- 배경: Vercel Hobby 플랜은 일 1회 cron 만 허용합니다 (ADR-0009 참조).
  sub-daily 표현 (`0 * * * *`, `*/5 * * * *` 등) 은 배포 자체가 실패합니다.
- 중복 발동: `notifications_sent` 테이블의 idempotency 로 동일 로테이션 중복 메일 0.

### 수동으로 워커 실행 (테스트)

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/cron/check-wishlist
```

### 롤백 (Cron 중지)

Cron을 즉시 중지하려면 `vercel.json` 의 `crons` 배열을 비우고 재배포하세요:

```json
{
  "crons": []
}
```

## 테스트

```bash
# Critical path 테스트 (네트워크/DB 없음)
npm test

# E2E 테스트
npm run test:e2e
```

## Lighthouse 로컬 측정

PWA 설치 가능성(installability) 및 성능 회귀를 로컬에서 확인하려면 `@lhci/cli` 를 사용합니다. CI 자동화는 비용(NFR) 제약으로 도입하지 않았으며, 배포 전 수동 스모크를 권장합니다.

```bash
# 프로덕션 빌드 후 서버 기동
npm run build
npm start

# 별도 터미널에서 Lighthouse 실행
npx lhci autorun --collect.url=http://localhost:3000/dashboard
```

- PWA 카테고리 점수(특히 "Installable") 가 통과하는지 확인하세요.
- 아이콘 자산은 `npm run icons` 로 재생성합니다 (SVG 소스 변경 시 수동 실행). 생성된 PNG/ICO 는 git 에 커밋되어 빌드 시 재생성되지 않습니다 — production 빌드는 `sharp`/`tsx` (devDependency) 없이 동작합니다.
- 본 프로젝트는 팬메이드(fan-made) 프로젝트로 Riot Games 공식 자산을 사용하지 않습니다 (하단 고지 참고).

## 개인정보처리방침

이 프로젝트는 다음 데이터를 수집합니다:

- **PUUID**: Riot Games 고유 식별자 (토큰 복호화 필요)
- **위시리스트**: 사용자가 선택한 스킨 UUID 목록

모든 데이터는 AES-GCM 256으로 암호화되어 저장됩니다. 자세한 내용은 `/privacy` 페이지를 참조하세요.

## 라이선스

ISC

---

**fan-made project** — Riot Games와 제휴하지 않은 비공식 프로젝트입니다.
