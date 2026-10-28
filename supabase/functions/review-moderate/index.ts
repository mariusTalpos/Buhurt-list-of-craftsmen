import { createClient } from '@supabase/supabase-js';
import { createModerationHandler } from './handler.js';
import { vendorIds } from '../review-submit/vendors.js';
import { previewTokenHash } from '../review-submit/deployment.js';
const url = Deno.env.get('SUPABASE_URL')!;
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
function checked({ data, error }) { if (error) throw error; return data; }
function storeFor(client) {
  const bucket = client.storage.from('review-photos');
  return {
    async list(status) { return checked(await client.from('reviews').select('id,vendor_id,display_name,product_service,status,created_at,updated_at').eq('status', status).order('created_at', { ascending: false })); },
    async get(id) { return checked(await client.from('reviews').select('*').eq('id', id).maybeSingle()); },
    async update(id, version, patch) { return checked(await client.from('reviews').update(patch).eq('id', id).eq('updated_at', version).select().maybeSingle()); },
    async delete(id, version) { return Boolean(checked(await client.from('reviews').delete().eq('id', id).eq('updated_at', version).select('id').maybeSingle())); },
    async listPhotos(id) { return checked(await bucket.list(id, { limit: 100 })).map(file => `${id}/${file.name}`); },
    async removePhotos(paths) { checked(await bucket.remove(paths)); },
    async photo(path) { const { data, error } = await bucket.download(path); return error ? null : data; },
  };
}
async function authorize(token) {
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  // Caller-scoped client keeps the existing exact-owner RLS as a second check.
  const client = createClient(url, secret, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const access = await client.rpc('review_owner_access');
  if (access.error || access.data !== true) return null;
  return storeFor(client);
}
const publicStore = {
  async get(id) { return checked(await admin.from('reviews').select('id,status,photos_public,photo_paths,excluded_photo_paths').eq('id', id).maybeSingle()); },
  photo: storeFor(admin).photo,
};
Deno.serve(createModerationHandler({ authorize, publicStore, vendorIds: new Set(vendorIds),
  publicEnabled: Deno.env.get('REVIEW_PUBLIC_ENABLED') === 'true', previewTokenHash,
  allowedOrigins: (Deno.env.get('REVIEW_ALLOWED_ORIGINS') ?? 'http://localhost:8000,http://127.0.0.1:8000').split(',').map(item => item.trim()).filter(Boolean) }));
