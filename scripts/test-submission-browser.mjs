import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { prototypeServer } from './serve-prototype.mjs';
import { createSubmissionHandler, sha256 } from '../supabase/functions/review-submit/handler.js';
const server = prototypeServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const previewToken = 'browser-test-preview-capability-1234567890';
const config = { submissionEnabled: true, supabaseUrl: 'https://phase2-browser.invalid', supabasePublishableKey: 'sb_publishable_test', turnstileSiteKey: '1x00000000000000000000AA', previewToken };
const rows = new Map(); const objects = new Map(); let starts = 0;
const store = {
  async consumeLimit() { return true; },
  async listPhotos(id) { return [...objects.keys()].filter((p) => p.startsWith(id + '/')); },
  async hasPhoto(id, path) { return objects.has(path); }, async upload(path, bytes) { objects.set(path, bytes); },
  async removePhotos(paths) { paths.forEach((p) => objects.delete(p)); },
  async findReview(id) { return rows.get(id) ?? null; }, async insertReview(row) { rows.set(row.id, row); },
};
const handler = createSubmissionHandler({ store, secret: 'browser-test-only', jpeg, vendorIds: new Set(['1']), allowedOrigins: [origin],
  previewTokenHash: await sha256(new TextEncoder().encode(previewToken)), turnstileSecret: 'test-secret', fetcher: async () => Response.json({ success: true }) });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/public-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const reviewConfig=${JSON.stringify(config)};` }));
  await context.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', (route) => route.fulfill({ contentType: 'text/javascript', body: `window.turnstile={render:(el,options)=>{window.testBotCallback=options.callback;options.callback('XXXX.DUMMY.TOKEN.XXXX');return 'test-widget'},reset:()=>window.testBotCallback('XXXX.DUMMY.TOKEN.XXXX')};` }));
  let loseReply = true;
  await context.route('https://phase2-browser.invalid/**', async (route) => {
    const incoming = route.request();
    if (incoming.method() === 'POST' && new URL(incoming.url()).searchParams.get('action') === 'start') starts++;
    const response = await handler(new Request(incoming.url(), { method: incoming.method(), headers: incoming.headers(), body: incoming.postDataBuffer() }));
    if (incoming.method() === 'POST') {
      const payload = await response.clone().json();
      console.log('Browser test API:', new URL(incoming.url()).searchParams.get('action'), response.status, payload.error ?? 'ok');
    }
    if (incoming.method() === 'POST' && new URL(incoming.url()).searchParams.get('action') === 'finish' && loseReply) { loseReply = false; await route.abort(); return; }
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  const page = await context.newPage();
  await page.goto(origin); await page.locator('.review-action[data-review-vendor="1"]').waitFor({ state: 'visible' });
  await page.locator('.review-action[data-review-vendor="1"]').click();
  await page.getByLabel('Public display name').fill('Browser test fighter');
  await page.getByLabel('Public display name').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').getAttribute('name'), 'product_service');
  await page.getByLabel('Product or service').fill('Steel gauntlets');
  const experience = 'A detailed firsthand review kept in the browser when the connection fails.';
  await page.getByRole('textbox', { name: 'Your experience', exact: true }).fill(experience);
  await page.getByLabel('Contact name', { exact: true }).fill('Private contact name');
  for (const [method, phrase] of [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['phone', 'phone'], ['email', 'email']]) {
    await page.getByLabel('Contact method', { exact: true }).selectOption(method);
    assert.ok((await page.locator('#review-contact-label').innerText()).includes(phrase));
  }
  await page.getByLabel('Your email address', { exact: true }).fill('private@example.invalid');
  await page.locator('input[name="confirmed"]').check();
  await page.locator('#review-submit').click();
  assert.equal(starts, 0, 'Missing ratings must not call backend');
  for (const field of ['quality', 'value_for_money', 'responsiveness', 'production_speed']) await page.locator(`input[name="${field}"][value="4"]`).check();
  await page.locator('#review-photos').setInputFiles('tests/fixtures/phone.heic');
  await page.getByText('Photos prepared locally. Nothing has been uploaded yet.').waitFor();
  assert.equal(starts, 0, 'Photo selection/processing must not upload');
  await page.locator('input[name="photos_public"]').uncheck();
  await page.getByRole('button', { name: 'Preview public review' }).click();
  const preview = await page.locator('#review-preview-panel').innerText();
  assert.ok(preview.includes(experience)); assert.ok(!preview.includes('private@example.invalid')); assert.ok(!preview.includes('Private contact name'));
  await mkdir('test-results/reviews', { recursive: true });
  await page.locator('#review-private-heading').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1), 'Mobile dialog must not overflow horizontally');
  await page.screenshot({ path: 'test-results/reviews/mobile-form.png' });
  await page.locator('#review-submit').click();
  await page.getByText('Connection interrupted. Your submission is not confirmed. Keep this page open and retry.').waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Your experience', exact: true }).inputValue(), experience);
  assert.equal(rows.size, 1);
  await page.locator('#review-submit').click();
  await page.getByText('Your review was submitted for approval. It is not public yet.').waitFor();
  assert.equal(rows.size, 1); assert.equal(starts, 1); assert.equal(objects.size, 1);
  assert.equal([...rows.values()][0].photos_public, false);
  assert.equal([...rows.values()][0].status, 'pending');
  await page.screenshot({ path: 'test-results/reviews/submission-confirmed.png' });
  // A fresh deployment without configuration must keep the existing site usable.
  await page.close();
  await context.unroute('**/public-config.js');
  await context.route('**/public-config.js', (route) => route.fulfill({ status: 404, body: '' }));
  await context.route('**/public-config.production.js', (route) => route.fulfill({ status: 404, body: '' }));
  const plain = await context.newPage(); await plain.goto(origin);
  assert.ok(await plain.locator('.card').count() > 0);
  assert.equal(await plain.locator('.review-action:visible').count(), 0);
  console.log('PASS: mobile form, all contact choices, required ratings, HEIC preparation without upload, private preview, and retry after lost final reply. Unconfigured directory remains usable.');
  await writeFile('test-results/reviews/browser.json', JSON.stringify({ browser: browser.version(), viewport: '390x844 desktop emulation', starts, savedReviews: rows.size, storedPhotos: objects.size }, null, 2));
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
