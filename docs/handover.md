# Smart Herb AI Lab — 기술 인수인계 문서

> **대상**: 본 프로젝트를 인수받아 유지보수할 개발자
> **범위**: 키오스크 웹앱 + 모바일 토큰 뷰어
> **최종 갱신**: 2026-05-27

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [디렉토리 구조](#2-디렉토리-구조)
3. [기술 스택 상세](#3-기술-스택-상세)
4. [핵심 모듈 설명](#4-핵심-모듈-설명)
5. [Config 구조](#5-config-구조)
6. [에셋 교체 규격](#6-에셋-교체-규격)
7. [빌드 및 배포](#7-빌드-및-배포)
8. [환경 요구사항](#8-환경-요구사항)
9. [알려진 이슈 및 제약사항](#9-알려진-이슈-및-제약사항)
10. [확장 가이드](#10-확장-가이드)

---

## 1. 아키텍처 개요

### 시스템 레벨 다이어그램

```
┌──────────────────────── KIOSK PC (Windows) ────────────────────────┐
│                                                                      │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  Chrome (kiosk mode) — http://localhost:8080             │      │
│  │  ┌──────────────────────────────────────────────────┐    │      │
│  │  │  index.html (main.js)                            │    │      │
│  │  │  ┌────────────────────────────────────────────┐  │    │      │
│  │  │  │ StateMachine                               │  │    │      │
│  │  │  │   ↓ transition                             │  │    │      │
│  │  │  │ [Idle] → [SeedSelect] → [Analyzing] →      │  │    │      │
│  │  │  │ [SeedPlant] → [Bloom] → [Card] → (loop)    │  │    │      │
│  │  │  └────────────────────────────────────────────┘  │    │      │
│  │  │                                                  │    │      │
│  │  │  AppContext (shared singletons)                  │    │      │
│  │  │  ├── HandTracker (MediaPipe Hands)               │    │      │
│  │  │  ├── PoseTracker (MediaPipe Pose)                │    │      │
│  │  │  ├── Webcam     (shared MediaStream)             │    │      │
│  │  │  ├── AssetConfig (config/assets.json)            │    │      │
│  │  │  └── AudioManager                                │    │      │
│  │  └──────────────────────────────────────────────────┘    │      │
│  └──────────────────────────────────────────────────────────┘      │
│        ▲                                          ▲                  │
│        │ HDMI                                     │ USB              │
│  ┌─────┴────────┐                          ┌──────┴──────┐          │
│  │ 95" OLED 4K  │                          │ Webcam      │          │
│  └──────────────┘                          │ (1080p)     │          │
│                                              └─────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
                                              │
                                              │ Internet (WiFi)
                                              ▼
                                    ┌──────────────────────┐
                                    │  Netlify (static)    │
                                    │  /token.html         │
                                    │  → Token3D viewer    │
                                    └──────────────────────┘
                                              ▲
                                              │ QR scan
                                    ┌──────────────────────┐
                                    │  관람객 휴대폰         │
                                    └──────────────────────┘
```

### 상태 머신 플로우

```
                        ┌────────────────────────────────┐
                        │                                ▼
                        │                          ┌──────────┐
                        │                          │   IDLE   │
                        │                          └─────┬────┘
                        │           shoulderWidth > threshold (2.5s)
                        │                                │
                        │                                ▼
                        │                          ┌──────────────┐
                        │                          │  SEED_SELECT │
                        │                          │  (110 sphere)│
                        │                          └─────┬────────┘
                        │      seed proximity dwell 5s   │
                        │                                ▼
                        │                          ┌────────────┐
                        │                          │ ANALYZING  │
                        │                          │ (5s timer) │
                        │                          └─────┬──────┘
                        │                                │
                        │                                ▼
                        │                          ┌────────────┐
                        │                          │ SEED_PLANT │
                        │                          │ (video end)│
                        │                          └─────┬──────┘
                        │                                │
                        │                                ▼
                        │                          ┌──────────┐
                        │                          │  BLOOM   │
                        │                          │ (hand UI)│
                        │                          └─────┬────┘
                        │       gauge ≥ 99.5%             │
                        │                                ▼
                        │                          ┌──────────┐
                        └──────────────────────────┤   CARD   │
                              cardResetMs 30s     │ (QR+3D)  │
                                                   └──────────┘
```

### 모듈 의존성 그래프

```
main.js
  ├─ core/AssetConfig
  ├─ core/AppContext
  ├─ core/StateMachine
  ├─ core/Webcam
  ├─ core/HandTracker  (uses Webcam)
  ├─ core/PoseTracker  (uses Webcam)
  ├─ core/AudioManager
  ├─ ui/Cursor
  └─ states/*          (subclasses BaseState, use AppContext singletons)
         │
         └─ ui/SphereCarousel, ui/WebcamFeed, ui/Gauge,
            ui/ParticleEffect, ui/Token3D, ui/cardBack

token-main.js   (standalone, runs on visitor phones)
  ├─ ui/Token3D
  └─ ui/cardBack   (← shared with CardState)
```

**핵심 디자인 원칙**:

- 상태(states/)는 코어 싱글톤(core/)을 받기만 하고 직접 구성하지 않음 → 테스트 용이
- UI(ui/)는 상태/코어 모듈을 import 안 함 → 단방향 의존성
- cardBack.js는 키오스크와 모바일 양쪽이 import → 동일 렌더링 보장

---

## 2. 디렉토리 구조

```
smart-herb-lab/
├── index.html                  # 키오스크 엔트리 HTML
├── token.html                  # 모바일 토큰 뷰어 엔트리 HTML
├── package.json                # npm 의존성 + 빌드 스크립트
├── vite.config.js              # Vite 빌드 설정 (멀티 엔트리)
├── .gitignore
├── scripts/
│   └── copy-static.mjs         # vite build 후 /assets, /config를 dist로 복사
├── src/
│   ├── main.js                 # 키오스크 부트스트랩 (StateMachine 초기화)
│   ├── token-main.js           # 모바일 부트스트랩 (URL 파싱 + Token3D 표시)
│   ├── core/
│   │   ├── StateMachine.js     # 상태 전환 엔진 + 페이드
│   │   ├── AppContext.js       # 공유 싱글톤 컨테이너 + 세션 페이로드
│   │   ├── AssetConfig.js      # /config/assets.json 런타임 로더
│   │   ├── Webcam.js           # getUserMedia 단일 인스턴스
│   │   ├── HandTracker.js      # MediaPipe HandLandmarker 래퍼
│   │   ├── PoseTracker.js      # MediaPipe PoseLandmarker 래퍼
│   │   └── AudioManager.js     # Web Audio API 래퍼 (no-op friendly)
│   ├── states/
│   │   ├── BaseState.js        # enter/exit 라이프사이클 + 헬퍼
│   │   ├── IdleState.js        # 0. 대기 — 환영 화면, 입장 감지
│   │   ├── SeedSelectState.js  # 1. 씨앗 선택 — 구형 캐러셀 + proximity dwell
│   │   ├── AnalyzingState.js   # 2. 분석 — 풀스크린 웹캠 + 파티클
│   │   ├── SeedPlantState.js   # 3. 씨앗 심기 — 영상 자동 재생
│   │   ├── BloomState.js       # 4. 꽃 개화 — 손 조이스틱 + 게이지
│   │   └── CardState.js        # 5. 카드 — Token3D + QR
│   ├── ui/
│   │   ├── Cursor.js           # 호버 dwell 모드용 라벤더 커서 (현재 미사용)
│   │   ├── WebcamFeed.js       # 웹캠 버블/풀스크린 컴포넌트
│   │   ├── Gauge.js            # 하단 진행 바
│   │   ├── ParticleEffect.js   # 가산 블렌드 파티클 (gather/disperse)
│   │   ├── SphereCarousel.js   # 110 노드 구체 캐러셀 (Canvas 2D)
│   │   ├── Token3D.js          # Three.js 코인 토큰 (양면 + 림)
│   │   └── cardBack.js         # 카드 뒷면 캔버스 합성 (공용)
│   └── styles/
│       ├── fonts.css           # @font-face LGEIHeadline 400 + 600
│       ├── main.css            # 키오스크 전체 스타일
│       └── token.css           # 모바일 뷰어 스타일
├── assets/                     # ⚠ Vite publicDir 아님. copy-static.mjs가 처리
│   ├── fonts/
│   │   ├── LGEIHeadline-Regular.otf
│   │   └── LGEIHeadline-Semibold.otf
│   ├── images/
│   │   ├── air_purifier.png
│   │   ├── dehumidifier.png
│   │   ├── speaker.png
│   │   ├── refrigerator.png
│   │   ├── washer.png
│   │   └── token-front.png      # 3D 토큰 앞면 이미지
│   ├── videos/
│   │   ├── seed/
│   │   │   └── seed-planting.mp4  # 5가전 공용
│   │   └── bloom/
│   │       ├── speaker.mp4
│   │       ├── dehumidifier.mp4
│   │       └── air_purifier.mp4
│   └── cards/                   # 카드 뒷면 이미지 15장 — 현재 비어있음
└── config/
    └── assets.json              # 마스터 매핑 + 타이밍 + 도메인 (런타임 로드)
```

---

## 3. 기술 스택 상세

### 런타임 의존성

| 패키지 | 버전 | 용도 | 로드 방식 | 라이선스 |
|---|---|---|---|---|
| **@mediapipe/tasks-vision** | ^0.10.14 | 손/포즈 랜드마크 추적 | npm + WASM CDN | Apache 2.0 |
| **three** | ^0.166.1 | WebGL 3D 토큰 렌더링 | npm | MIT |
| **qrcode** | ^1.5.4 | QR 코드 이미지 생성 | npm | MIT |

### 빌드 의존성

| 패키지 | 버전 | 용도 | 라이선스 |
|---|---|---|---|
| **vite** | ^5.4.0 | 번들러 + dev 서버 | MIT |
| **Node.js** | ≥18 LTS | 빌드 런타임 | MIT |

### 외부 자원 (런타임 fetch)

| 자원 | URL | 비고 |
|---|---|---|
| MediaPipe WASM | cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm | 약 3MB. **오프라인 운영 시 로컬 호스팅 필수** |
| Hand 모델 | storage.googleapis.com/mediapipe-models/hand_landmarker | 약 7MB |
| Pose 모델 | storage.googleapis.com/mediapipe-models/pose_landmarker_lite | 약 5MB |

> ⚠ **인터넷 차단 환경에서 운영 시**: WASM과 모델 파일을 다운로드하여 `/assets/mediapipe/`에 두고 `HandTracker.js`/`PoseTracker.js`의 URL 상수를 로컬 경로로 변경 필요.

### 폰트

| 파일 | weight | 위치 |
|---|---|---|
| LGEIHeadline-Regular.otf | 400 | `/assets/fonts/` |
| LGEIHeadline-Semibold.otf | 600 | `/assets/fonts/` |

`src/styles/fonts.css`에서 `@font-face`로 등록. CDN 사용 없음.

---

## 4. 핵심 모듈 설명

### 4.1 core/StateMachine.js

**역할**: 상태 간 비동기 전환 + CSS 페이드 인/아웃 관리

**주요 메서드**:

```js
register(name: string, state: BaseState): void
transition(name: string, payload?: object): Promise<void>
```

**전환 시퀀스**:

```
1. transitioning = true (재진입 차단)
2. currentName === name 이면 무시 (self-transition 가드)
3. prev.exit(ctx) await
4. prev.root에서 .is-active class 제거
5. 800ms wait (CSS .state transition 시간과 동기화)
6. prev.root.remove()
7. next.enter(ctx, payload) await
8. next.root.classList.add('is-active') → 페이드 인
9. transitioning = false (finally)
```

**중요**: `transition()` 내부에서 에러 시 `showFatalError()`로 빨간 오버레이를 띄움 → 키오스크 디버깅용.

### 4.2 states/BaseState.js

모든 상태의 추상 부모 클래스.

**제공 헬퍼**:

| 메서드 | 동작 |
|---|---|
| `enter(ctx)` | 자식이 super 호출. `<section class="state state--{name}">` DOM 생성 + 마운트 |
| `exit()` | RAF 취소 + disposers 실행 + `_loopRunning = false` |
| `loop(fn)` | RAF 루프 등록. `fn(t)` 매 프레임 호출. exit 시 자동 정지 |
| `after(ms, fn)` | setTimeout + disposers에 clearTimeout 등록 |
| `observeTracker(tracker, fn)` | tracker.observe() 호출 + 자동 disposer 등록 |

**RAF race condition 방지**: `_loopRunning` 플래그를 tick `fn()` 호출 전후로 체크하여, fn 내부에서 transition을 부르고 즉시 exit가 호출돼도 다음 RAF가 스케줄되지 않도록 함.

### 4.3 core/HandTracker.js

**MediaPipe HandLandmarker 초기화**:

```js
const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
this.landmarker = await HandLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
  numHands: 1,
  runningMode: 'VIDEO',
});
```

**프레임 처리** (`_step()`):

1. `landmarker.detectForVideo(video, performance.now())` 호출
2. 21개 랜드마크 중:
   - `palm = hand[9]` (middle MCP, 손바닥 중심 대용)
   - `thumbTip = hand[4]`, `indexTip = hand[8]` (pinch 거리 계산)
3. **EMA 스무딩**: `state.x = α·raw + (1-α)·prevState.x` (α=0.4)
4. **Pinch 히스테리시스**:

   ```
   진입 임계값: pinchDist < 0.035
   유지 임계값: pinchDist < 0.075
   ```

**Public state**:

```js
this.state = {
  present: boolean,
  x: 0..1,        // 정규화, 미러링됨 (오른손이 화면 오른쪽)
  y: 0..1,        // 정규화, top-left 기준
  isPinching: boolean,
  raw: Landmark[] | null,
};
```

**Observer 패턴**:

```js
const dispose = handTracker.observe((state) => { ... });
// dispose() 호출 시 구독 해제
```

### 4.4 core/PoseTracker.js

손과 동일한 구조. 11/12번 어깨 랜드마크로 `shoulderWidth` 계산 (IdleState 입장 감지용), 15/16번 손목 중 더 위에 있는 것의 y 좌표를 `wristY`로 노출 (BloomState 조이스틱용).

**키보드 mock** (`enableMockFromKeyboard(true)`):

- `P`: presence 토글
- `↑/↓`: wristY ±0.05

운영 환경에서 항상 활성화되어 있으나 키오스크엔 키보드가 없어 영향 없음. 스태프 QA용.

### 4.5 ui/SphereCarousel.js

**좌표계**:

- 110개 노드를 Fibonacci 황금나선으로 분포 (`y = 1 - i/(n-1)·2`, `phi = i·137.5°`)
- 노드별 `base: [x, y, z] · RADIUS` (RADIUS = 1500)

**그리디 분배 알고리즘** (`_buildField`):

```
무작위 순서로 슬롯 방문
각 슬롯의 단위구 거리 0.48 이내 기존 슬롯들의 가전 ID를 forbidden set에 추가
forbidden 외 가전 중 가장 적게 사용된 것 선택
```

→ 같은 가전이 시각적으로 인접할 확률 거의 0.

**투영** (`_draw` 내부):

```js
// rotateY → rotateX → perspective
const x1 = x0*cosY + z0*sinY;
const z1 = -x0*sinY + z0*cosY;
const y2 = y0*cosX - z1*sinX;
const z2 = y0*sinX + z1*cosX;
const scale = CAM_DISTANCE / (CAM_DISTANCE + z2 + RADIUS);
const sx = cx + x1*scale;
const sy = cy + y2*scale;
```

**두 가지 회전 모드**:

| 모드 | API | 사용처 |
|---|---|---|
| Delta 입력 | `rotate(dx, dy)` | (현재 미사용) |
| 각속도 모드 | `setAngularVel(vx, vy)` | SeedSelectState — 매 프레임 호출 |

**외부 노출 API**:

```js
getProjectedItems(): Array<{ node, sx, sy, scale, depth }>
setHighlight(slotId: number|null, progress: 0..1): void
snapToCenter(): void   // 정확한 회전각 역산 후 lock
unlock(): void
```

### 4.6 states/SeedSelectState.js — Proximity 인터랙션

**좌표 흐름**:

```
HandTracker.state.x/y (normalized 0..1)
  ↓
seedTargetX/Y (pixel space)
  ↓ ease 0.18
seedX/Y (pixel space)
  ↓ pull from nearest item
seedX/Y (adjusted)
  ↓
seed.style.left/top (DOM update)
```

**Proximity 검사** (매 프레임):

```js
for each p in carousel.getProjectedItems():
  if p.depth > 0.25 * RADIUS: continue   // 후방 반구 제외
  dist = hypot(seedX - p.sx, seedY - p.sy)
  if dist < PROXIMITY_PX(220) and dist < bestDist:
    nearest = p
```

**자기 인력**:

```js
pullF = (1 - dist/PROXIMITY_PX) * MAGNET_STRENGTH(0.42)
seedX += (p.sx - seedX) * pullF
seedY += (p.sy - seedY) * pullF
```

**캐러셀 회전**: 씨앗 X 오프셋을 각속도로 매핑

```js
normX = (seedX - centerX) / (width/2)        // -1..+1
mag = max(0, |normX| - DEADZONE(0.12)) / (1 - DEADZONE)
vy = sign(normX) * mag * MAX_ROT_SPEED(0.02)
carousel.setAngularVel(0, vy)
```

**Dwell**: 동일 slotId 위에 5초간 머무르면 `_triggerAbsorb()` → 흰빛 burst + 캐러셀 페이드 → AnalyzingState.

### 4.7 states/BloomState.js — 영상 currentTime 매핑

**핸드 조이스틱 모델**:

```
PoseTracker.state.wristY
  < UP_ZONE(0.4)   → direction = +1  (정방향)
  > DOWN_ZONE(0.6) → direction = -1  (역방향)
  else             → direction = 0   (정지)
```

**영상 제어 (매 프레임)**:

```js
if (direction === 1) {
  if (video.paused) video.play();
} else {
  if (!video.paused) video.pause();
  if (direction === -1) {
    const dt = (now - lastFrameTs) / 1000;
    video.currentTime = max(0, video.currentTime - dt);
  }
}
```

> **역재생 한계**: HTML5 `<video>`는 negative playbackRate 미지원. 매 프레임 `currentTime -= dt`로 수동 seek. MP4 키프레임 간격(GOP)에 따라 디코더가 가장 가까운 키프레임에서 다시 디코딩해야 하므로 끊김 발생. 부드러운 역재생이 꼭 필요하면 영상을 all-keyframe (`-x264opts keyint=1`) 인코딩 필요 (파일 크기 5–10배).

**Lock 조건**: `progress >= 0.995` → 손 입력 무시 + 끝까지 자연 재생 → `ended` 이벤트 → CardState.

### 4.8 ui/Token3D.js — Three.js 렌더링 파이프라인

**Scene 구조**:

```
Scene
├── AmbientLight (1.0)
├── DirectionalLight (0.45, position [2,3,4])
└── tokenGroup (외부 회전 핸들)
    └── coin (Mesh)
        ├── CylinderGeometry(R=1, R=1, H=0.06, 96 segments)
        └── materials[3]
            ├── [0] side: MeshBasicMaterial(0xffffff)
            ├── [1] top:  MeshBasicMaterial(map: frontTex)
            └── [2] bottom: MeshBasicMaterial(map: backTex)
```

**텍스처 보정**:

```js
// CylinderGeometry top cap UV는 캔버스 top → 캡 +x로 매핑.
// 즉 캔버스 상단의 그림이 디스크 오른쪽에 나옴.
// 이를 텍스처 회전으로 보정:
texture.center.set(0.5, 0.5);
texture.rotation = Math.PI / 2;  // CCW 90°
```

**회전 보간**:

```js
loop = () => {
  this.rotX += (this.targetRotX - this.rotX) * 0.2;
  this.rotY += (this.targetRotY - this.rotY) * 0.2;
  tokenGroup.rotation.set(rotX, rotY, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
};
```

**Save-as-image** (`preserveDrawingBuffer: true` 필요):

```js
canvas.toDataURL('image/png')  // → download link
```

### 4.9 ui/ParticleEffect.js

**Glow stamp 사전 베이크**:

```js
constructor() {
  this._stamp = (96×96 canvas)
  radial-gradient(0: white, 0.55: lavender, 1: transparent)
}
```

**렌더**:

- `mixBlendMode: 'lighter'` (가산)
- 매 프레임 240개 입자에 대해 `drawImage(this._stamp, x, y, size, size)`
- 입자별 `phase`, `radius`, `speed`, `bright`로 비대칭 모션

**Gather/disperse 사이클**:

```js
const gather = (1 - cos(t * 0.0009)) / 2;       // 0..1, 3.5s 주기
const collapse = 0.25 + 0.65 * gather;
const effectiveR = baseRadius * (1 - collapse * 0.8);
```

### 4.10 ui/cardBack.js — 공용 합성

키오스크 CardState와 모바일 token-main 양쪽이 import.

```js
buildBackCanvas({ cardImage, dateStr, applianceName, size = 720 }) → HTMLCanvasElement
```

수행 단계:

1. 720×720 캔버스 → 원형 클립
2. 카드 이미지 cover-fit, 없으면 라벤더 그라데이션
3. `drawCircularText(ctx, dateStr, top arc)` — 상단 호
4. `drawCircularText(ctx, applianceName, bottom arc)` — 하단 호

각 문자는 `ctx.measureText`로 너비 측정 → 호 위치 계산 → `rotate + translate` 후 그림. 하단은 reading direction을 위해 `rotate(θ - π/2) + translate(0, +r)` 사용.

### 4.11 QR 생성 (states/CardState.js)

```js
const base = ctx.config.data.tokenViewerBase;
const url = `${base}?a=${id}&f=${flowerKey}&d=${isoDate}`;
qrImg.src = await QRCode.toDataURL(url, { margin: 0, width: 200 });
```

QR 데이터 모드는 자동 선택 (URL이므로 alphanumeric mode가 효율적). 에러 정정 레벨 기본값 `M`.

---

## 5. Config 구조

**경로**: `/config/assets.json`
**로드**: `AssetConfig.load(url)` → `fetch(url, { cache: 'no-store' })` 매 페이지 로드 시
**핫 리로드**: 키오스크 Chrome에서 F5 누르면 즉시 반영

### 스키마

```json
{
  "appliances": [
    {
      "id": "air_purifier",
      "name": "공기청정기",
      "image": "/assets/images/air_purifier.png",
      "seedVideo": "/assets/videos/seed/seed-planting.mp4",
      "flowers": {
        "A": {
          "bloomVideo": "/assets/videos/bloom/air_purifier.mp4",
          "card": "/assets/cards/air_purifier_A.png"
        },
        "B": { "bloomVideo": "...", "card": "..." },
        "C": { "bloomVideo": "...", "card": "..." }
      }
    }
  ],
  "timings": {
    "idleEntryDwellMs": 2500,
    "seedSelectDwellMs": 5000,
    "analyzingMs": 5000,
    "cardResetMs": 30000
  },
  "tokenFront": "/assets/images/token-front.png",
  "tokenViewerBase": "https://tiny-cupcake-d0b31b.netlify.app/token.html",
  "detection": {
    "shoulderWidthEnterThreshold": 0.22,
    "shoulderWidthExitThreshold": 0.14
  }
}
```

### 수정 가능한 값 요약

| 키 | 기본값 | 영향 |
|---|---|---|
| `appliances[].id` | — | 코드 참조용 안정 키. **변경 금지** |
| `appliances[].name` | — | 화면 라벨. 자유롭게 변경 |
| `appliances[].image` | — | 파일 경로. 새 파일 교체 시 갱신 |
| `appliances[].seedVideo` | — | 가전별 다르게 둘 수도 있음 |
| `appliances[].flowers[A/B/C]` | — | 꽃 변형. A/B/C 외 키 추가 시 코드 수정 필요 |
| `timings.idleEntryDwellMs` | 2500 | ms |
| `timings.seedSelectDwellMs` | 5000 | proximity 5초 |
| `timings.analyzingMs` | 5000 | |
| `timings.cardResetMs` | 30000 | |
| `tokenFront` | `/assets/images/token-front.png` | 앞면 이미지 교체 시 |
| `tokenViewerBase` | Netlify URL | **배포 도메인 변경 시 반드시 갱신** |
| `detection.shoulderWidthEnterThreshold` | 0.22 | 0.0~1.0. 낮을수록 멀리서도 감지 |

---

## 6. 에셋 교체 규격

### 영상

| 항목 | 권장 사양 |
|---|---|
| 컨테이너 | `.mp4` |
| 비디오 코덱 | **H.264 baseline profile** (`-profile:v baseline`) |
| 오디오 | 없음 또는 AAC (현재 음소거 재생) |
| 해상도 | 1920×1080 (또는 4K 3840×2160) |
| 프레임레이트 | 30fps |
| 비트레이트 | 4–8 Mbps |
| 길이 | 5–15초 |
| 파일 크기 | ≤ 20 MB (개당) |
| 키프레임 간격 | 기본 OK (역재생 안 쓰면), all-I 인코딩이면 5–10× 커짐 |

**FFmpeg 변환 예시**:

```bash
ffmpeg -i input.mov -c:v libx264 -profile:v baseline -level 3.0 \
  -pix_fmt yuv420p -vf scale=1920:1080 -r 30 -b:v 6M -an output.mp4
```

### 이미지

| 항목 | 권장 사양 |
|---|---|
| 가전 이미지 (캐러셀) | PNG, 투명 배경, 1024×1024 정사각, < 2 MB |
| 토큰 앞면 | PNG, 1024×1024 정사각, 가장자리까지 꽉 채움 권장 |
| 카드 뒷면 | PNG/JPG, 1080×1080 정사각, < 3 MB |

### 폰트

- OTF 또는 TTF
- `@font-face` 등록: `src/styles/fonts.css` 직접 수정
- 새 weight 추가 시 weight 값 명시 (`font-weight: 400/600/...`)

---

## 7. 빌드 및 배포

### 7.1 로컬 개발

```bash
# 의존성 설치 (최초 1회)
npm install

# Vite dev 서버 (HMR)
npm run dev
# → http://localhost:5173

# 모바일 뷰어 테스트
# → http://localhost:5173/token.html?a=speaker&f=A&d=2026-05-27
```

### 7.2 프로덕션 빌드

```bash
npm run build
```

수행 단계:

1. `vite build` — TypeScript/JS 번들링 → `dist/`
2. `node scripts/copy-static.mjs` — `/assets`, `/config`를 `dist/`로 복사

**copy-static.mjs가 필요한 이유**: 런타임 `fetch('/config/assets.json')` + 직접 `<video src>` 사용으로 Vite가 의존성 분석을 못 함. 빌드 후 별도 복사 필요.

**결과물**:

```
dist/
├── index.html
├── token.html
├── assets/          (원본에서 복사됨)
├── config/          (원본에서 복사됨)
├── assets/index-[hash].js
├── assets/index-[hash].css
└── assets/token-[hash].js
```

### 7.3 Netlify 배포 (모바일 뷰어)

```bash
npm run build
# dist/ 폴더를 https://app.netlify.com/drop 에 드래그
```

`tokenViewerBase` 값을 Netlify가 발급한 URL로 갱신 후 재빌드/재배포.

### 7.4 키오스크 PC 배포 (Windows)

**파일 복사**:

```
C:\smart-herb-lab\
  └── dist\       ← npm run build 결과를 SFTP로 옮김
```

**HTTP 서버 (serve 패키지)**:

```cmd
npm install -g serve
```

**키오스크 시작 배치 파일** (`C:\smart-herb-lab\start.bat`):

```bat
@echo off
start /b "" serve "C:\smart-herb-lab\dist" -l 8080
timeout /t 2 /nobreak >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk ^
  --use-fake-ui-for-media-stream ^
  --autoplay-policy=no-user-gesture-required ^
  --noerrdialogs ^
  --disable-pinch ^
  --overscroll-history-navigation=0 ^
  --disable-features=TranslateUI ^
  http://localhost:8080
```

**자동 시작 등록**:

1. `Win + R` → `shell:startup`
2. 위 .bat 파일의 바로가기를 해당 폴더에 복사

**SFTP 콘텐츠 갱신**:

```
C:\smart-herb-lab\dist\assets\videos\bloom\ 에 새 .mp4 업로드
C:\smart-herb-lab\dist\config\assets.json 의 경로 갱신 (필요 시)
키오스크 Chrome에서 F5 → 즉시 반영
```

---

## 8. 환경 요구사항

### 키오스크 PC

| 항목 | 최소 | 권장 |
|---|---|---|
| OS | Windows 10 64bit | Windows 11 |
| CPU | Intel i5 8세대 / AMD Ryzen 5 | i7 10세대+ |
| RAM | 8 GB | 16 GB |
| GPU | Intel UHD 630 (WebGL 2 지원 필수) | GTX 1650+ (MediaPipe GPU delegate) |
| 저장 | SSD 128 GB | SSD 256 GB+ |
| USB | USB 3.0 ×1 | USB 3.0 ×2 |
| HDMI | 2.0 (4K 60Hz) | 2.0+ |
| Chrome | 120+ | 자동 업데이트 잠금 |

### 디스플레이

- LG 95" OLED, 4K (3840×2160) @ 60Hz
- HDMI 2.0 케이블

### 웹캠

- USB 2.0/3.0, 1080p 30fps 이상
- f/2.0 이하 밝은 렌즈 권장 (저조도 대응)
- 자동 노출/화이트밸런스 비활성화 가능하면 안정성↑

### 네트워크

- **키오스크 자체는 인터넷 불필요** (모든 에셋 로컬, MediaPipe WASM도 로컬 호스팅 가능)
- **관람객 QR 페이지 접근용**: 안정적 WiFi 또는 4G/5G
- Chrome 자동 업데이트 차단을 위해 outbound 차단 권장

---

## 9. 알려진 이슈 및 제약사항

### 9.1 MediaPipe 인식 한계

| 조건 | 동작 |
|---|---|
| 조도 < 100 lux | 손 인식률 < 60%, 권장 200+ lux |
| 카메라 ↔ 손 거리 > 1.5m | 손 작아져 랜드마크 정확도↓ |
| 손이 카메라 시야 밖 | 자동 감지 안 됨 (cursor 사라짐, 정상) |
| 복수 인원 | `numHands: 1` 설정 → 가장 큰 손 하나만 추적 |
| 손바닥이 카메라에 평행 | pinch 거리 측정값이 부정확 |
| 빠른 손 동작 | MediaPipe 30fps 기준 ~33ms 지연, 빠른 동작 미스 가능 |

**완화책**:

- 사용자 위치 표시 스티커 바닥 부착 (1m 거리 권장)
- 전시장 조명 보강 (CRI 80+)

### 9.2 영상 재생 제약

| 이슈 | 원인 | 완화책 |
|---|---|---|
| 역재생 끊김 | `<video currentTime` 수동 seek는 키프레임에서 다시 디코딩 | all-I 인코딩 (파일 5–10× 커짐) 또는 forward-only 인터랙션 |
| 자동재생 실패 | autoplay policy | `--autoplay-policy=no-user-gesture-required` 플래그 |
| 첫 프레임 검은 화면 | preload 안 끝남 | `currentTime = 0.001`로 강제 seek (BloomState 적용됨) |

### 9.3 WebGL/Canvas 퍼포먼스 병목

| 지점 | 부하 | 측정 |
|---|---|---|
| SphereCarousel 110개 노드 매 프레임 | Canvas 2D drawImage ×110 + 투영 계산 | 1080p에서 ~5ms/frame, 4K에서 ~12ms/frame |
| ParticleEffect 240개 입자 | drawImage ×240 + 가산 블렌딩 | ~3ms/frame |
| Token3D 매 프레임 | Three.js ~50 vertices | <1ms/frame |
| MediaPipe Hand 추적 | GPU delegate, 30fps | ~15ms/frame |

> 4K에서 60fps 유지하려면 GPU dedicated 권장. iGPU에서는 30fps cap 또는 캐러셀 노드 수 축소 (110→70) 고려.

### 9.4 메모리

- 24시간 가동 시 V8 heap 약간씩 증가 (MediaPipe inference 누적)
- **권장 운영**: 매일 새벽 Chrome 재시작 (Task Scheduler)

### 9.5 카메라 끊김

- 웹캠 USB 빠지면 `getUserMedia` 스트림 만료 → 모든 인터랙션 멈춤
- 현재 자동 복구 로직 없음 → 향후 `mediaTrack.onended` 핸들러 추가 검토

### 9.6 Token3D preserveDrawingBuffer

- WebGL 컨텍스트가 매 프레임 버퍼 보존 → 약 5–10% perf 손실
- 모바일 뷰어의 "이미지로 저장" 기능 위해 필수

---

## 10. 확장 가이드

### 10.1 가전 추가 (예: "에어컨")

**1. 에셋 준비**:

```
assets/images/aircon.png
assets/videos/seed/aircon.mp4   (또는 공용 seed-planting.mp4 재사용)
assets/videos/bloom/aircon_A.mp4
assets/videos/bloom/aircon_B.mp4
assets/videos/bloom/aircon_C.mp4
assets/cards/aircon_A.png
assets/cards/aircon_B.png
assets/cards/aircon_C.png
```

**2. config/assets.json에 추가**:

```json
{
  "id": "aircon",
  "name": "에어컨",
  "image": "/assets/images/aircon.png",
  "seedVideo": "/assets/videos/seed/seed-planting.mp4",
  "flowers": {
    "A": { "bloomVideo": "/assets/videos/bloom/aircon_A.mp4", "card": "/assets/cards/aircon_A.png" },
    "B": { "bloomVideo": "/assets/videos/bloom/aircon_B.mp4", "card": "/assets/cards/aircon_B.png" },
    "C": { "bloomVideo": "/assets/videos/bloom/aircon_C.mp4", "card": "/assets/cards/aircon_C.png" }
  }
}
```

**3. 자동 적용 사항**:

- SphereCarousel이 `REPEATS × appliances.length` 계산 → 자동으로 노드 수 증가 (6가전이면 132개)
- 그리디 분배도 자동
- 코드 수정 불필요

### 10.2 꽃 변형 추가 (A/B/C → A/B/C/D)

`AssetConfig.pickRandomFlowerKey()`가 하드코딩되어 있음:

```js
// src/core/AssetConfig.js
pickRandomFlowerKey() {
  const keys = ['A', 'B', 'C'];  // ← 여기에 'D' 추가
  return keys[Math.floor(Math.random() * keys.length)];
}
```

config에 `D` 플라워 정의 추가:

```json
"flowers": {
  "A": { ... }, "B": { ... }, "C": { ... },
  "D": { "bloomVideo": "...", "card": "..." }
}
```

### 10.3 새로운 인터랙션 단계 추가

예: Card 이후에 "공유" 단계 추가.

**1. 상태 클래스 작성** (`src/states/ShareState.js`):

```js
import { BaseState } from './BaseState.js';

export class ShareState extends BaseState {
  constructor() { super('share'); }

  async enter(ctx) {
    await super.enter(ctx);
    // ... DOM 구성, 인터랙션 로직
    this.after(10000, () => this.machine.transition('idle'));
  }

  async exit() {
    await super.exit();
  }
}
```

**2. main.js에 등록**:

```js
import { ShareState } from './states/ShareState.js';

// ORDER 배열 갱신
const ORDER = ['idle', 'seedSelect', 'analyzing', 'seedPlant', 'bloom', 'card', 'share'];

fsm.register('share', new ShareState());
```

**3. 이전 상태에서 전환 트리거**:

```js
// CardState.js — 자동 리셋 대신 share로
this.after(ctx.config.timings.cardResetMs, () => {
  this.machine.transition('share');  // ← idle에서 share로
});
```

**4. 타이밍 config 추가** (선택):

```json
"timings": {
  "shareMs": 10000
}
```

### 10.4 다른 제스처 추가 (예: "엄지 척")

`HandTracker._step()`에서 21개 랜드마크 분석:

```js
// 엄지가 검지보다 위에 있고 다른 손가락은 접힘
const thumbUp = hand[4].y < hand[3].y - 0.05;
const indexCurled = hand[8].y > hand[6].y;
const middleCurled = hand[12].y > hand[10].y;
this.state.isThumbUp = thumbUp && indexCurled && middleCurled;
```

→ `state.isThumbUp`을 추가하면 어느 state에서든 observer로 구독 가능.

### 10.5 새로운 UI 컴포넌트

`src/ui/` 에 새 모듈 추가. 규약:

- 클래스 또는 export 함수로 노출
- 자체 `root` DOM 노드를 외부에서 mount 가능하게
- `start() / stop() / dispose()` 라이프사이클 제공 (필요 시)
- 코어/상태 모듈 import 금지 (단방향 의존성 유지)

---

## 부록 A. dev 단축키 (스태프용)

| 키 | 동작 |
|---|---|
| `` ` `` (백틱) | dev 오버레이 토글 |
| `0`–`5` | 상태 강제 점프 (Idle/SeedSelect/Analyzing/SeedPlant/Bloom/Card) |
| `N` | 다음 상태 |
| `R` | 세션 리셋 → Idle |
| `P` | (mock) 포즈 입장 토글 |
| `↑/↓` | (mock) wristY ±0.05 (Bloom 테스트) |

운영 환경에서는 키보드 비연결 권장. dev 단축키가 의도치 않게 발동 안 함.

---

## 부록 B. 에러 처리

### 키오스크 fatal error 발생 시

`StateMachine.transition` 실패 → `showFatalError()` 호출 → 빨간 배경 + 스택 트레이스 전체화면. F12 콘솔에도 출력. 운영 중에는 화면 노출 부담 있음 — 향후 사용자 친화적 에러 화면으로 교체 검토.

### 콘솔 로그 prefix

| Prefix | 출처 |
|---|---|
| `[fsm]` | StateMachine 전환 |
| `[SeedSelect]` | 씨앗 선택 단계 |
| `[Analyzing]` | 분석 단계 |
| `[SeedPlant]` | 씨앗 심기 단계 |
| `[Bloom]` | 개화 단계 |
| `[Card]` | 카드 단계 |
| `[WebcamFeed]` | 웹캠 컴포넌트 |
| `[HandTracker]` `[PoseTracker]` | MediaPipe 초기화 |
| `[Token3D]` | Three.js 토큰 |

---

## 부록 C. 인수인계 체크리스트

- Netlify 계정 정보 인계 (배포된 모바일 뷰어 사이트 관리)
- `tokenViewerBase` 도메인 인계
- `config/assets.json` 변경 이력 (git history)
- 키오스크 PC 원격 접속 정보 (TeamViewer/AnyDesk 등)
- 콘텐츠 교체용 SFTP 자격증명
- LGEIHeadline 폰트 라이선스 확인
- 운영 매뉴얼 (현장 스태프용) — 별도 문서

---

**문의 / 이슈 보고**: [개발 담당자 연락처]
**소스 코드**: [Git 저장소 URL]
**라이선스**: [내부 사용 / TBD]
