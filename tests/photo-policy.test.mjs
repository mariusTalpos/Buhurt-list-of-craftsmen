import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyPhoto, headerDimensions, validateDimensions, validatePhotoSize, outputDimensions } from '../src/photos/photo-policy.js';
import { readFile } from 'node:fs/promises';

test('identifies supported contents without trusting an extension or MIME label', () => {
  assert.equal(identifyPhoto(Uint8Array.from([255, 216, 255, 224])), 'jpeg');
  assert.equal(identifyPhoto(new TextEncoder().encode('not really a .heic')), null);
  assert.equal(identifyPhoto(new Uint8Array()), null);
  const header = new Uint8Array(24); new DataView(header.buffer).setUint32(0, 24);
  header.set(new TextEncoder().encode('ftypheic'), 4);
  assert.equal(identifyPhoto(header), 'heif');
  header.set(new TextEncoder().encode('avif'), 16);
  assert.equal(identifyPhoto(header), null);
});
test('reads dimensions before allocating native-format pixels', async () => {
  const png = new Uint8Array(24); const view = new DataView(png.buffer);
  view.setUint32(16, 30_000); view.setUint32(20, 30_000);
  const size = headerDimensions(png, 'png');
  assert.throws(() => validateDimensions(size.width, size.height));
  assert.equal(headerDimensions(new Uint8Array(), 'jpeg'), null);
  try {
    const jpeg = await readFile('tests/fixtures/orientation-6.jpg');
    assert.deepEqual(headerDimensions(jpeg, 'jpeg'), { width: 1200, height: 1800 });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
});
test('caps file/pixel allocations and preserves portrait aspect ratio without upscaling', () => {
  assert.throws(() => validatePhotoSize(10 * 1024 * 1024 + 1));
  assert.throws(() => validateDimensions(20_000, 20_000));
  assert.throws(() => validateDimensions(12_000, 12_000));
  assert.doesNotThrow(() => validateDimensions(8064, 6048));
  assert.deepEqual(outputDimensions(3000, 4000), { width: 1920, height: 2560 });
  assert.deepEqual(outputDimensions(40, 30), { width: 40, height: 30 });
});
