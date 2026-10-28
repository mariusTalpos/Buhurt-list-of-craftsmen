import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { sha256 } from '../supabase/functions/review-submit/handler.js';
const c = JSON.parse(await readFile('.local/review-preview.json', 'utf8'));
const endpoint = c.supabaseUrl + '/functions/v1/review-submit';
const headers = { apikey: c.supabasePublishableKey, Origin: 'http://localhost:8000', 'x-review-preview': c.previewToken };
const width = 2560, height = 2560, data = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4;
  data[i] = (x * 17 + y * 31) & 255; data[i + 1] = ((x * 7) ^ (y * 23)) & 255; data[i + 2] = (x * 23 + y * 3) & 255; data[i + 3] = 255;
}
const bytes = jpeg.encode({ data, width, height }, 90).data;
const review = { vendor_id: '1', display_name: 'Discarded upload check', contact_name: 'Synthetic', contact_method: 'email',
  contact_details: 'test@example.invalid', product_service: 'Synthetic detailed photo', experience: 'Upload only; no review will be created.',
  quality: 4, value_for_money: 4, responsiveness: 4, production_speed: 4, photos_public: false, confirmed: true, website: '' };
const start = await fetch(endpoint + '?action=start', { method: 'POST', headers, body: JSON.stringify({ review,
  photos: [{ size: bytes.length, sha256: await sha256(bytes) }], challenge: 'XXXX.DUMMY.TOKEN.XXXX' }) });
const permit = await start.json(); assert.equal(start.status, 200, JSON.stringify(permit));
let result;
try {
  const began = Date.now();
  const response = await fetch(endpoint + '?action=photo', { method: 'POST', headers: { ...headers, 'x-upload-permit': permit.permit, 'x-photo-index': '0' }, body: bytes });
  const payload = await response.json();
  result = { width, height, encodedBytes: bytes.length, httpStatus: response.status, roundTripMs: Date.now() - began, error: payload.error };
  assert.equal(response.status, 200, JSON.stringify(result));
} finally {
  const cancelled = await fetch(endpoint + '?action=cancel', { method: 'POST', headers: { ...headers, 'x-upload-permit': permit.permit }, body: '{}' });
  assert.equal(cancelled.status, 200, 'Synthetic photo cleanup must succeed');
  if (result) { await writeFile('test-results/submission-image-limit.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }
}
