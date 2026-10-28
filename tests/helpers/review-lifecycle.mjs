import jpeg from 'jpeg-js';
import { createSubmissionHandler, sha256 } from '../../supabase/functions/review-submit/handler.js';
import { createModerationHandler } from '../../supabase/functions/review-moderate/handler.js';
import { createPublicReviewHandler } from '../../supabase/functions/review-public/handler.js';
import { SubmissionClient } from '../../src/reviews/submission-client.js';
import { moderationStore } from './moderation-store.mjs';
export const reviewData = (ratings = [5,4,3,4], shared = true) => ({ vendor_id: '1', display_name: 'Synthetic fighter',
  product_service: 'Synthetic gauntlets', experience: 'Synthetic firsthand experience; no real purchase or person.',
  quality: ratings[0], value_for_money: ratings[1], responsiveness: ratings[2], production_speed: ratings[3],
  contact_name: 'Private synthetic name', contact_method: 'email', contact_details: 'private@example.invalid', photos_public: shared, confirmed: true, website: '' });
export async function lifecycle(origin = 'http://localhost:8000') {
  const state = moderationStore(); state.rows.clear(); state.photos.clear();
  const config = { reviewsEnabled: true, submissionEnabled: true, supabaseUrl: 'https://lifecycle.invalid',
    supabasePublishableKey: 'sb_publishable_test', previewToken: 'test-only-preview-token-at-least-32-characters', turnstileSiteKey: '1x00000000000000000000AA' };
  const hash = await sha256(new TextEncoder().encode(config.previewToken)); const vendorIds = new Set(['1','2']);
  const submissionStore = { ...state.store,
    async consumeLimit() { return true; }, async hasPhoto(id, path) { return state.photos.has(path); },
    async upload(path, bytes) { state.photos.set(path, new Blob([bytes], { type: 'image/jpeg' })); },
    async findReview(id) { return state.rows.get(id); },
    async insertReview(row) { const stamp = new Date().toISOString(); state.rows.set(row.id, { ...row, owner_note: '', excluded_photo_paths: [], created_at: stamp, updated_at: stamp, published_at: null }); },
  };
  const submission = createSubmissionHandler({ store: submissionStore, jpeg, secret: 'test-only-secret', vendorIds, allowedOrigins: [origin],
    previewTokenHash: hash, turnstileSecret: 'test-secret', fetcher: async () => Response.json({ success: true }) });
  const moderation = createModerationHandler({ authorize: async token => token === 'test-owner' ? state.store : null,
    publicStore: state.store, vendorIds, allowedOrigins: [origin], previewTokenHash: hash });
  const publicStore = { ...state.store,
    async ratings() { return [...state.rows.values()]; },
    async list(vendor, offset, limit) { return [...state.rows.values()].filter(row => row.status === 'published' && row.vendor_id === vendor).sort((a,b) => b.published_at.localeCompare(a.published_at) || a.id.localeCompare(b.id)).slice(offset, offset+limit); },
  };
  const publicHandler = createPublicReviewHandler({ store: publicStore, vendorIds, allowedOrigins: [origin], previewTokenHash: hash });
  const submitter = new SubmissionClient(config, (url, options) => submission(new Request(url, { ...options, headers: { ...options.headers, Origin: origin } })));
  const bytes = jpeg.encode({ width: 8, height: 12, data: new Uint8Array(8*12*4).fill(180) },90).data;
  const photos = [{ blob: new Blob([bytes], { type: 'image/jpeg' }), sha256: await sha256(bytes) }];
  async function submit(data = reviewData()) { return (await submitter.submit(data, photos, 'XXXX.DUMMY.TOKEN.XXXX')).reference; }
  async function mutate(action, id, extra = {}) {
    return moderation(new Request(`${config.supabaseUrl}?action=${action}`, { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer test-owner' },
      body: JSON.stringify({ id, expected_updated_at: state.rows.get(id)?.updated_at, ...extra }) }));
  }
  async function read(action, params = {}, preview = true) {
    return publicHandler(new Request(`${config.supabaseUrl}?${new URLSearchParams({ action, ...params })}`, { headers: { Origin: origin, ...(preview ? { 'x-review-preview': config.previewToken } : {}) } }));
  }
  return { ...state, config, submission, moderation, publicHandler, publicStore, submit, mutate, read, submissionPhotos: photos };
}
