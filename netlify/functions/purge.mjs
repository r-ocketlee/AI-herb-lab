// Scheduled daily — hard-delete any portrait older than 24h (belt-and-braces
// alongside the on-read TTL in photo.mjs).
import { getStore } from '@netlify/blobs';

const TTL_MS = 24 * 60 * 60 * 1000;

export default async () => {
  const store = getStore('portraits');
  const now = Date.now();
  let removed = 0;
  try {
    const { blobs } = await store.list();
    for (const b of blobs) {
      try {
        const meta = await store.getMetadata(b.key);
        const createdAt = (meta && meta.metadata && meta.metadata.createdAt) || 0;
        if (now - createdAt > TTL_MS) { await store.delete(b.key); removed++; }
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* ignore */ }
  return new Response(`purged ${removed}`);
};

export const config = { schedule: '@daily' };
