// Shared "back face" canvas builder. Used by both the kiosk CardState and
// the standalone mobile token viewer (token-main.js) so the disc that appears
// on a visitor's phone is identical to the one they saw on the OLED.
//
// The canvas is square, circle-cropped, with the date at the top arc and the
// appliance name at the bottom arc.

export async function buildBackCanvas({
  cardImage,
  dateStr,
  applianceName,
  applianceModel = '',
  size = 720,
}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Circle-cropped background.
  const img = await loadImage(cardImage);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const ar = img.naturalWidth / img.naturalHeight;
    let dw, dh, dx, dy;
    if (ar >= 1) {
      dh = size;
      dw = size * ar;
      dx = (size - dw) / 2;
      dy = 0;
    } else {
      dw = size;
      dh = size / ar;
      dx = 0;
      dy = (size - dh) / 2;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#f6d4ff');
    g.addColorStop(1, '#eaa0ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();

  // Top arc: date. Bottom arc: appliance name.
  const cx = size / 2;
  const cy = size / 2;
  const dateFontSize = 22;
  const nameFontSize = 28;
  const dateRadius = size / 2 - dateFontSize - 18;
  const nameRadius = size / 2 - nameFontSize - 18;

  drawCircularText(ctx, dateStr, {
    cx, cy, radius: dateRadius,
    fontSize: dateFontSize, fontWeight: 400, color: '#2a1f3a',
    letterSpacingEm: 0.18, position: 'top',
  });
  drawCircularText(ctx, applianceName, {
    cx, cy, radius: nameRadius,
    fontSize: nameFontSize, fontWeight: 600, color: '#2a1f3a',
    letterSpacingEm: 0.2, position: 'bottom',
  });

  // Product model name — sits on a concentric inner arc just inside the
  // appliance name. Bumped to 18px so it stays readable after the canvas is
  // mapped onto the 3D token texture and viewed at an angle. Skipped if
  // model is empty.
  if (applianceModel) {
    const modelFontSize = 18;
    const modelRadius = nameRadius - nameFontSize - 6;
    drawCircularText(ctx, applianceModel, {
      cx, cy, radius: modelRadius,
      fontSize: modelFontSize, fontWeight: 400, color: '#2a1f3a',
      letterSpacingEm: 0.05, position: 'bottom',
    });
  }

  return canvas;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Each character is placed along an arc, rotated to be tangent to the circle.
//   position: 'top'    — text centered at 12 o'clock, character tops outward
//   position: 'bottom' — text centered at 6 o'clock, character tops inward
//                        so the text reads right-side-up to the viewer.
function drawCircularText(ctx, text, opts) {
  const { cx, cy, radius, fontSize, fontWeight, color, letterSpacingEm = 0.15, position } = opts;
  if (!text) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${fontWeight} ${fontSize}px LGEIHeadline, 'Pretendard', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const spacing = fontSize * letterSpacingEm;
  const totalLen = widths.reduce((s, w) => s + w, 0) + spacing * (chars.length - 1);
  const totalArc = totalLen / radius;

  if (position === 'top') {
    let arcOffset = -totalArc / 2;
    chars.forEach((ch, i) => {
      const charArc = widths[i] / radius;
      const theta = -Math.PI / 2 + arcOffset + charArc / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(theta + Math.PI / 2);
      ctx.translate(0, -radius);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      arcOffset += charArc + spacing / radius;
    });
  } else {
    let arcOffset = totalArc / 2;
    chars.forEach((ch, i) => {
      const charArc = widths[i] / radius;
      const theta = Math.PI / 2 + arcOffset - charArc / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(theta - Math.PI / 2);
      ctx.translate(0, radius);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      arcOffset -= charArc + spacing / radius;
    });
  }
  ctx.restore();
}
