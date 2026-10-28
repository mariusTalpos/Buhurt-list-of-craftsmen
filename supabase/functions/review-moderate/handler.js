import { validateReview, RATING_FIELDS, ReviewError } from '../_shared/review-policy.js';

const EDIT_FIELDS = ['display_name', 'product_service', 'experience', 'contact_name', 'contact_method', 'contact_details', ...RATING_FIELDS];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = (message, status = 400) => { throw new ReviewError(message, status); };
function complete(row, vendorIds) {
  const input = Object.fromEntries(['vendor_id', 'photos_public', ...EDIT_FIELDS].map(key => [key, row[key]]));
  validateReview({ ...input, confirmed: true }, vendorIds);
  if (!Array.isArray(row.photo_paths) || row.photo_paths.length < 1 || row.photo_paths.length > 5 ||
      row.photo_paths.some(path => !new RegExp(`^${row.id}/[a-f0-9-]{36}\\.(jpg|webp)$`).test(path))) fail('This review needs its original photos before approval.');
}
async function jsonBody(request) {
  const reader = request.body?.getReader(); let size = 0; const chunks = [];
  if (!reader) fail('A request body is required.');
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 24000) { await reader.cancel(); fail('The submitted changes are too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('Invalid request data.'); }
}
async function previewAllowed(request, hash) {
  const token = request.headers.get('x-review-preview') ?? '';
  if (!hash || !token || token.length > 512) return false;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('') === hash;
}
export function createModerationHandler({ authorize, publicStore, vendorIds, allowedOrigins,
  publicEnabled = false, previewTokenHash = '' }) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Cache-Control': 'no-store, private, max-age=0', 'Pragma': 'no-cache',
      'Vary': 'Origin, Authorization, x-review-preview', 'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-review-preview',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
    try {
      if (origin && !allowedOrigins.includes(origin)) fail('Origin not allowed.', 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      const url = new URL(request.url); const action = url.searchParams.get('action');
      const isPhoto = action === 'photo' || action === 'public-photo';
      if (request.method !== (['list', 'get'].includes(action) || isPhoto ? 'GET' : 'POST')) fail('Method not allowed.', 405);
      let store;
      if (action === 'public-photo') {
        if (!publicEnabled && !await previewAllowed(request, previewTokenHash)) fail('Photo unavailable.', 404);
        store = publicStore;
      } else {
        const token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
        if (!token) fail('Sign in to moderate reviews.', 401);
        store = await authorize(token);
        if (!store) fail('Only the directory owner can moderate reviews.', 403);
      }
      if (action === 'list') {
        const status = url.searchParams.get('status');
        if (!['pending', 'published'].includes(status)) fail('Choose pending or published reviews.');
        return reply({ reviews: await store.list(status) });
      }
      const body = request.method === 'POST' ? await jsonBody(request) : null;
      if (request.method === 'POST' && (!body || typeof body !== 'object' || Array.isArray(body))) fail('Invalid request data.');
      const id = body?.id ?? url.searchParams.get('id');
      if (!UUID.test(id ?? '')) fail('Invalid review reference.');
      const row = await store.get(id);
      if (!row) {
        if (action === 'delete' && body.confirm === true) return reply({ deleted: true });
        fail('Review unavailable. Refresh the list.', 404);
      }
      if (isPhoto) {
        const index = Number(url.searchParams.get('index'));
        const path = row.photo_paths[index];
        if (!url.searchParams.has('index') || !Number.isInteger(index) || !path ||
            (action === 'public-photo' && (row.status !== 'published' || !row.photos_public || row.excluded_photo_paths.includes(path)))) fail('Photo unavailable.', 404);
        const blob = await store.photo(path);
        if (!blob) fail('Photo unavailable.', 404);
        // Never return a signed Storage URL. Every new request rechecks the row.
        return new Response(blob, { headers: { ...headers, 'Content-Type': path.endsWith('.webp') ? 'image/webp' : 'image/jpeg' } });
      }
      if (action === 'get') return reply({ review: row });
      if (!['edit', 'approve', 'unpublish', 'delete'].includes(action)) fail('Unknown action.', 404);
      const allowed = ['id', 'expected_updated_at', ...(action === 'edit' ? ['changes'] : action === 'delete' ? ['confirm'] : [])];
      if (Object.keys(body).some(key => !allowed.includes(key))) fail('Unexpected action fields.');
      if (body.expected_updated_at !== row.updated_at) fail('This review changed. Reload it before trying again.', 409);
      if (action === 'delete') {
        if (body.confirm !== true) fail('Confirm permanent deletion first.');
        // Unpublish BEFORE file removal. Keep the row on failures so Delete can retry.
        let current = row;
        if (row.status === 'published') current = await store.update(id, row.updated_at, { status: 'pending' });
        if (!current) fail('This review changed. Reload it before trying again.', 409);
        try {
          const paths = await store.listPhotos(id);
          if (paths.length) await store.removePhotos(paths);
          if ((await store.listPhotos(id)).length) throw new Error('Files remain');
        } catch {
          fail('File removal could not be confirmed. The review is pending. Reload it and retry Delete.', 503);
        }
        try {
          if (!await store.delete(id, current.updated_at)) fail('Files removed, but the review changed. Reload it and retry Delete.', 409);
        } catch (error) {
          if (error instanceof ReviewError) throw error;
          fail('Files removed, but record deletion could not be confirmed. Reload and retry Delete.', 503);
        }
        return reply({ deleted: true });
      }
      let changes;
      if (action === 'edit') {
        const patch = body.changes;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
            Object.keys(patch).some(key => ![...EDIT_FIELDS, 'owner_note', 'excluded_photo_paths'].includes(key)) ||
            EDIT_FIELDS.some(key => !Object.hasOwn(patch, key))) fail('Complete all review fields and ratings.');
        const data = validateReview({ ...Object.fromEntries(EDIT_FIELDS.map(key => [key, patch[key]])), vendor_id: row.vendor_id, photos_public: row.photos_public, confirmed: true }, vendorIds);
        const excluded = patch.excluded_photo_paths;
        if (!Array.isArray(excluded) || excluded.length > 5 || excluded.some(path => !row.photo_paths.includes(path)) || new Set(excluded).size !== excluded.length) fail('Choose photos belonging to this review.');
        if (typeof patch.owner_note !== 'string' || patch.owner_note.length > 5000) fail('Owner notes must be at most 5000 characters.');
        changes = { ...Object.fromEntries(EDIT_FIELDS.map(key => [key, data[key]])), owner_note: patch.owner_note, excluded_photo_paths: excluded };
        complete({ ...row, ...changes }, vendorIds);
      } else if (action === 'approve') {
        complete(row, vendorIds);
        const paths = await store.listPhotos(id);
        if (row.photo_paths.some(path => !paths.includes(path))) fail('A required photo is missing. Keep this review pending or delete it.');
        changes = { status: 'published' };
      } else changes = { status: 'pending' };
      const updated = await store.update(id, row.updated_at, changes);
      if (!updated) fail('This review changed. Reload it before trying again.', 409);
      return reply({ review: updated });
    } catch (error) {
      return reply({ error: error instanceof ReviewError ? error.message : 'The operation could not be confirmed. Reload the review before retrying.' }, error instanceof ReviewError ? error.status : 503);
    }
  };
}
