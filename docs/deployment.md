# 배포 구성

공개 사이트: https://ai-herb-lab.rocketlee.chatgpt.site

2026-09-27 Sites 배포 성공 기록 기준입니다. 로그인 없이 접속 가능한 정적 사이트이며 로컬 PC에 의존하지 않습니다.

- Site ID: `appgprj_6ab929cbfe2c8191bfa2b94cfa265bbd`
- GitHub 저장소: https://github.com/r-ocketlee/AI-herb-lab
- 빌드 명령: `npm ci`, `npm test`, `npm run build`
- 정적 배포 대상: `dist/`
- Sites manifest: `static.directory`를 `dist`로 지정하고 기존 `project_id`를 유지

GitHub 소스 업데이트와 Sites 배포는 별도 작업입니다. 현재 자동 배포 워크플로는 없습니다. 수정 후 빌드 결과를 기존 Sites 체크아웃에 반영하고 소스 동기화 → 버전 저장 → 공개 배포 → 성공 확인 순서로 진행합니다. 인증 정보는 저장소에 넣지 않습니다.

## 영상

이 저장소의 개화 영상은 공개 사이트에서 사용한 1080p H.264 버전입니다. 원본 전시 영상은 로컬 보존본에 있습니다. 손상되어 사용하지 않던 dehumidifier_B 파일은 A 영상으로 대체했으며, 기존 설정도 두 변형 모두 A 경로를 사용합니다.

## 사진과 QR 증서

- 증서: https://ai-herb-lab.netlify.app/token.html
- 업로드: https://ai-herb-lab.netlify.app/.netlify/functions/upload

기존 Netlify 서비스를 계속 사용합니다. Sites에 Netlify 서버 함수가 배포되지는 않습니다. 사진 API 또는 QR 목적지의 증서 화면을 수정하면 Netlify에도 별도 반영해야 합니다. `netlify.toml`은 이 별도 배포용 구성입니다.

배포 성공과 실제 카메라·QR 전체 체험 검증은 별개입니다. 2026-09-27 배포 기록에서 실제 카메라 제스처, 사진 업로드부터 모바일 저장까지의 전체 검증은 미완료였습니다.

## 저장소 검증 — 2026-10-07

잠금 파일 기준 의존성 설치, 안정성 테스트 10개, 프로덕션 빌드가 통과했습니다. 실제 카메라와 현장 장시간 운영 검증을 대신하지는 않습니다.

`npm audit`에서 개발·빌드 도구 계열(Vite, esbuild, PostCSS, nanoid, source-map-js)의 경고 5개(높음 4, 보통 1)가 확인되었습니다. 이번 소스 업로드에서는 의존성의 주요 버전을 변경하지 않았습니다. 도구 업그레이드와 호환성 검증은 후속 유지보수 항목입니다.
