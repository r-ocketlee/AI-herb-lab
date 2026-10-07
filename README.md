# AI Herb Lab

관람객의 손과 몸짓으로 씨앗을 심고, 키우고, 꽃을 피우는 웹 기반 인터랙티브 전시 프로그램입니다. LG전자 × 홍익대학교 협업 전시를 위해 제작했습니다.

**[공개 사이트](https://ai-herb-lab.rocketlee.chatgpt.site)**

## Experience

입장·손 인식 → 5종 미래 가전 선택 → 분석·촬영 연출 → 성장·개화 → QR 분양 증서

웹캠 제스처로 화면을 조작하고, 체험 결과를 모바일 증서로 저장합니다. MediaPipe가 손·신체를 인식하며, 꽃은 사전 제작된 영상 중 무작위로 선택됩니다. 실시간 생성형 AI로 꽃을 만드는 방식은 아닙니다.

## Stack

JavaScript · HTML/CSS · Vite · MediaPipe · Three.js · Canvas · Paper Shaders
QR/이미지 저장: qrcode · html2canvas / 사진 API: Netlify Functions · Blobs

## Run

Node.js와 npm을 설치한 뒤 실행합니다.

```bash
npm ci
npm run dev
```

브라우저에서 `http://localhost:5173`을 열고 카메라를 허용하세요. 카메라는 **HTTPS 또는 localhost**에서 사용합니다. 화면만 확인하려면 `N`으로 다음 장면, `R`로 처음으로 돌아갈 수 있습니다.

```bash
npm test          # 안정성 검사
npm run build    # dist/ 생성
npm run preview  # 빌드 결과 확인
```

## Maintenance

상태 재진입·인식 루프·지연 콜백 오류를 수정하고, 시작 화면과 안내·전환 모션을 정리했습니다. 콘텐츠와 타이밍은 `config/assets.json`에서 관리합니다.

GitHub 업데이트와 공개 사이트 배포는 별도입니다. 같은 사이트에 재배포하면 기존 주소가 유지됩니다. 사진·QR 증서는 기존 Netlify 서비스를 사용합니다.

[변경 기록](MAINTENANCE-2026-09-22.md) · [배포 안내](docs/deployment.md)

## Credit

인터랙션 기획·화면 설계·AI 도구를 활용한 코드 구현·현장 설치: **이수연(Rocket)**
영상 제작은 별도 참여자가 담당했습니다.
