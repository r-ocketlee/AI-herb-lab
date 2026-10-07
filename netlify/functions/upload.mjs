// POST a captured portrait → store in Netlify Blobs with a random id + 24h TTL
// metadata. Returns { id } for the kiosk to embed in the QR. CORS-open so the
// kiosk (served from localhost) can POST cross-origin.
import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};
const MAX_BYTES = 8 * 1024 * 1024;

function randomId(n = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < n; i++) s += chars[a[i] % chars.length];
  return s;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });
  try {
    const buf = await req.arrayBuffer();
    if (!buf || buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: 'bad image' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const store = getStore('portraits');
    const id = randomId(10);
    const contentType = req.headers.get('content-type') || 'image/jpeg';
    await store.set(id, buf, { metadata: { createdAt: Date.now(), contentType } });
    return new Response(JSON.stringify({ id }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'upload failed' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
};
