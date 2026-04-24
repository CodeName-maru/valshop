# VAL-Shop 배포 가이드

이 문서는 VAL-Shop을 Vercel에 배포하는 절차와 운영 방법을 설명합니다.

## Vercel 프로젝트 생성

1. [Vercel Dashboard](https://vercel.com/dashboard)에 접속
2. "Add New Project" 클릭
3. GitHub 레포지토리 연동 (최초 1회)
4. `valshop` 레포지토리 선택
5. Framework Preset: "Next.js" 자동 감지됨
6. **Environment Variables** 설정:
   - `TOKEN_ENC_KEY`: 32자리 이상 무작위 문자열 (필수)
   - Phase 2 이후: `SUPABASE_URL`, `RESEND_API_KEY` (선택)

## 자동 배포

`main` 브랜치에 push하면 Vercel가 자동으로 배포를 시작합니다:

```bash
git checkout main
git merge impl/0010-infra
git push origin main
```

배포 URL: `https://valshop-xxx.vercel.app` (Dashboard에서 확인)

## Instant Rollback

배포 후 문제 발생 시 즉시 이전 버전으로 롤백:

1. Vercel Dashboard → 프로젝트 → Deployments
2. 롤백할 배포 선택 (Promoted to Production 표시)
3. "Promote to Production" 클릭
4. 즉시 프로덕션 트래픽이 해당 버전으로 전환

## 무료 티어 한도 모니터링 (AC-6)

Vercel Hobby Plan 한도:

| 항목 | 한도 | 비고 |
|------|------|------|
| Function Invocations | 100GB-Hrs/월 | Serverless 함수 실행 시간 |
| Bandwidth | 100GB/월 | 다운로드 + 업로드 |
| Build Minutes | 6000분/월 | 빌드 시간 |

모니터링 방법:
- Vercel Dashboard → Usage 탭에서 실시간 확인
- 한도 근접 시 이메일 알림 (설정 필요)

## 로컬에서 배포 테스트

```bash
# 로컬에서 production 빌드 테스트
npm run build
npm run start

# Lighthouse 성능 측정 (AC-4: TTI ≤ 3s)
npm run lhci
```

## 문제 해결

### 배포 실패
- Environment Variables 확인 (TOKEN_ENC_KEY 필수)
- Build log에서 `next build` 에러 확인

### Service Worker 작동 안 함
- `/sw.js`가 배포되었는지 확인
- HTTPS만 지원 (localhost 제외)

### PWA 설치 배너 안 뜸
- Chrome DevTools → Application → Manifest 확인
- Lighthouse PWA 점수 체크
