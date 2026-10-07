// GET /.netlify/functions/photo?id=<id> → the stored portrait bytes.
// Enforces the 24h TTL on read (expired → delete + 404). CORS-open + crossorigin
// friendly so token.html can draw it into a canvas for "save as image".
import { getStore } from '@netlify/blobs';

const TTL_MS = 24 * 60 * 60 * 1000;
const CORS = { 'Access-Control-Allow-Origin': '*' };

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[a-z0-9]{4,32}$/.test(id)) return new Response('not found', { status: 404, headers: CORS });
  try {
    const store = getStore('portraits');
    const res = await store.getWithMetadata(id, { type: 'arrayBuffer' });
    if (!res || !res.data) return new Response('not found', { status: 404, headers: CORS });
    const createdAt = (res.metadata && res.metadata.createdAt) || 0;
    if (Date.now() - createdAt > TTL_MS) {
      try { await store.delete(id); } catch (e) { /* ignore */ }
      return new Response('expired', { status: 404, headers: CORS });
    }
    const contentType = (res.metadata && res.metadata.contentType) || 'image/jpeg';
    return new Response(res.data, {
      status: 200,
      headers: { ...CORS, 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (e) {
    return new Response('not found', { status: 404, headers: CORS });
  }
};
