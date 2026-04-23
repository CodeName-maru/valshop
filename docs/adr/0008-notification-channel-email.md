# ADR-0008: notification-channel-email

- 작성일: 2026-04-23
- 상태: ACCEPTED
- 연관: [PRD](../PRD.md#3-목표--non-goals), [Architecture](../ARCHITECTURE.md#2-컴포넌트), [ADR-0004](0004-push-worker-vercel-cron-hourly.md)

## Context

PRD Phase 2 FR-8 은 위시리스트 스킨이 상점에 뜰 때 유저에게 알림을 도달시키는 요구이다. 초기 아키텍처는 Web Push (VAPID) 를 가정했으나 재검토 결과 다음 제약이 드러났다:

1. **iOS Safari 제약**: Web Push 는 iOS 16.4 이상 + **홈 화면에 PWA 로 설치된 경우에만** 동작. 유저가 브라우저에서만 접속한다면 알림 수신 불가.
2. **VAPID 셋업 비용**: 서버·클라이언트 키 페어 생성, 브라우저 subscription 등록 플로우, `push_subscriptions` 테이블, service worker 등 인프라 증가.
3. **개인 프로젝트 타겟**: PRD § 2 에서 Primary 사용자는 본인, Secondary 없음으로 정의. Web Push 특유의 "웹 알림 UX" 가 꼭 필요하지 않다.

한편 이메일은 (a) 무료 티어 넉넉 (Resend 3000/월), (b) 디바이스 제약 없음 (iOS/Android/PC 전부 도달), (c) PWA 설치 강요 없음, (d) 매칭 시에만 발송이라 스팸 아님. 개인 프로젝트 맥락에서 압도적으로 단순하다.

## Decision

**이메일 알림을 기본 채널로 채택**한다. 제공자는 **Resend**. Phase 2 워커 (`/api/cron/check-wishlist`) 는 매칭 발견 시 `lib/email/dispatch.ts` 를 통해 Resend API 로 이메일을 보낸다. 수신 주소는 Supabase Auth 의 이메일 필드를 사용한다 (별도 구독 테이블 불필요).

Web Push 는 이번 Phase 2 범위에서 제외. 향후 본인 외 유저가 늘고 실시간성이 더 필요할 때 추가 채널로 도입 가능.

이유:
1. 디바이스·브라우저 종속성 0 → iOS/Android/PC 모두 커버.
2. Resend 의 Next.js 통합은 "한 줄 import + await" 수준. 개발 시간 최소.
3. 구독 관리·subscription sync 불필요 → Phase 2 DB 스키마에서 `push_subscriptions` 테이블 제거.
4. 1시간 cron 주기 (ADR-0004) 와 이메일 도달 특성이 정합 (푸시의 즉시성 장점이 어차피 cron 제약으로 희석됨).

## Alternatives Considered

- **Option A (선택)**: Resend 이메일. Pros: 무료 3000/월, Next.js 친화적, 디바이스 무관, 구독 테이블 불필요. Cons: 이메일 고유의 도달 지연 (수 초~수 분), Gmail 프로모션 탭 분류 가능성.
- **Option B**: Web Push (VAPID). Pros: 즉시성, 네이티브 앱 유사 UX. Cons: iOS 16.4+ + PWA 설치 필수, VAPID 키·service worker·subscription 테이블 셋업, PWA 미설치 유저에겐 도달 불가 → **기각 이유: 개인용 앱에 인프라 과함, iOS 제약 치명적**.
- **Option C**: Supabase 내장 SMTP + Edge Function. Pros: Phase 2 에 이미 Supabase 있음, 추가 서비스 0. Cons: Supabase 무료 SMTP 는 auth 메일 (verification, password reset) 전용으로 제한되어 일반 앱 이메일 발송은 정책 위반 리스크 → **기각 이유: 용도 미스매치**.
- **Option D**: SendGrid. Pros: 이메일 전용 전통 강자. Cons: 무료 100/일 (Resend 의 3000/월 대비 유사하나 일 한도가 빡빡), Next.js 공식 예제 부재, API 셋업 더 번거로움 → **기각 이유: Resend 대비 셋업·DX 열위**.
- **Option E**: Slack / Discord Webhook. Pros: 무료, 셋업 단순. Cons: 유저가 해당 플랫폼 계정·워크스페이스 있어야 함, 일반화 어려움 → **기각 이유: 유저 기반 확장 시 제약**.

## Consequences

- Positive: Phase 2 구현 난이도 크게 하락. iOS/Android/PC 전방위 도달. `push_subscriptions` 테이블·service worker 불필요 → Architecture § 5.1 스키마 단순화. Resend 대시보드로 발송 로그 확인 가능 (운영성 보강).
- Negative: 이메일 고유 지연 (1분 내외) + 스팸 필터 리스크. 유저가 이메일을 주기적으로 확인하지 않는 습관이면 알림 의미 퇴색. "네이티브 앱 같은 UX" 감성 상실.
- Neutral: Resend free tier 초과 시 ($20/월 Pro) 유료 전환 또는 제공자 교체. 현재 타겟 유저 수 (본인 + 약간) 기준 초과 가능성 매우 낮음. 본인 도메인을 Resend 에 등록하면 전달률 상승 (옵션, 필수 아님).
