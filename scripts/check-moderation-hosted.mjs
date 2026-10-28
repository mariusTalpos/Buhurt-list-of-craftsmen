// Read-only hosted checks. Owner lifecycle is exercised in the actual signed-in UI.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const config = JSON.parse(await readFile('.local/review-preview.json', 'utf8'));
const endpoint = `${config.supabaseUrl}/functions/v1/review-moderate`;
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1];
const shared = argument('shared-id') ?? '529330d7-5b09-44f7-9086-53bd8e26ca0c';
const privateId = argument('private-id') ?? 'b6964c1f-05c2-46c0-a2b6-edbde610eb89';
const results = [];
async function check(action, { id = shared, expected = 401, method = 'GET', token, preview = false, index = 0 } = {}) {
  const response = await fetch(`${endpoint}?${new URLSearchParams({ action, id, index: String(index), status: 'pending' })}`, {
    method, headers: { Origin: 'http://localhost:8000', apikey: config.supabasePublishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(preview ? { 'x-review-preview': config.previewToken } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify({ id }) } : {}) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status, expected, `${action}: ${new TextDecoder().decode(bytes).slice(0,150)}`);
  assert.match(response.headers.get('cache-control'), /no-store/);
  if (expected === 200) { assert.equal(response.headers.get('content-type'), 'image/jpeg'); assert.equal(bytes[0], 255); assert.equal(bytes[1], 216); }
  else assert.ok(!new TextDecoder().decode(bytes).includes('phase2@example.invalid'));
  results.push({ action, expected, status: response.status, private: id === privateId, bytes: bytes.length });
}
for (const action of ['list','get','photo','edit','approve','unpublish','delete']) {
  const method = ['list','get','photo'].includes(action) ? 'GET' : 'POST';
  await check(action, { method }); await check(action, { method, token: 'forged-token', expected: 403 });
}
await check('public-photo', { expected: 404 });
await check('public-photo', { preview: true, id: privateId, expected: 404 });
await check('public-photo', { preview: true, expected: process.argv.includes('--expect-shared') ? 200 : 404 });
await mkdir('test-results/moderation', { recursive: true });
const suffix = process.argv.includes('--expect-shared') ? 'shared' : 'withdrawn';
await writeFile(`test-results/moderation/hosted-${suffix}.json`, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log(`Hosted moderation: ${results.length} read-only checks passed (${suffix}).`);
