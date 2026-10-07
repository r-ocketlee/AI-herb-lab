// Mobile certificate page — scanned from the kiosk's ending QR.
//
// URL: token.html?a=<applianceId>&c=<codenameNum>&d=<YYYY-MM-DD>&id=<photoId>&f=<variant>
//
// Renders a receipt-style "Certificate of Adoption": black screen, a per-
// appliance-colored paper that prints slowly down from the top, info stacked
// top→bottom. The visitor portrait (by id) and the grown bloom (flower card)
// are drawn as circular HALFTONE on canvas (high-contrast duotone: ink on the
// paper colour). Save = the certificate on black (no buttons). LG button →
// the appliance's product page.

import html2canvas from 'html2canvas';

const params = new URLSearchParams(location.search);
const applianceId = params.get('a') ?? '';
const codenameNum = params.get('c') ?? '';
const dateParam = params.get('d') ?? new Date().toISOString().slice(0, 10);
const photoId = params.get('id') ?? '';
const flowerKey = params.get('f') ?? 'A';

const root = document.getElementById('receipt');
const INK = '#0c0a18';
const hexToRgb = (h) => { const m = /^#?([0-9a-fA-F]{6})$/.exec(h || ''); if (!m) return [255, 255, 255]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

const fmtDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? `${m[1]}. ${m[2]}. ${m[3]}` : (s || ''); };
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function loadImage(src, crossorigin) {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossorigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Cover-crop the image to a square and desaturate it to grayscale (mild
// contrast so it reads clearly on the colored paper). Returns a square canvas;
// the circular crop comes from the .rc-ht slot (border-radius + overflow).
function monochrome(img, { size = 420, contrast = 1.12, tint = [255, 255, 255] } = {}) {
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  if (!img) return out;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return out;
  const sc = Math.max(size / iw, size / ih), dw = iw * sc, dh = ih * sc;
  ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
  try {
    const im = ctx.getImageData(0, 0, size, size), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      let l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      l = Math.min(255, Math.max(0, (l - 128) * contrast + 128));
      d[i] = tint[0] * l / 255;      // multiply the grayscale onto the paper colour
      d[i + 1] = tint[1] * l / 255;  // (duotone "multiply" look baked in, so html2canvas
      d[i + 2] = tint[2] * l / 255;  //  never sees a CSS blend mode that would break save)
    }
    ctx.putImageData(im, 0, 0);
  } catch (e) { /* same-origin so should not taint; leave color if it does */ }
  return out;
}

(async function main() {
  let config;
  try {
    config = await fetch('/config/assets.json', { cache: 'no-store' }).then((r) => r.json());
  } catch (e) {
    root.innerHTML = '<p class="rc-error">정보를 불러오지 못했습니다.</p>';
    return;
  }

  const appliance = config.appliances?.find((a) => a.id === applianceId) ?? config.appliances?.[0];
  if (!appliance) { root.innerHTML = '<p class="rc-error">정보를 불러오지 못했습니다.</p>'; return; }

  const flower = appliance.flowers?.[flowerKey] ?? appliance.flowers?.A;
  const species = appliance.species ?? 'HERB';
  const codename = codenameNum ? `${species}-${codenameNum}` : species;
  const paper = appliance.paperColor || '#BAB5E3';
  const paperRgb = hexToRgb(paper);
  const photoUrl = photoId ? ('/.netlify/functions/photo?id=' + encodeURIComponent(photoId)) : '';
  const productUrl = appliance.productUrl || config.lgProductUrl || '#';
  const dateStr = fmtDate(dateParam);
  const serial = `AHL-${species}${codenameNum || ''}-${dateParam.replace(/-/g, '').slice(2)}`;
  const seedSrc = config.tokenFront ?? '/assets/images/token-front.png';

  document.documentElement.style.setProperty('--paper', paper);

  root.innerHTML = `
    <div class="rc-slot"></div>
    <div class="cert-shot">
      <div class="rc-paper">
        <div class="rc-hero">AI Herb Lab<sup>®</sup></div>
        <div class="rc-sub"><div class="en">CERTIFICATE OF ADOPTION</div><div class="ko">씨앗 분양 증서</div></div>
        <div class="rc-rule"></div>
        <div class="rc-fields">
          <div><span>DATE 분양일</span><b>${esc(dateStr)}</b></div>
          <div><span>SOURCE 출처</span><b>${esc(appliance.name ?? '')} · ${esc(appliance.model ?? '')}</b></div>
          <div><span>SPECIES 품종</span><b>${esc(species)}</b></div>
          <div><span>SPECIMEN No.</span><b>${esc(codename)}</b></div>
        </div>
        <div class="rc-rule"></div>
        <div class="rc-photos">
          <div class="rc-fig"><div class="rc-cap">PORTRAIT 관람객</div><div class="rc-ht" data-slot="portrait"><span class="rc-ph">N / A</span></div></div>
          <div class="rc-fig"><div class="rc-cap">BLOOM 개화</div><div class="rc-ht" data-slot="bloom"><span class="rc-ph">N / A</span></div></div>
        </div>
        <div class="rc-rule"></div>
        <p class="rc-statement">위 표본은 AI Herb Lab에서<br />정식으로 분양되었음을 증명합니다</p>
        <div class="rc-barcode"></div>
        <p class="rc-id">SPECIMEN ID · ${esc(serial)}</p>
        <p class="rc-issuer">ISSUED BY · AI Herb Lab · Cultivation Dept.</p>
      </div>
    </div>
    <div class="rc-actions">
      <button class="rc-btn rc-btn--save" type="button">이미지로 저장</button>
      <a class="rc-btn rc-btn--lg" href="${esc(productUrl)}" target="_blank" rel="noopener">LG전자 제품 보기</a>
    </div>
  `;

  // print-in (paper slides slowly down from the top)
  requestAnimationFrame(() => root.classList.add('is-printed'));

  const fillSlot = (slot, canvas) => {
    const el = root.querySelector(`[data-slot="${slot}"]`);
    if (el) { el.innerHTML = ''; el.appendChild(canvas); }
  };

  // Portrait — cross-origin from the photo function (ACAO:* → canvas-safe).
  (async () => {
    if (!photoId) return;
    const img = await loadImage(`/.netlify/functions/photo?id=${encodeURIComponent(photoId)}`, true);
    if (img) fillSlot('portrait', monochrome(img, { contrast: 1.18, tint: paperRgb }));
  })();

  // Bloom — the grown flower's card image (same origin). Fall back to the seed.
  (async () => {
    const src = flower?.card || seedSrc;
    const img = await loadImage(src, false);
    if (img) fillSlot('bloom', monochrome(img, { contrast: 1.1, tint: paperRgb }));
  })();

  // Save the certificate (paper on black, no buttons) as a PNG.
  const shot = root.querySelector('.cert-shot');
  const saveBtn = root.querySelector('.rc-btn--save');
  saveBtn?.addEventListener('click', async () => {
    const label = saveBtn.textContent;
    saveBtn.disabled = true; saveBtn.textContent = '저장 준비 중…';
    let url = null;
    try {
      const canvas = await html2canvas(shot, {
        backgroundColor: '#080808',
        scale: Math.min(3, (window.devicePixelRatio || 1) + 1),
        useCORS: true, logging: false,
      });
      url = await new Promise((res) => {
        if (canvas.toBlob) canvas.toBlob((b) => res(b ? URL.createObjectURL(b) : canvas.toDataURL('image/png')), 'image/png');
        else res(canvas.toDataURL('image/png'));
      });
    } catch (e) {
      console.warn('[cert] save failed', e);
      saveBtn.textContent = '저장 실패 · 다시 시도';
      setTimeout(() => { saveBtn.textContent = label; saveBtn.disabled = false; }, 2200);
      return;
    }
    // Full-screen overlay: long-press the image saves on every mobile browser
    // (iOS + Android) with no popup blocker, and the download button covers
    // Android/desktop. Far more reliable than <a download> with a data URL,
    // which Android Chrome silently blocks.
    const baseName = 'ai-herb-lab-' + species + '-' + (codenameNum || '00');
    const items = [{ url, label: '증서 CERTIFICATE', filename: baseName + '.png' }];
    if (photoUrl) items.push({ url: photoUrl, label: '원본 사진 PORTRAIT', filename: baseName + '-photo.jpg' });
    showSaveImages(items);
    saveBtn.textContent = label; saveBtn.disabled = false;
  });

  function showSaveImages(items) {
    const list = items.filter((it) => it && it.url);
    const ov = document.createElement('div');
    Object.assign(ov.style, {
      position: 'fixed', inset: '0', zIndex: '9999', background: 'rgba(4,4,4,0.97)',
      overflowY: 'auto', boxSizing: 'border-box', padding: '24px 16px 32px',
    });
    const inner = document.createElement('div');
    Object.assign(inner.style, {
      maxWidth: '440px', margin: '0 auto', display: 'flex',
      flexDirection: 'column', alignItems: 'center',
    });
    const tip = document.createElement('p');
    tip.textContent = '이미지를 길게 눌러 저장하세요';
    Object.assign(tip.style, {
      color: '#fff', font: "500 1.05rem/1.4 -apple-system, 'Pretendard', sans-serif",
      textAlign: 'center', margin: '0 0 6px',
    });
    inner.appendChild(tip);
    const btnCss = "padding:0.6rem 1.4rem;border-radius:999px;border:1px solid rgba(255,255,255,0.4);background:transparent;color:#fff;font:500 0.95rem/1 -apple-system, 'Pretendard', sans-serif;text-decoration:none;cursor:pointer";
    list.forEach((it) => {
      const cap = document.createElement('p');
      cap.textContent = it.label || '';
      Object.assign(cap.style, {
        color: 'rgba(255,255,255,0.6)', letterSpacing: '0.12em',
        font: "600 0.78rem/1 -apple-system, 'Pretendard', sans-serif", margin: '16px 0 6px',
      });
      const im = document.createElement('img');
      im.src = it.url;
      Object.assign(im.style, {
        maxWidth: '82%', maxHeight: '58vh', borderRadius: '0.5rem',
        boxShadow: '0 0.6rem 2.4rem rgba(0,0,0,0.5)', display: 'block',
      });
      const dl = document.createElement('a');
      dl.href = it.url; dl.download = it.filename || 'ai-herb-lab.png';
      dl.textContent = '기기에 저장'; dl.style.cssText = btnCss + ';margin-top:8px';
      inner.appendChild(cap); inner.appendChild(im); inner.appendChild(dl);
    });
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '닫기';
    close.style.cssText = btnCss + ';margin-top:22px';
    const dismiss = () => {
      ov.remove();
      list.forEach((it) => { if (it.url.startsWith('blob:')) { try { URL.revokeObjectURL(it.url); } catch (e) {} } });
    };
    close.addEventListener('click', dismiss);
    inner.appendChild(close);
    ov.appendChild(inner);
    document.body.appendChild(ov);
  }
})();
