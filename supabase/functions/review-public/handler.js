import { publicReview, publicPhotoIndexes, summarizeReviews } from '../_shared/public-review-policy.js';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function previewAllowed(request, hash) {
  const token = request.headers.get('x-review-preview') ?? '';
  if (!hash || !token || token.length > 512) return false;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('') === hash;
}
export function createPublicReviewHandler({ store, vendorIds, allowedOrigins, publicEnabled = false, previewTokenHash = '' }) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache',
      'Vary': 'Origin, x-review-preview', 'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'apikey, x-review-preview' };
    if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
    try {
      if (origin && !allowedOrigins.includes(origin)) return reply({ error: 'Origin not allowed.' }, 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405);
      if (!publicEnabled && !await previewAllowed(request, previewTokenHash)) return reply({ error: 'Reviews unavailable.' }, 404);
      const url = new URL(request.url); const action = url.searchParams.get('action');
      if (action === 'summaries') {
        const rows = (await store.ratings()).filter(row => vendorIds.has(row.vendor_id));
        return reply({ summaries: summarizeReviews(rows) });
      }
      if (action === 'list') {
        const vendor = url.searchParams.get('vendor_id');
        const offsetText = url.searchParams.get('offset') ?? '0'; const offset = Number(offsetText);
        if (!vendorIds.has(vendor) || !/^\d{1,5}$/.test(offsetText) || offset > 10000) return reply({ error: 'Invalid review list.' }, 400);
        const rows = (await store.list(vendor, offset, 21)).filter(row => row.status === 'published' && row.vendor_id === vendor);
        return reply({ reviews: rows.slice(0, 20).map(publicReview), has_more: rows.length > 20 });
      }
      if (!['get', 'photo'].includes(action)) return reply({ error: 'Unknown action.' }, 404);
      const id = url.searchParams.get('id');
      if (!UUID.test(id ?? '')) return reply({ error: 'Review unavailable.' }, 404);
      const row = await store.get(id);
      if (!row || row.status !== 'published' || !vendorIds.has(row.vendor_id)) return reply({ error: 'Review unavailable.' }, 404);
      if (action === 'get') return reply({ review: publicReview(row) });
      const indexText = url.searchParams.get('index'); const index = Number(indexText);
      if (!/^[0-4]$/.test(indexText ?? '') || !publicPhotoIndexes(row).includes(index)) return reply({ error: 'Photo unavailable.' }, 404);
      const blob = await store.photo(row.photo_paths[index]);
      if (!blob) return reply({ error: 'Photo unavailable.' }, 404);
      return new Response(blob, { headers: { ...headers, 'Content-Type': row.photo_paths[index].endsWith('.webp') ? 'image/webp' : 'image/jpeg' } });
    } catch { return reply({ error: 'Reviews temporarily unavailable. Please try again.' }, 503); }
  };
}
