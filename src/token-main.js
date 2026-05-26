// Mobile token viewer — standalone page reached via QR.
//
// URL: token.html?a=<applianceId>&f=<flowerKey>&d=<YYYY-MM-DD>
//
// What it does:
//   1. Read query params.
//   2. Fetch /config/assets.json (same origin) and look up the appliance +
//      flower-variant card image path.
//   3. Build the back-face canvas using the shared cardBack helper, so the
//      disc the visitor sees on their phone matches what they saw on the
//      kiosk — same image, same curved date and name.
//   4. Mount a Token3D into #token-mount.
//   5. Pointer drag → setTargetRotation (rotates the coin). Light inertia on
//      release; gentle auto-rotation when idle so the page always looks alive.
//   6. "Save as image" button → captures the WebGL canvas and triggers
//      download. Hidden until the token has finished loading.

import { Token3D } from './ui/Token3D.js';
import { buildBackCanvas } from './ui/cardBack.js';

const params = new URLSearchParams(window.location.search);
const applianceId = params.get('a') ?? '';
const flowerKey = params.get('f') ?? 'A';
const dateParam = params.get('d') ?? new Date().toISOString().slice(0, 10);

const applianceNameEl = document.getElementById('appliance-name');
const applianceModelEl = document.getElementById('appliance-model');
const saveBtn = document.getElementById('save-btn');
const mount = document.getElementById('token-mount');

(async function main() {
  let config;
  try {
    config = await fetch('/config/assets.json', { cache: 'no-store' }).then((r) => r.json());
  } catch (err) {
    showError('정보를 불러오지 못했습니다.');
    console.error(err);
    return;
  }

  const appliance = config.appliances.find((a) => a.id === applianceId) ?? config.appliances[0];
  const flower = appliance.flowers?.[flowerKey] ?? appliance.flowers?.A;
  const dateStr = formatKoreanDate(dateParam);

  applianceNameEl.textContent = appliance?.name ?? '나의 가전';
  applianceModelEl.textContent = appliance?.model ?? '';

  const backCanvas = await buildBackCanvas({
    cardImage: flower?.card,
    dateStr,
    applianceName: appliance?.name ?? '',
    applianceModel: appliance?.model ?? '',
    size: 720,
  });

  const size = Math.min(window.innerWidth, window.innerHeight) * 0.88;
  const cssSize = Math.min(size, 480);
  const token = new Token3D({
    width: cssSize,
    height: cssSize,
    frontImageSrc: config.tokenFront ?? '/assets/images/token-front.png',
    backCanvas,
  });
  mount.appendChild(token.root);
  token.start();

  // ---- Rotation control ----
  // - Continuous gentle auto-rotation when no one is touching (attract mode).
  // - On pointer drag: stop auto-rotation, follow finger, apply small inertia
  //   on release that decays into the auto-rotation again.
  let curX = 0;
  let curY = Math.PI;
  let velX = 0;
  let velY = 0;
  let interacting = false;
  let lastT = performance.now();

  function tick(now) {
    const dt = Math.min(50, now - lastT) / 16.67;
    lastT = now;
    if (!interacting) {
      // Decay any leftover velocity from the last gesture, then add a gentle
      // baseline spin so the disc never looks frozen.
      velY *= 0.94;
      velX *= 0.92;
      curY += velY + 0.004 * dt;
      curX += velX;
      curX = Math.max(-0.45, Math.min(0.45, curX));
    }
    token.setTargetRotation(curX, curY);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  let lastPX = 0;
  let lastPY = 0;
  mount.addEventListener('pointerdown', (e) => {
    interacting = true;
    lastPX = e.clientX;
    lastPY = e.clientY;
    velX = 0;
    velY = 0;
    mount.setPointerCapture(e.pointerId);
  });
  mount.addEventListener('pointermove', (e) => {
    if (!interacting) return;
    const dx = e.clientX - lastPX;
    const dy = e.clientY - lastPY;
    lastPX = e.clientX;
    lastPY = e.clientY;
    curY += dx * 0.012;
    curX += dy * 0.006;
    curX = Math.max(-0.45, Math.min(0.45, curX));
    velY = dx * 0.012;
    velX = dy * 0.006;
  });
  const endDrag = (e) => {
    if (!interacting) return;
    interacting = false;
    try { mount.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  mount.addEventListener('pointerup', endDrag);
  mount.addEventListener('pointercancel', endDrag);
  mount.addEventListener('pointerleave', endDrag);

  // ---- Save as image ----
  saveBtn.hidden = false;
  saveBtn.addEventListener('click', () => {
    // Render one fresh frame so we capture the latest pose, then export.
    const canvas = token.renderer.domElement;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `smart-herb-${appliance.id}-${flowerKey}.png`;
    link.click();
  });
})();

function showError(msg) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;color:#6b5e80">
      <div>
        <div style="font-size:18px;font-weight:600;color:#2a1f3a;margin-bottom:8px">${msg}</div>
        <div style="font-size:13px">URL을 다시 확인해 주세요.</div>
      </div>
    </div>
  `;
}

function formatKoreanDate(iso) {
  // Accepts 'YYYY-MM-DD' or any Date-parseable string.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}
