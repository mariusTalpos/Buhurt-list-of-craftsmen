export const RATING_FIELDS = ['quality', 'value_for_money', 'responsiveness', 'production_speed'];
export const CONTACT_METHODS = ['facebook', 'instagram', 'whatsapp', 'phone', 'email'];
export class ReviewError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message) => { throw new ReviewError(message); };
export function validateReview(raw, vendorIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Complete the review form.');
  const allowed = ['vendor_id', 'display_name', 'contact_name', 'contact_method', 'contact_details', 'product_service', 'experience', 'photos_public', 'confirmed', 'website', ...RATING_FIELDS];
  if (Object.keys(raw).some((key) => !allowed.includes(key))) fail('Unexpected review fields.');
  if (raw.website) fail('Unable to accept this submission.');
  const data = {};
  for (const [key, max] of [['vendor_id', 32], ['display_name', 80], ['contact_name', 120], ['contact_details', 500], ['product_service', 200], ['experience', 5000]]) {
    if (typeof raw[key] !== 'string' || !raw[key].trim() || raw[key].trim().length > max) fail(`Please check ${key.replaceAll('_', ' ')} (maximum ${max} characters).`);
    data[key] = raw[key].trim();
  }
  if (!vendorIds.has(data.vendor_id)) fail('Choose a craftsman from the directory.');
  if (!CONTACT_METHODS.includes(raw.contact_method)) fail('Choose a supported contact method.');
  data.contact_method = raw.contact_method;
  if (data.contact_method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact_details)) fail('Enter a valid email address.');
  if (['phone', 'whatsapp'].includes(data.contact_method) && !/^\+[\d ()-]{6,30}$/.test(data.contact_details)) fail('Include the country code, for example +1 555 123 4567.');
  if (['facebook', 'instagram'].includes(data.contact_method)) {
    let url; try { url = new URL(data.contact_details); } catch { fail('Enter a complete profile link starting with https://.'); }
    const domain = data.contact_method === 'facebook' ? 'facebook.com' : 'instagram.com';
    if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))) fail(`Enter a link to your ${data.contact_method} profile.`);
  }
  for (const field of RATING_FIELDS) {
    if (!Number.isInteger(raw[field]) || raw[field] < 1 || raw[field] > 5) fail('Rate all four categories from 1 to 5 stars.');
    data[field] = raw[field];
  }
  if (typeof raw.photos_public !== 'boolean' || raw.confirmed !== true) fail('Confirm your experience and photo-sharing choice.');
  data.photos_public = raw.photos_public;
  return data;
}

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export function validatePhotoManifest(photos) {
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 5) fail('Choose between 1 and 5 photos.');
  return photos.map((photo) => {
    if (!photo || Object.keys(photo).some((key) => !['size', 'sha256'].includes(key)) ||
        !Number.isInteger(photo.size) || photo.size < 1 || photo.size > MAX_PHOTO_BYTES || !/^[a-f0-9]{64}$/.test(photo.sha256)) fail('One of the photos is invalid or too large.');
    return { size: photo.size, sha256: photo.sha256 };
  });
}
