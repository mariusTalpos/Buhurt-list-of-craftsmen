import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { createSubmissionHandler, sha256, verifyPermit, validateAndStripJpeg } from '../supabase/functions/review-submit/handler.js';
import { validateReview, RATING_FIELDS } from '../supabase/functions/_shared/review-policy.js';
import { SubmissionClient } from '../src/reviews/submission-client.js';
const secret = 'server-only-test-key'; const previewToken = 'private-preview-token-for-unit-tests-123456';
const valid = () => ({ vendor_id: '1', display_name: 'Fighter', contact_name: 'Private name', contact_method: 'email',
  contact_details: 'fighter@example.invalid', product_service: 'Gauntlets', experience: 'Firsthand experience with the item.',
  quality: 5, value_for_money: 4, responsiveness: 3, production_speed: 4, photos_public: true, confirmed: true, website: '' });
const pixels = new Uint8Array(16 * 16 * 4).fill(160);
const photo = jpeg.encode({ width: 16, height: 16, data: pixels }, 90).data;
async function harness(options = {}) {
  const objects = new Map(); const rows = new Map(); const hits = new Map();
  const store = {
    async consumeLimit(key) { const count = (hits.get(key) ?? 0) + 1; hits.set(key, count); return count <= (options.limit ?? 100); },
    async listPhotos(id) { return [...objects.keys()].filter((key) => key.startsWith(id + '/')); },
    async hasPhoto(id, path) { return objects.has(path); },
    async upload(path, bytes) { objects.set(path, bytes); if (options.uploadFailure) throw new Error('Simulated storage failure after write'); },
    async removePhotos(paths) { for (const path of paths) objects.delete(path); },
    async findReview(id) { return rows.get(id) ?? null; },
    async insertReview(row) { rows.set(row.id, row); if (options.databaseReplyLost) throw new Error('Commit succeeded, reply lost'); },
  };
  const handler = createSubmissionHandler({ store, secret, jpeg, vendorIds: new Set(['1']), allowedOrigins: ['http://localhost:8000'],
    previewTokenHash: await sha256(new TextEncoder().encode(previewToken)), turnstileSecret: 'test-secret',
    fetcher: async () => Response.json({ success: !options.botFailure }), now: options.now ?? Date.now });
  async function call(action, body, permit, index) {
    const headers = { Origin: 'http://localhost:8000', 'x-review-preview': previewToken, 'x-forwarded-for': '192.0.2.1' };
    if (permit) headers['x-upload-permit'] = permit;
    if (index !== undefined) headers['x-photo-index'] = String(index);
    return handler(new Request(`http://api.invalid/?action=${action}`, { method: 'POST', headers,
      body: body instanceof Uint8Array || body instanceof Blob ? body : JSON.stringify(body ?? {}) }));
  }
  const manifest = [{ size: photo.length, sha256: await sha256(photo) }];
  const start = async (review = valid(), photos = manifest) => {
    const response = await call('start', { review, photos, challenge: 'dummy-token' });
    return { response, ...(await response.json()) };
  };
  return { handler, call, start, store, objects, rows, hits, manifest };
}

test('all categories are mandatory whole-number stars, and server rejects privileged fields', () => {
  for (const field of RATING_FIELDS) for (const rating of [null, undefined, 0, 6, 2.5, '4']) {
    assert.throws(() => validateReview({ ...valid(), [field]: rating }, new Set(['1'])));
  }
  for (const field of ['status', 'id', 'photo_paths', 'owner_note']) assert.throws(() => validateReview({ ...valid(), [field]: 'injected' }, new Set(['1'])));
  assert.throws(() => validateReview({ ...valid(), vendor_id: '999' }, new Set(['1'])));
  assert.throws(() => validateReview({ ...valid(), website: 'bot' }, new Set(['1'])));
});
test('all five contact methods and both photo choices save only pending private rows', async () => {
  const h = await harness();
  for (const [contact_method, contact_details] of [['email', 'fighter@example.invalid'], ['phone', '+1 555 123 4567'], ['whatsapp', '+40 712 345 678'], ['facebook', 'https://www.facebook.com/fighter'], ['instagram', 'https://instagram.com/fighter']]) {
    const before = h.rows.size;
    const result = await h.start({ ...valid(), contact_method, contact_details, photos_public: contact_method !== 'phone' });
    assert.equal(result.response.status, 200); assert.equal(h.rows.size, before, 'Starting an upload must not create a review record');
    assert.equal((await h.call('photo', photo, result.permit, 0)).status, 200);
    const saved = await (await h.call('finish', {}, result.permit)).json();
    assert.equal(h.rows.get(saved.reference).status, 'pending');
    assert.equal(h.rows.get(saved.reference).photos_public, contact_method !== 'phone');
    assert.deepEqual(Object.keys(saved).sort(), ['reference', 'status']);
  }
  assert.equal(h.rows.size, 5);
});
test('bot failure, missing photos, invalid content, and rate limits reject before storage', async () => {
  const bot = await harness({ botFailure: true }); assert.equal((await bot.start()).response.status, 400); assert.equal(bot.objects.size, 0);
  const invalid = await harness(); assert.equal((await invalid.start(valid(), [])).response.status, 400);
  const result = await invalid.start();
  assert.equal((await invalid.call('photo', new TextEncoder().encode('not jpeg'), result.permit, 0)).status, 400);
  assert.equal(invalid.objects.size, 0);
  const limited = await harness({ limit: 1 }); assert.equal((await limited.start()).response.status, 200);
  assert.equal((await limited.start()).response.status, 429); assert.equal(limited.objects.size, 0);
});
test('permits prevent path/metadata tampering and incomplete reviews never finalize', async () => {
  const h = await harness(); const result = await h.start();
  assert.equal((await h.call('finish', {}, result.permit)).status, 400); assert.equal(h.rows.size, 0);
  assert.equal((await h.call('photo', photo, result.permit + 'x', 0)).status, 401);
  assert.equal((await h.call('photo', photo, result.permit, 9)).status, 400);
  await assert.rejects(() => verifyPermit(result.permit, secret, Date.now() + 31 * 60_000));
  assert.equal((await h.call('photo', photo, result.permit, 0)).status, 200);
  assert.equal((await h.call('cancel', {}, result.permit)).status, 200); assert.equal(h.objects.size, 0); assert.equal(h.rows.size, 0);
});
test('JPEG verification rejects corrupt data and strips EXIF/comments without pixel loss', () => {
  const metadata = new TextEncoder().encode('Exif\0\0GPS metadata');
  const app1 = Uint8Array.from([255, 225, 0, metadata.length + 2, ...metadata]);
  const injected = Uint8Array.from([...photo.subarray(0, 2), ...app1, ...photo.subarray(2), 1, 2, 3]);
  const clean = validateAndStripJpeg(injected, jpeg);
  assert.ok(!new TextDecoder().decode(clean).includes('GPS metadata'));
  assert.deepEqual(jpeg.decode(clean).data, jpeg.decode(photo).data);
  assert.throws(() => validateAndStripJpeg(Uint8Array.from([255, 216, 1, 2]), jpeg));
});

async function clientHarness(options = {}) {
  const h = await harness(options); let loseFinishReply = options.loseFinishReply; let starts = 0;
  const client = new SubmissionClient({ supabaseUrl: 'http://api.invalid', supabasePublishableKey: 'public-key', previewToken }, async (url, init) => {
    const action = new URL(url).searchParams.get('action'); if (action === 'start') starts++;
    const response = await h.handler(new Request(url, { ...init, headers: { ...init.headers, Origin: 'http://localhost:8000', 'x-forwarded-for': '192.0.2.1' } }));
    if (action === 'finish' && loseFinishReply) { loseFinishReply = false; throw new Error('Connection lost after commit'); }
    return response;
  });
  return { ...h, client, starts: () => starts, photos: [{ blob: new Blob([photo], { type: 'image/jpeg' }), sha256: await sha256(photo) }] };
}
test('lost final reply retries the same review; cancel never deletes committed photos', async () => {
  const h = await clientHarness({ loseFinishReply: true });
  await assert.rejects(() => h.client.submit(valid(), h.photos, 'dummy-token'));
  assert.equal(h.rows.size, 1); assert.ok(h.client.attempt);
  const saved = await h.client.submit(valid(), h.photos, 'new-token');
  assert.ok(saved.reference); assert.equal(h.rows.size, 1); assert.equal(h.starts(), 1); assert.equal(h.objects.size, 1);
});
test('expired permits recover a committed review instead of creating a second vote', async () => {
  const h = await clientHarness({ loseFinishReply: true });
  await assert.rejects(() => h.client.submit(valid(), h.photos, 'dummy-token'));
  h.client.attempt.expires = Date.now() - 1;
  const saved = await h.client.submit(valid(), h.photos, 'new-token');
  assert.ok(saved.reference); assert.equal(h.rows.size, 1); assert.equal(h.starts(), 1); assert.equal(h.objects.size, 1);
});
test('ambiguous storage failure cleans partial files and never returns success', async () => {
  const h = await clientHarness({ uploadFailure: true });
  await assert.rejects(() => h.client.submit(valid(), h.photos, 'dummy-token'));
  assert.equal(h.rows.size, 0); assert.equal(h.objects.size, 0);
});
test('ambiguous database commit returns the existing saved reference', async () => {
  const h = await clientHarness({ databaseReplyLost: true });
  const saved = await h.client.submit(valid(), h.photos, 'dummy-token');
  assert.ok(saved.reference); assert.equal(h.rows.size, 1); assert.equal(h.objects.size, 1);
});
test('preview authentication, CORS, and method checks deny uninvited requests', async () => {
  const h = await harness();
  const denied = await h.handler(new Request('http://api.invalid', { method: 'POST', headers: { Origin: 'http://localhost:8000' }, body: '{}' }));
  assert.equal(denied.status, 403);
  const cors = await h.handler(new Request('http://api.invalid', { method: 'OPTIONS', headers: { Origin: 'https://other.invalid' } }));
  assert.equal(cors.status, 403);
  assert.equal((await h.handler(new Request('http://api.invalid', { headers: { Origin: 'http://localhost:8000' } }))).status, 405);
});
test('public mode refuses development bot secrets', async () => {
  const handler = createSubmissionHandler({ store: {}, secret, jpeg, vendorIds: new Set(['1']), allowedOrigins: ['https://directory.example'],
    publicEnabled: true, turnstileSecret: '1x0000000000000000000000000000000AA' });
  const response = await handler(new Request('https://api.example', { method: 'POST', headers: { Origin: 'https://directory.example' }, body: '{}' }));
  assert.equal(response.status, 503);
});
