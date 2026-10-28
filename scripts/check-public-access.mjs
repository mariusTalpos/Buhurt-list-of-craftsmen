// Uses the browser-safe key only. Does not create a user, review, or photo.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key?.startsWith('sb_publishable_')) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to the public project configuration.');
const headers = { apikey: key };
const settings = await (await fetch(`${url}/auth/v1/settings`, { headers })).json();
assert.equal(settings.disable_signup, true, 'Public account signups must be disabled');
assert.equal(settings.external?.anonymous_users, false, 'Anonymous Auth accounts must be disabled');
const reviewRead = await fetch(`${url}/rest/v1/reviews?select=id`, { headers });
assert.ok([401, 403].includes(reviewRead.status), 'Anonymous raw review reads must be denied');
assert.equal((await reviewRead.json()).code, '42501', 'Read denial must be a database permission denial, not an invalid API key');
const reviewWrite = await fetch(`${url}/rest/v1/reviews`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
assert.ok([401, 403].includes(reviewWrite.status), 'Anonymous direct review inserts must be denied');
assert.equal((await reviewWrite.json()).code, '42501', 'Write denial must be a database permission denial');
const result = { publicSignupsDisabled: settings.disable_signup, anonymousAuthDisabled: !settings.external.anonymous_users,
  anonymousReviewRead: reviewRead.status, anonymousReviewInsert: reviewWrite.status };
if (process.env.TEST_PHOTO_PATH) {
  const path = process.env.TEST_PHOTO_PATH.split('/').map(encodeURIComponent).join('/');
  const photo = await fetch(`${url}/storage/v1/object/public/review-photos/${path}`, { headers });
  assert.equal(photo.ok, false, 'A known pending photo must not be downloadable through the public object URL');
  result.pendingPhotoRead = photo.status;
  const limit = await fetch(`${url}/rest/v1/rpc/consume_review_submission_limit`, { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_key: 'b'.repeat(64), p_scope: 'start' }) });
  assert.equal(limit.ok, false, 'Anonymous callers must not control rate-limit counters');
  result.anonymousRateRpc = limit.status;
}
await mkdir('test-results', { recursive: true });
await writeFile('test-results/public-access.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
