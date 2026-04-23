# ADR-0001: unofficial-riot-auth

- 작성일: 2026-04-23
- 상태: ACCEPTED
- 연관: [PRD](../PRD.md#7-제약), [Architecture](../ARCHITECTURE.md#2-컴포넌트)

## Context

VAL-Shop 은 유저의 개인 발로란트 상점 (오늘의 스킨 4개) 을 조회해야 한다. 상점 데이터는 Riot 내부 엔드포인트 `pd.{region}.a.pvp.net/store/v2/storefront/{puuid}` 에만 존재하며, 이 엔드포인트는 `access_token`, `entitlements_token`, `PUUID` 3 종 자격증명을 요구한다.

Riot 은 공식 OAuth2 "Riot Sign-On (RSO)" 을 제공하지만, 일반 개발자가 신청해서 승인받을 수 있는 스코프는 리그 오브 레전드 / TFT 공개 데이터뿐이고, 발로란트 개인 상점 스코프는 **사전 심사된 대형 파트너** (Blitz.gg, Tracker.gg 등) 에게만 비공개 계약으로 허가된다. 3일 데드라인의 개인 프로젝트에서 이 경로는 사실상 닫혀있다.

커뮤니티는 Riot 게임 클라이언트가 사용하는 auth 흐름 (`auth.riotgames.com` 의 ssid cookie 리다이렉트 + access_token 추출 + `entitlements.auth.riotgames.com` JWT 교환) 을 역공학해 유지 중이다. 이 "비공식 auth flow" 는 PRD 측정 가능 목표 (TTI, 비용, 데드라인) 달성의 유일한 현실적 경로이나, Riot 이 언제든 차단·변경할 수 있는 리스크를 동반한다.

## Decision

**비공식 Riot auth flow 를 채택**한다. 브라우저가 `auth.riotgames.com` 과 직접 HTTPS 통신하여 ssid cookie 를 받고, 앱 서버는 이 cookie 를 받아 Riot 에 재요청해 `access_token` + `entitlements_token` + `PUUID` 를 교환한다. 비밀번호는 어느 시점에도 앱 서버를 거치지 않는다.

이유:
1. 공식 RSO 는 승인 요건상 접근 불가.
2. PRD § 3 의 MVP 목표 (로그인→상점 표시) 를 달성할 유일한 경로.
3. Riot 차단 리스크는 PRD § 7 에 "수용 가능 리스크" 로 명문화됨.
4. 커뮤니티 라이브러리 (`unofficial-valorant-api`, `python-valclient` 패턴) 가 수년간 유지되어 왔으며, 차단 시 신호가 공개적으로 전파됨.

## Alternatives Considered

- **Option A (선택)**: Riot 비공식 auth flow. Pros: 구현 가능, 무료, 수 시간 내 동작. Cons: 라이엇 정책 변경 시 전면 중단, ToS 그레이존.
- **Option B**: 공식 Riot Sign-On (OAuth2). Pros: 안정적·정식 경로, ToS 준수. Cons: 발로란트 스코프 승인 사실상 불가능, 심사 기간 수 주~수개월, 개인 프로젝트 거절 가능성 높음 → **기각 이유: 3일 데드라인에 부적합**.
- **Option C**: 유저가 직접 발로란트 클라이언트에서 토큰을 추출해 앱에 붙여넣기. Pros: auth 구현 0 라인. Cons: 유저 UX 최악, 토큰 만료 시마다 수동 갱신, 타인에게 배포 불가 → **기각 이유: PRD § 3 목표 "빠른·가벼운" 경험 위배**.

## Consequences

- Positive: 며칠 내 MVP 가능. 비용 $0. PW 서버 미저장 원칙 유지 가능 (브라우저↔Riot 직통).
- Negative: Riot 이 비공식 경로를 차단하면 서비스 중단. ToS 회색지대라 Riot 이 DMCA/차단 요청 시 수용해야 함. 커뮤니티 라이브러리 / 엔드포인트 스키마 변경을 상시 모니터링해야 함 (유지보수 부채).
- Neutral: 유저는 "fan-made, 라이엇 무관" 고지를 반드시 봐야 함 (§ 7 제약). 공식 RSO 로 migrate 하려면 전체 auth 레이어 재작성 필요 (locked-in 은 아님, 교체 비용은 있음).
