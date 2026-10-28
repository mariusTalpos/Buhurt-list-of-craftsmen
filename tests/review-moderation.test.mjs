import test from 'node:test';
import assert from 'node:assert/strict';
import { createModerationHandler } from '../supabase/functions/review-moderate/handler.js';
import { moderationStore, publicId, privateId, editFields } from './helpers/moderation-store.mjs';
import { createHash } from 'node:crypto';
function setup() {
  const state = moderationStore();
  const handler = createModerationHandler({ authorize: async token => token === 'owner' ? state.store : null,
    publicStore: state.store, vendorIds: new Set(['1']), allowedOrigins: ['http://localhost:8000'],
    previewTokenHash: createHash('sha256').update('preview').digest('hex') });
  async function call(action, { id = publicId, body, token = 'owner', extraHeaders = {}, index = 0 } = {}) {
    const query = new URLSearchParams({ action, id, index: String(index), status: 'pending' });
    return handler(new Request(`https://example.invalid?${query}`, { method: body ? 'POST' : 'GET', headers: {
      Origin: 'http://localhost:8000', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  }
  async function mutate(action, id = publicId, extra = {}) {
    return call(action, { body: { id, expected_updated_at: state.rows.get(id)?.updated_at, ...extra } });
  }
  return { ...state, handler, call, mutate };
}
test('every private action denies anonymous/non-owner/forged tokens before accessing rows', async () => {
  const s = setup();
  for (const action of ['list', 'get', 'photo', 'approve', 'edit', 'unpublish', 'delete']) {
    for (const token of [null, 'non-owner', 'forged']) {
      const result = await s.call(action, { token, ...(['approve','edit','unpublish','delete'].includes(action) ? { body: { id: publicId } } : {}) });
      assert.equal(result.status, token ? 403 : 401);
      assert.ok(!JSON.stringify(await result.json()).includes('test@example.invalid'));
    }
  }
  assert.equal((await s.call('get', { extraHeaders: { Origin: 'https://evil.invalid' } })).status, 403);
  for (const body of ['null', 'false', '[]']) {
    const response = await s.handler(new Request('https://example.invalid?action=edit', { method: 'POST', headers: { Authorization: 'Bearer owner' }, body }));
    assert.equal(response.status, 400);
  }
});
test('approve/edit/unpublish preserve ID and one score contribution, with strict required ratings', async () => {
  const s = setup(); const original = s.rows.get(publicId);
  assert.equal((await s.mutate('approve')).status, 200);
  assert.equal(s.rows.get(publicId).status, 'published');
  const publishedAt = s.rows.get(publicId).published_at;
  for (const patch of [{ quality: 2.5 }, { responsiveness: undefined }, { production_speed: 0 }, { quality: '5' }]) {
    assert.equal((await s.mutate('edit', publicId, { changes: editFields(s.rows.get(publicId), patch) })).status, 400);
  }
  assert.equal((await s.mutate('edit', publicId, { changes: editFields(s.rows.get(publicId), { experience: 'Agreed correction', quality: 5, owner_note: 'Private note' }) })).status, 200);
  assert.equal(s.rows.size, 2); assert.equal(s.rows.get(publicId).created_at, original.created_at);
  assert.equal(s.rows.get(publicId).published_at, publishedAt); assert.equal(s.rows.get(publicId).quality, 5);
  assert.equal((await s.call('unpublish', { body: { id: publicId, expected_updated_at: original.updated_at } })).status, 409);
  assert.equal((await s.mutate('unpublish')).status, 200); assert.equal(s.rows.get(publicId).published_at, null);
});
test('public photos require published + reviewer permission + owner inclusion on each retrieval', async () => {
  const s = setup();
  const photo = id => s.call('public-photo', { id, token: null, extraHeaders: { 'x-review-preview': 'preview' } });
  assert.equal((await s.call('public-photo', { token: null })).status, 404);
  assert.equal((await photo(publicId)).status, 404);
  await s.mutate('approve'); await s.mutate('approve', privateId);
  const response = await photo(publicId); assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/); assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal((await photo(privateId)).status, 404); assert.equal((await s.call('photo', { id: privateId })).status, 200);
  const row = s.rows.get(publicId);
  assert.equal((await s.mutate('edit', publicId, { changes: editFields(row, { excluded_photo_paths: [row.photo_paths[0]] }) })).status, 200);
  assert.equal((await photo(publicId)).status, 404);
  assert.equal((await s.call('public-photo', { token: null, index: 1, extraHeaders: { 'x-review-preview': 'preview' } })).status, 200);
  assert.equal((await s.mutate('edit', privateId, { changes: { ...editFields(s.rows.get(privateId)), photos_public: true } })).status, 400);
  assert.equal((await s.mutate('edit', publicId, { changes: editFields(row, { excluded_photo_paths: s.rows.get(privateId).photo_paths }) })).status, 400);
  await s.mutate('unpublish'); assert.equal((await photo(publicId)).status, 404);
});
test('missing stored photos prevent approval; exclusion cannot bypass the required evidence', async () => {
  const s = setup(); const row = s.rows.get(publicId); s.photos.delete(row.photo_paths[0]);
  assert.equal((await s.mutate('approve')).status, 400); assert.equal(s.rows.get(publicId).status, 'pending');
});
test('deletion unpublishes first, retains retryable row on storage failure, and removes only its own files', async () => {
  const s = setup(); await s.mutate('approve'); s.failures.remove = true;
  assert.equal((await s.mutate('delete', publicId, { confirm: true })).status, 503);
  assert.equal(s.rows.get(publicId).status, 'pending'); assert.equal(s.photos.size, 4);
  s.failures.remove = false; s.failures.delete = true;
  assert.equal((await s.mutate('delete', publicId, { confirm: true })).status, 503);
  assert.equal(s.rows.has(publicId), true); assert.equal(s.photos.size, 2);
  s.failures.delete = false;
  assert.equal((await s.mutate('delete', publicId, { confirm: true })).status, 200);
  assert.equal(s.rows.has(publicId), false); assert.equal(s.rows.has(privateId), true); assert.equal(s.photos.size, 2);
  assert.equal((await s.mutate('delete', publicId, { confirm: true })).status, 200);
});
test('lost storage reply remains an honest failure and can be retried after objects were removed', async () => {
  const s = setup(); s.failures.afterRemove = true;
  assert.equal((await s.mutate('delete', publicId, { confirm: true })).status, 503);
  assert.equal(s.rows.has(publicId), true); s.failures.afterRemove = false;
  assert.equal((await s.mutate('delete', publicId, { confirm: true })).status, 200);
});
