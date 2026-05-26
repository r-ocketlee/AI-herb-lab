# Smart Herb AI Lab

LG전자 × 홍익대 협업 인터랙티브 전시. 95" LG OLED + USB 웹캠 + Windows 미디어서버에서 Chrome 키오스크 모드로 구동되는 웹 기반 경험.

> **관람객 흐름**: 손동작으로 가전을 선택 → AI 분석 연출 → 씨앗 심기 → 손으로 꽃을 피움 → 3D 토큰 카드 + QR로 모바일에 영구 저장

## Live

- **모바일 토큰 뷰어 (배포됨)**: https://smart-herb-lab.netlify.app/token.html?a=speaker&f=A&d=2026-05-27
- **키오스크 (로컬 전용)**: `npm run dev` 후 http://localhost:5173

## Tech Stack

- **Vite** 멀티 엔트리 빌드 (키오스크 `index.html` + 모바일 `token.html`)
- **MediaPipe Tasks Vision** — 손/포즈 실시간 트래킹 (WebGL 2 + GPU delegate)
- **Three.js** — 3D 토큰 (마지막 카드 단계)
- **Canvas 2D** — 구형 캐러셀 (110 노드, Fibonacci 분포), 파티클 이펙트
- **QRCode.js** — 모바일 토큰 페이지 링크 인코딩
- **LGEIHeadline** 폰트 (로컬 OTF, CDN 없음)

의존성 전체는 `package.json` 참조.

## Quick Start

```bash
# Node.js 18+ 필요
npm install

# 키오스크 + 모바일 뷰어 동시 dev 서버 (HMR)
npm run dev
# → http://localhost:5173            (키오스크)
# → http://localhost:5173/token.html (모바일 뷰어)

# 프로덕션 빌드
npm run build
# → dist/ 폴더 생성 (Netlify/static host에 그대로 업로드)
```

## 상태 머신 흐름

```
Idle → SeedSelect → Analyzing → SeedPlant → Bloom → Card → (loop)
 0       1            2           3           4      5
```

각 상태는 `src/states/*.js`로 분리. 공유 싱글톤(`HandTracker`, `PoseTracker`, `Webcam`, `AssetConfig`, `AudioManager`)은 `src/core/`.

## 디렉토리 구조 (요약)

```
smart-herb-lab/
├── index.html              # 키오스크 엔트리
├── token.html              # 모바일 토큰 뷰어 엔트리
├── vite.config.js          # 멀티 엔트리 빌드
├── src/
│   ├── main.js             # 키오스크 부트
│   ├── token-main.js       # 모바일 뷰어 부트
│   ├── core/               # 상태머신, MediaPipe 래퍼, config 로더
│   ├── states/             # 6단계 상태 클래스
│   ├── ui/                 # SphereCarousel, Token3D, WebcamFeed 등
│   └── styles/             # CSS
├── assets/                 # 폰트, 가전 이미지, 영상, 카드
├── config/assets.json      # 가전-꽃 매핑, 타이밍, QR URL 등
├── scripts/copy-static.mjs # vite build 후 /assets, /config를 dist로 복사
└── docs/handover.md        # 상세 기술 인수인계 문서
```

## 주요 문서

- **[docs/handover.md](./docs/handover.md)** — 아키텍처, 핵심 모듈 동작, 확장 가이드, 알려진 제약 등 인수인계 풀버전
- **[docs/handover.pdf](./docs/handover.pdf)** — 위 문서의 PDF 버전 (출력/공유용)

## 콘텐츠 교체

`/assets`에 파일 덮어쓰고 `config/assets.json` 경로 갱신 → Chrome `F5`. 자세한 규격(코덱, 해상도)은 handover 문서 §6 참조.

## 배포 환경

- **키오스크**: Windows 10/11 + Chrome 120+ + 95" LG OLED 4K + USB-Optical Extender 웹캠
- **모바일 뷰어**: Netlify static hosting (`tokenViewerBase` config 한 줄로 도메인 교체 가능)

## License

내부 사용 / TBD
