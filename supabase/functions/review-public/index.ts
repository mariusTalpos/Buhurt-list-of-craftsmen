import { createClient } from '@supabase/supabase-js';
import { createPublicReviewHandler } from './handler.js';
import { previewTokenHash } from '../review-submit/deployment.js';
import { vendorIds } from '../review-submit/vendors.js';
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const client = createClient(Deno.env.get('SUPABASE_URL')!, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const columns = 'id,vendor_id,status,display_name,product_service,experience,quality,value_for_money,responsiveness,production_speed,published_at,photos_public,photo_paths,excluded_photo_paths';
function checked({ data, error }) { if (error) throw error; return data; }
const store = {
  async ratings() {
    const rows = [];
    // Avoid Supabase's default row cap silently dropping score contributions.
    for (let offset = 0; ; offset += 1000) {
      const page = checked(await client.from('reviews').select('id,vendor_id,status,quality,value_for_money,responsiveness,production_speed').eq('status', 'published').order('id').range(offset, offset + 999));
      rows.push(...page); if (page.length < 1000) return rows;
    }
  },
  async list(vendor, offset, limit) { return checked(await client.from('reviews').select(columns).eq('status', 'published').eq('vendor_id', vendor).order('published_at', { ascending: false }).order('id').range(offset, offset + limit - 1)); },
  async get(id) { return checked(await client.from('reviews').select(columns).eq('status', 'published').eq('id', id).maybeSingle()); },
  async photo(path) { const { data, error } = await client.storage.from('review-photos').download(path); return error ? null : data; },
};
Deno.serve(createPublicReviewHandler({ store, vendorIds: new Set(vendorIds), previewTokenHash,
  publicEnabled: Deno.env.get('REVIEW_PUBLIC_ENABLED') === 'true',
  allowedOrigins: (Deno.env.get('REVIEW_ALLOWED_ORIGINS') ?? 'http://localhost:8000,http://127.0.0.1:8000').split(',').map(item => item.trim()).filter(Boolean) }));
