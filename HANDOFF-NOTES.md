# 인수인계 노트 (2026-06-11)

`README.md` + `docs/handover.md` 가 베이스 문서입니다. 이 파일은 그 위에 **현 시점에서 남은 작업 / 최근 변경 / 주요 튜닝 포인트**를 추가한 것입니다.

---

## 🚀 빠른 시작

```bash
node --version          # 18 이상 권장
npm install             # 의존성 설치 (한 번만)
npm run dev             # http://localhost:5173 (키오스크) / .../token.html (모바일)
npm run build           # dist/ 폴더 생성 → 정적 호스팅에 업로드
```

---

## 🔴 우선 채워야 할 에셋 (필수)

| 항목 | 개수 | 경로 패턴 | 비고 |
|---|---|---|---|
| **꽃 카드 PNG** | **15장** | `assets/cards/placeholder_<appliance>_<A\|B\|C>.png` | 5가전 × 3꽃. 토큰 뒷면 + 모바일 다운로드. 정사각형 720px+ 권장 |
| **인트로 카드3 이미지** | **1장** | `assets/images/intro/card3.png` | 카드 1·2·4는 있음. 3번만 누락 |
| **냉장고 개화 영상** | **1~3개** | `assets/videos/bloom/refrigerator.mp4` (또는 _A/_B/_C) | config을 단일 파일로 묶을 수도 있음 |
| **세탁기 개화 영상** | **1~3개** | `assets/videos/bloom/washer.mp4` (또는 _A/_B/_C) | 〃 |

> 공기청정기·제습기·스피커는 `<id>.mp4` 한 파일을 A/B/C가 공유 중. 같은 패턴으로 가도 됨.

### 영상 규격 권장
- **개화 영상 (bloom)**: 1920×1080, H.264 MP4, 5~10초, 30fps, 무음. 영상이 자연스럽게 끝나면 Card로 자동 전환.
- **씨앗 심기 영상 (seedVideo)**: 현재 5가전 모두 `seed-planting.mp4` 공유. 가전별 분기 원하면 각각 따로 만들고 config에서 분기.

---

## 🟡 선택 작업 (분위기/완성도)

| 항목 | 현 상태 |
|---|---|
| **사운드** | `src/core/AudioManager.js` 인프라 있음. `.load()` / `.play()` 호출 없음. 가전 선택 chime, 분석 ambient, 개화 piano 등 추가 가능 |
| **인트로 카드 강조** | Intro 슬라이드의 `<em>` 태그가 라벤더로 강조됨. 카피 수정 시 `config/assets.json` 의 `intro.slides[].html` 편집 |
| **모바일 뷰어 도메인** | `https://smart-herb-lab.netlify.app/token.html` 사용 중. 도메인 바꾸려면 `config/assets.json` 의 `tokenViewerBase` 한 줄 + Netlify 재배포 |

---

## 📋 인터랙션 텍스트 전체 맵

상태머신 흐름 순서대로. 굵게 표시된 것은 **사용자에게 강하게 어필되는 키 메시지**.

| 화면 | 텍스트 | weight |
|---|---|---|
| Idle 환영 | AI Herb Lab에 오신 것을 환영합니다 | 32px **Semibold** |
| Intro 슬라이드 1 | 2050년의 가전은 설정하는 기기가 아닌, 당신과 *함께 자라나는 돌봄형 미래 가전*입니다 | 32px Regular (* Semibold) |
| Intro 슬라이드 2 | 그 중심에는 가전에 직접 심어 키우는 *씨앗 형태의 AI Herb*가 있습니다 | 〃 |
| Intro 슬라이드 3 | *AI Herb*는 당신의 데이터를 학습하며 가전을 점점 당신에게 맞춰갑니다 | 〃 |
| Intro 슬라이드 4 | 자라난 씨앗은 마침내 *당신만을 위한 한 송이 꽃*으로 피어납니다 | 〃 |
| Intro Finale | 이곳 AI Herb Lab에서 직접 씨앗을 심고 키워<br>나만의 AI Herb를 분양받아 가세요 | 32px **Semibold** |
| SeedSelect 가이드 | 손을 뻗어 원하는 가전에 씨앗 형태의 AI Herb을 가져가 보세요 | 28px **Semibold** |
| SeedSelect 가전 라벨 | (가전명) / (모델명) | 32px **Semibold** / 16px Regular |
| Analyzing | AI Herb가 당신의 생활패턴과 취향을 학습하고 있습니다 | 32px **Semibold** |
| SeedPlant | AI Herb를 가전에 심는 중입니다 | 28px **Semibold** (흰색) |
| Bloom 0~3초 | 손을 하단에서 상단으로 천천히 올려 AI Herb를 키워보세요 | 28px **Semibold** |
| Bloom 3초 이후 | 이제 손을 내려도 괜찮습니다. 꽃이 피어납니다 | 28px **Semibold** |
| Card 가이드 | 손을 움직여 나만의 AI Herb을 자세히 돌려보실 수 있습니다<br>QR을 스캔하여 씨앗을 직접 가져가세요 | 28px **Semibold** |

### 텍스트 수정 위치
- **Intro 슬라이드**: `config/assets.json` → `intro.slides`
- **모든 그 외 텍스트**: 각 state 파일 상단의 `GUIDE_TEXT` / `WELCOME_TEXT` / `LABEL_TEXT` / `FINALE_HTML` / `GUIDE_INITIAL` / `GUIDE_AUTO` / `GUIDE_HTML` 상수

### 텍스트 등장/사라짐 효과
모든 텍스트가 **MorphingText**(blob 효과)로 등장하고 사라집니다. 코드는 `src/ui/MorphingText.js`. 셰이더는 SVG threshold filter + blur 기반.

---

## ⏱️ 주요 타이밍 (config/assets.json `timings`)

| 항목 | 현재값 | 의미 |
|---|---|---|
| `idleEntryDwellMs` | 2500 | 사람 감지 후 Intro 진입까지 대기 |
| `slideMs` (intro) | 5000 | 인트로 슬라이드 1장당 시간 |
| `analyzingMs` | 18000 | 분석 화면 전체 길이 (HOLD 단계가 사진 찍는 시간) |
| `seedSelectDwellMs` | 5000 | 가전 위에서 dwell 시간 (선택 확정) |
| `cardResetMs` | 30000 | 토큰 화면 노출 후 Idle로 복귀 |

---

## 🎛️ 자주 만지는 튜닝 포인트

### AnalyzingState (분석 화면 — 사진 찍기 좋게 만들기)
`src/ui/PixelGridDissolve.js`:
- `T_IRIS_START` (0.10), `T_HOLD_START` (0.30), `T_DRAIN_START` (0.65), `T_BLACK_START` (0.90) — phase 비율
- `BG_HOLD_ALPHA` (0.40) — HOLD 단계 배경 다크닝 강도
- `gridCols/Rows` (80) — 픽셀 크기 (↑ 작아짐, ↓ 커짐)
- `gapRatio` (0.20) — 점 사이 간격

### BloomState (개화)
`src/states/BloomState.js`:
- `AUTO_PLAY_DELAY_MS` (3000) — 자동 재생까지 대기 시간
- `GUIDE_INITIAL`, `GUIDE_AUTO` — 가이드 텍스트 2개

### SeedSelectState (가전 선택)
`src/states/SeedSelectState.js`:
- `DWELL_MS` (5000) — 가전 위에서 게이지 차오르는 시간
- `PROXIMITY_PX` (220) — 씨앗이 가전 끌어당기는 거리
- `MAGNET_STRENGTH` (0.30) — 자석 강도

### CardState (엔딩 토큰)
`src/states/CardState.js`:
- 토큰 회전 모션 파라미터 — Token3D 모듈 내부
- QR 사이즈 — `width: 600` (스캔 안정성)

---

## 🖥️ 키오스크 배포 (Windows)

```bash
npm run build                       # dist/ 생성
# dist/ 폴더를 정적 호스팅에 업로드 (Netlify, 내부 웹서버 등)
```

Chrome 키오스크 모드 실행 예:
```
chrome.exe --kiosk --disable-pinch --disable-features=TranslateUI ^
  --autoplay-policy=no-user-gesture-required http://<your-host>/
```

마이크/카메라 권한은 첫 실행 시 한 번만 허용하면 도메인별로 기억됨.

---

## 🔌 외부 의존성 (런타임 CDN 로드)

- **MediaPipe Tasks Vision WASM + 모델**: `https://cdn.jsdelivr.net/...` + `https://storage.googleapis.com/mediapipe-models/...`
  - 위치: `src/core/HandTracker.js`, `src/core/PoseTracker.js`
  - 오프라인 환경이면 WASM/모델을 로컬로 내려서 `assets/mediapipe/` 등에 두고 경로 변경 필요

- **@paper-design/shaders**: npm 패키지 (IdleState MeshGradient용)
- **three, @mediapipe/tasks-vision, qrcode**: 모두 `node_modules/`에 묶임 → 빌드 후 dist에 포함

---

## ⚠️ 알려진 이슈 / 메모

1. **사운드 안 들어가있음** — AudioManager는 호출만 하면 됨. 자료 받으면 5분 작업.
2. **Card 이미지 누락 시 토큰 뒷면**: 빈 영역 + 텍스트 곡선만 보임 (에러 안 남, 그냥 살벌하게 비어 보임).
3. **냉장고/세탁기 개화 영상 누락 시**: 흰 배경 + "개화 영상 없음" placeholder가 보임. 영상 채우면 자동으로 정상 동작.
4. **idle.mp4** 파일은 더 이상 사용 안 함 (MeshGradient로 교체). config 키만 남아있고 코드에서 참조 안 함.
5. **포즈/손 검출이 어두운 환경에서 약함** — 키오스크 조명 따로 챙기기.

---

## 🛠️ 현장 운영 (Operations)

- **매일 오픈 전 1회 수동 재시작 권장** — 브라우저(키오스크)를 하루에 한 번 새로 띄워 메모리를 정리하세요. (무활동 5분 시 자동 새로고침도 동작하지만, 오픈 전 수동 재시작이 가장 안전합니다.)
- 자동 안전망(코드에 내장, 별도 조작 불필요):
  - 인터랙션 중 사람 미감지 20초 → "계속하시겠어요?" 일시정지 화면 → 추가 20초 미감지 시 시작 화면으로 자동 복귀
  - 자동 진행 단계(인트로/분석/씨앗심기)는 재생을 끝내고, 종료 시 사람이 없으면 시작 화면으로 복귀
  - 웹캠이 끊기면 "카메라를 확인해주세요" 화면 + 자동 재연결 시도 (검은 화면으로 멈추지 않음)
  - 대기 화면 5분 무활동 시 자동 새로고침
- 카메라 USB/조명은 오픈 전 점검. 인터넷 연결 필수(MediaPipe/셰이더 CDN).

## 📞 문의 / 작업 인계

기술적 질문이나 추가 작업 인계 시:
- 디자인/카피: 박서영
- 코드 작업 이력: 이 폴더의 `.git` 히스토리 참조 (`git log --oneline`)
- 모바일 뷰어 Netlify 계정 / 도메인 변경 권한: (배포자 정보 추가)
