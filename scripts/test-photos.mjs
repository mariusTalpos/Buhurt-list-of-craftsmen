import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { prototypeServer } from './serve-prototype.mjs';
const server = prototypeServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}/prototypes/photos.html`);
  const results = await page.evaluate(async () => {
    const { processPhoto } = await import('/assets/photos/process-photo.js');
    const outputs = [];
    for (const [name, mime] of [['libheif-example.heic', 'image/heic'], ['phone.heic', ''], ['orientation-6.jpg', 'image/jpeg']]) {
      const response = await fetch(`/tests/fixtures/${name}`);
      if (!response.ok) throw new Error(`Missing fixture ${name}; see tests/fixtures/README.md`);
      const file = new File([await response.arrayBuffer()], name, { type: mime });
      const result = await processPhoto(file);
      const output = new Uint8Array(await result.blob.arrayBuffer());
      const text = new TextDecoder('latin1').decode(output);
      outputs.push({ name, ...result, blob: undefined, size: result.blob.size, type: result.blob.type,
        hasExif: text.includes('Exif\0\0'), hasXmp: text.includes('http://ns.adobe.com/xap'), bytes: [...output] });
    }
    // Real PNG and WebP encoded from decoded photo pixels, plus HEIF extension/MIME.
    const response = await fetch('/tests/fixtures/orientation-6.jpg');
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
    for (const mime of ['image/png', 'image/webp']) {
      const file = new File([await canvas.convertToBlob({ type: mime })], `derived.${mime.split('/')[1]}`, { type: mime });
      const result = await processPhoto(file);
      outputs.push({ name: mime, ...result, blob: undefined, size: result.blob.size, type: result.blob.type });
    }
    const heif = new File([await (await fetch('/tests/fixtures/phone.heic')).arrayBuffer()], 'phone.heif', { type: 'image/heif' });
    const converted = await processPhoto(heif);
    outputs.push({ name: 'same HEIF container with .heif extension', width: converted.width, height: converted.height, size: converted.blob.size, type: converted.blob.type });
    try { await processPhoto(new File(['fake image'], 'fake.heic')); throw new Error('Corrupt image accepted'); }
    catch (error) { if (!error.message.includes('Choose a JPEG')) throw error; }
    return outputs;
  });
  await mkdir('test-results/photos', { recursive: true });
  for (const result of results) {
    assert.equal(result.type, 'image/jpeg');
    assert.ok(result.width > 0 && result.height > 0 && Math.max(result.width, result.height) <= 2560);
    assert.ok(result.size > 0 && result.size <= 10 * 1024 * 1024);
    if (result.bytes) {
      assert.equal(result.hasExif, false); assert.equal(result.hasXmp, false);
      await writeFile(`test-results/photos/${result.name}.jpg`, Buffer.from(result.bytes)); delete result.bytes;
    }
  }
  const portraitTag = results.find((r) => r.name === 'orientation-6.jpg');
  // Upstream Landscape_6 is stored 1200x1800 with EXIF rotate 90°; display is 1800x1200.
  assert.equal(portraitTag.width, 1800); assert.equal(portraitTag.height, 1200);
  await page.locator('#photos').setInputFiles(['tests/fixtures/phone.heic', 'tests/fixtures/orientation-6.jpg']);
  const beforeProcessRequests = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) beforeProcessRequests.push(request.url());
  });
  await page.locator('#process').click();
  await page.getByText('Finished. No photos were uploaded.').waitFor();
  assert.equal(await page.locator('.error').count(), 0);
  assert.equal(beforeProcessRequests.length, 0, 'Photos must not leave the local test origin');
  await page.screenshot({ path: 'test-results/photos/mobile-prototype.png', fullPage: true });
  await page.goto(origin);
  assert.ok(await page.locator('.card').count() > 0, 'Existing directory still renders');
  assert.equal((await page.request.get(`${origin}/.env`)).status(), 404);
  assert.equal((await page.request.get(`${origin}/.local/secrets.json`)).status(), 404);
  await writeFile('test-results/photos/results.json', JSON.stringify({ browser: browser.version(), viewport: '390x844 (desktop emulation, not a physical phone)', results }, null, 2));
  console.log(JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
