import { createClient } from '@supabase/supabase-js';
import jpeg from 'jpeg-js';
import { createSubmissionHandler } from './handler.js';
import { previewTokenHash } from './deployment.js';
import { vendorIds } from './vendors.js';

const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
const secret = secretKeys.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = supabase.storage.from('review-photos');
function checked({ data, error }) { if (error) throw error; return data; }
const store = {
  async consumeLimit(key, scope) { return checked(await supabase.rpc('consume_review_submission_limit', { p_key: key, p_scope: scope })); },
  async listPhotos(id) { return checked(await bucket.list(id, { limit: 10 })).map((file) => `${id}/${file.name}`); },
  async hasPhoto(id, path) { return (await this.listPhotos(id)).includes(path); },
  async upload(path, bytes) { checked(await bucket.upload(path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' })); },
  async removePhotos(paths) { checked(await bucket.remove(paths)); },
  async findReview(id) { return checked(await supabase.from('reviews').select('id').eq('id', id).maybeSingle()); },
  async insertReview(row) { checked(await supabase.from('reviews').insert(row)); },
};
const publicEnabled = Deno.env.get('REVIEW_PUBLIC_ENABLED') === 'true';
const origins = (Deno.env.get('REVIEW_ALLOWED_ORIGINS') ?? 'http://localhost:8000,http://127.0.0.1:8000').split(',').map((item) => item.trim()).filter(Boolean);
Deno.serve(createSubmissionHandler({ store, secret, jpeg, vendorIds: new Set(vendorIds), allowedOrigins: origins, publicEnabled,
  // Saving production credentials must not pair them with the local test widget.
  // Preview remains capability-protected; public mode always requires a real secret.
  previewTokenHash, turnstileSecret: publicEnabled ? (Deno.env.get('TURNSTILE_SECRET_KEY') ?? '') : '1x0000000000000000000000000000000AA' }));
