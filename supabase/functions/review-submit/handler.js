import { ReviewError, validateReview, validatePhotoManifest, MAX_PHOTO_BYTES } from '../_shared/review-policy.js';

const enc = new TextEncoder();
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64 = (text) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (ch) => ch.charCodeAt(0));
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('');
}
async function hmac(secret, bytes) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let result = 0; for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i]; return result === 0;
}
export async function signPermit(payload, secret) {
  const body = toBase64(enc.encode(JSON.stringify(payload)));
  return `${body}.${toBase64(await hmac(secret, enc.encode(body)))}`;
}
export async function verifyPermit(token, secret, now = Date.now(), allowExpired = false) {
  try {
    if (typeof token !== 'string' || token.length > 64_000) throw new Error();
    const [body, signature, extra] = token.split('.');
    if (extra || !signature || !equal(fromBase64(signature), await hmac(secret, enc.encode(body)))) throw new Error();
    const payload = JSON.parse(new TextDecoder().decode(fromBase64(body)));
    if (!Number.isFinite(payload.expires) || (!allowExpired && payload.expires < now) || payload.expires > now + 31 * 60_000) throw new Error();
    return payload;
  } catch { throw new ReviewError('Upload permission expired or is invalid. Submit again to retry.', 401); }
}

export async function readBody(request, maxBytes) {
  const announced = request.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > maxBytes)) throw new ReviewError('Upload is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ReviewError('Request body is missing.');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ReviewError('Upload is too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Strictly validate a browser-processed JPEG by decoding its pixels on the server.
// Remove all application/comment metadata and data appended after the final EOI.
export function validateAndStripJpeg(bytes, jpeg) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw new ReviewError('Upload a processed JPEG photo.');
  let decoded;
  try { decoded = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 7, maxMemoryUsageInMB: 140, tolerantDecoding: false }); }
  catch { throw new ReviewError('One of the photos is corrupt or too large to decode.'); }
  if (!decoded.width || !decoded.height || Math.max(decoded.width, decoded.height) > 2560) throw new ReviewError('Processed photos must be no larger than 2560 pixels per side.');
  const output = [bytes.subarray(0, 2)]; let i = 2;
  while (i < bytes.length) {
    const start = i;
    if (bytes[i++] !== 255) throw new ReviewError('Invalid JPEG structure.');
    while (bytes[i] === 255) i++;
    const marker = bytes[i++];
    if (marker === 0xd9) { output.push(bytes.subarray(start, i)); break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { output.push(bytes.subarray(start, i)); continue; }
    if (i + 2 > bytes.length) throw new ReviewError('Invalid JPEG structure.');
    const size = bytes[i] * 256 + bytes[i + 1];
    if (size < 2 || i + size > bytes.length) throw new ReviewError('Invalid JPEG structure.');
    i += size;
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) output.push(bytes.subarray(start, i));
    if (marker === 0xda) {
      const scanStart = i;
      while (i < bytes.length - 1) {
        if (bytes[i] === 255 && bytes[i + 1] !== 0 && !(bytes[i + 1] >= 0xd0 && bytes[i + 1] <= 0xd7)) break;
        i++;
      }
      output.push(bytes.subarray(scanStart, i));
    }
  }
  if (!output.at(-1) || output.at(-1).at(-1) !== 217) throw new ReviewError('Incomplete JPEG photo.');
  const clean = new Uint8Array(output.reduce((sum, item) => sum + item.length, 0)); let offset = 0;
  for (const item of output) { clean.set(item, offset); offset += item.length; }
  return clean;
}

export function createSubmissionHandler({ store, secret, jpeg, vendorIds, allowedOrigins,
  publicEnabled = false, previewTokenHash = '', turnstileSecret = '', fetcher = fetch, now = Date.now }) {
  return async (request) => {
    const origin = request.headers.get('origin') ?? '';
    const cors = { 'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : 'null',
      'Access-Control-Allow-Headers': 'content-type, apikey, x-review-preview, x-upload-permit, x-photo-index',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
    const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    try {
      if (!allowedOrigins.includes(origin)) throw new ReviewError('This submission origin is not allowed.', 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') throw new ReviewError('Method not allowed.', 405);
      if (!secret) throw new ReviewError('Review submissions are temporarily unavailable.', 503);
      if (!publicEnabled) {
        const key = request.headers.get('x-review-preview') ?? '';
        if (!previewTokenHash || key.length < 32 || await sha256(enc.encode(key)) !== previewTokenHash) throw new ReviewError('Review submissions are not open yet.', 403);
      }
      if (!turnstileSecret || (publicEnabled && /^[123]x0+AA$/.test(turnstileSecret))) throw new ReviewError('Bot protection is not configured.', 503);
      const action = new URL(request.url).searchParams.get('action') ?? 'start';
      if (!['start', 'photo', 'finish', 'cancel'].includes(action)) throw new ReviewError('Unknown submission action.');
      // The hosted gateway supplies the forwarding header. Never persist the raw address.
      const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
      const rateKey = await sha256(await hmac(secret, enc.encode(`${action}:${address}`)));
      if (!await store.consumeLimit(rateKey, action)) throw new ReviewError('Too many attempts. Please try again in an hour.', 429);

      if (action === 'start') {
        let body; try { body = JSON.parse(new TextDecoder().decode(await readBody(request, 24_000))); }
        catch (error) { if (error instanceof ReviewError) throw error; throw new ReviewError('Invalid review form.'); }
        if (!body || Object.keys(body).some((key) => !['review', 'photos', 'challenge'].includes(key))) throw new ReviewError('Unexpected submission fields.');
        const review = validateReview(body.review, vendorIds);
        const photos = validatePhotoManifest(body.photos);
        if (typeof body.challenge !== 'string' || !body.challenge || body.challenge.length > 2048) throw new ReviewError('Complete the bot check.');
        // Keep preview tests deterministic even if the provider's always-pass
        // secret accepts arbitrary tokens. Test credentials are never public mode.
        if (!publicEnabled && /^[123]x0+AA$/.test(turnstileSecret) && body.challenge !== 'XXXX.DUMMY.TOKEN.XXXX') throw new ReviewError('Bot check failed or expired. Please retry.');
        let challenge;
        try {
          const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST',
            body: new URLSearchParams({ secret: turnstileSecret, response: body.challenge }), signal: AbortSignal.timeout(10_000) });
          if (!response.ok) throw new Error(); challenge = await response.json();
        } catch { throw new ReviewError('Bot check is unavailable. Please retry.', 503); }
        if (!challenge.success || (publicEnabled && (challenge.hostname !== new URL(origin).hostname || challenge.action !== 'review-submit'))) throw new ReviewError('Bot check failed or expired. Please retry.');
        const id = crypto.randomUUID();
        const manifest = photos.map((photo) => ({ ...photo, path: `${id}/${crypto.randomUUID()}.jpg` }));
        const payload = { id, review, photos: manifest, expires: now() + 30 * 60_000 };
        return respond({ permit: await signPermit(payload, secret), expires: payload.expires, photoCount: photos.length });
      }

      const payload = await verifyPermit(request.headers.get('x-upload-permit'), secret, now(), action === 'finish' || action === 'cancel');
      if (action === 'photo') {
        const index = Number(request.headers.get('x-photo-index'));
        if (!Number.isInteger(index) || index < 0 || index >= payload.photos.length) throw new ReviewError('Invalid photo index.');
        const entry = payload.photos[index];
        const bytes = await readBody(request, MAX_PHOTO_BYTES);
        if (bytes.length !== entry.size || await sha256(bytes) !== entry.sha256) throw new ReviewError('Photo changed during upload. Submit again.');
        // Existing successful retries need not decode the same image again.
        if (!await store.hasPhoto(payload.id, entry.path)) {
          const clean = validateAndStripJpeg(bytes, jpeg);
          try { await store.upload(entry.path, clean); }
          catch { throw new ReviewError('Photo upload failed. Your review has not been submitted; please retry.', 503); }
        }
        return respond({ uploaded: index });
      }
      if (action === 'cancel') {
        // A lost success response must never cause a completed review's files to be deleted.
        if (await store.findReview(payload.id)) return respond({ cancelled: false, reference: payload.id });
        await store.removePhotos(payload.photos.map((photo) => photo.path));
        return respond({ cancelled: true });
      }
      if (await store.findReview(payload.id)) return respond({ reference: payload.id, status: 'pending' });
      if (payload.expires < now()) throw new ReviewError('Upload permission expired. Submit again to retry.', 401);
      const saved = await store.listPhotos(payload.id);
      if (!payload.photos.every((photo) => saved.includes(photo.path))) throw new ReviewError('Some photos are missing. Please retry your submission.');
      try { await store.insertReview({ ...payload.review, id: payload.id, status: 'pending', photo_paths: payload.photos.map((photo) => photo.path) }); }
      catch {
        // Database timeouts can be ambiguous. Leave files intact until the caller retries
        // finish or cancel, both of which check whether the record actually committed.
        if (!await store.findReview(payload.id)) throw new ReviewError('Could not confirm your review was saved. Keep this page open and retry.', 503);
      }
      return respond({ reference: payload.id, status: 'pending' });
    } catch (error) {
      return respond({ error: error instanceof ReviewError ? error.message : 'Review service is temporarily unavailable. Keep this page open and retry.' }, error instanceof ReviewError ? error.status : 503);
    }
  };
}
