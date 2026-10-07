// Portrait capture + upload for the ending certificate (KIOSK SIDE ONLY).
//
// Grabs one clean frame from the shared webcam, uploads it to the separately-
// deployed certificate backend, and returns a short random id to embed in the
// QR (token.html?...&id=<id>). The backend (Netlify Functions + Blobs, 24h TTL)
// and the mobile certificate page live in the cert project (ai-herb-lab-cert),
// NOT here — this module only produces the id.
//
// Everything is best-effort: any failure returns null and the experience
// proceeds with no photo (the certificate shows an empty portrait slot).
//
// Upload contract the cert backend must match:
//   POST <url>   body: raw JPEG bytes,  Content-Type: image/jpeg
//   200 -> JSON { "id": "<short random id>" }   (store the blob with 24h TTL,
//          random id so it isn't enumerable)
//   The function must return CORS headers (Access-Control-Allow-Origin: *) since
//   the kiosk posts cross-origin from the local app.

// Grab a single frame from a <video> as a JPEG Blob (mirrored to match the
// on-screen mirror feed). Returns null if the video has no frame yet.
export function captureJpegBlob(video, { mirror = true, maxW = 720, quality = 0.85 } = {}) {
  return new Promise((resolve) => {
    try {
      const vw = video && video.videoWidth ? video.videoWidth : 0;
      const vh = video && video.videoHeight ? video.videoHeight : 0;
      if (!vw || !vh) { resolve(null); return; }
      const scale = Math.min(1, maxW / vw);
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d');
      if (mirror) { cx.translate(w, 0); cx.scale(-1, 1); }
      cx.drawImage(video, 0, 0, w, h);
      c.toBlob((b) => resolve(b), 'image/jpeg', quality);
    } catch (e) {
      resolve(null);
    }
  });
}

// POST the blob to the upload endpoint; resolve to the returned id or null.
// Aborts after timeoutMs so a slow/again venue WiFi never blocks the flow.
export async function uploadPhoto(blob, url, { timeoutMs = 8000 } = {}) {
  if (!blob || !url) return null;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && data.id ? data.id : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(to);
  }
}

// Convenience: capture + upload in one call. Returns id or null.
export async function captureAndUpload(video, url, opts = {}) {
  const blob = await captureJpegBlob(video, opts);
  if (!blob) return null;
  return uploadPhoto(blob, url, opts);
}
