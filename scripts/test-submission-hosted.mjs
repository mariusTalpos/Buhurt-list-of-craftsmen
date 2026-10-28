import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { SubmissionClient } from '../src/reviews/submission-client.js';
import { sha256 } from '../supabase/functions/review-submit/handler.js';
const config = JSON.parse(await readFile('.local/review-preview.json', 'utf8'));
const endpoint = config.supabaseUrl + '/functions/v1/review-submit';
const headers = { apikey: config.supabasePublishableKey, Origin: 'http://localhost:8000', 'x-review-preview': config.previewToken };
const pixels = new Uint8Array(256 * 256 * 4).fill(170);
const bytes = jpeg.encode({ data: pixels, width: 256, height: 256 }, 90).data;
const photos = [{ blob: new Blob([bytes], { type: 'image/jpeg' }), sha256: await sha256(bytes) }];
const data = (photos_public) => ({ vendor_id: '1', display_name: `Phase 2 test — ${photos_public ? 'public' : 'private'} photos`,
  contact_name: 'Synthetic Phase 2 fixture', contact_method: 'email', contact_details: 'phase2@example.invalid',
  product_service: 'Synthetic test item', experience: 'Synthetic fixture retained for Phase 3 moderation testing. No real purchase or reviewer.',
  quality: 5, value_for_money: 4, responsiveness: 3, production_speed: 4, photos_public, confirmed: true, website: '' });
const callStart = async (review, manifest = photos.map((p) => ({ size: p.blob.size, sha256: p.sha256 })), challenge = 'XXXX.DUMMY.TOKEN.XXXX') => {
  const response = await fetch(endpoint + '?action=start', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ review, photos: manifest, challenge }) });
  return { status: response.status, data: await response.json() };
};
const unauthorized = await fetch(endpoint + '?action=start', { method: 'POST', headers: { apikey: config.supabasePublishableKey, Origin: 'http://localhost:8000' }, body: '{}' });
assert.equal(unauthorized.status, 403);
for (const invalid of [{ ...data(true), quality: null }, { ...data(true), quality: 2.5 }, { ...data(true), vendor_id: '999999' }]) {
  const reply = await callStart(invalid); assert.equal(reply.status, 400, JSON.stringify(reply));
}
assert.equal((await callStart(data(true), [])).status, 400);
assert.equal((await callStart(data(true), undefined, 'invalid-token')).status, 400);
let references = [];
if (process.argv.includes('--reuse-fixtures')) references = JSON.parse(await readFile('test-results/submission-hosted.json', 'utf8')).references;
else for (const visibility of [true, false]) {
  const client = new SubmissionClient(config, (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: 'http://localhost:8000' } }));
  const saved = await client.submit(data(visibility), photos, 'XXXX.DUMMY.TOKEN.XXXX');
  assert.equal(saved.status, 'pending'); references.push({ id: saved.reference, photos_public: visibility });
}
await mkdir('test-results', { recursive: true });
await writeFile('test-results/submission-hosted.json', JSON.stringify({ endpoint, references, unauthorized: unauthorized.status, rateLimited: 'not yet checked' }, null, 2));
let rateLimited = false;
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await callStart({ ...data(true), quality: null });
  if (response.status === 429) { rateLimited = true; break; }
  assert.equal(response.status, 400);
}
assert.equal(rateLimited, true);
await mkdir('test-results', { recursive: true });
await writeFile('test-results/submission-hosted.json', JSON.stringify({ endpoint, references, unauthorized: unauthorized.status, rateLimited }, null, 2));
console.log(JSON.stringify({ references, unauthorized: unauthorized.status, rateLimited, note: 'Two synthetic pending fixtures retained for Phase 3.' }, null, 2));
