export const RATING_FIELDS = ['quality', 'value_for_money', 'responsiveness', 'production_speed'];
export function publicPhotoIndexes(row) {
  return row.status === 'published' && row.photos_public === true
    ? row.photo_paths.flatMap((path, index) => (row.excluded_photo_paths ?? []).includes(path) ? [] : [index]) : [];
}
export function publicReview(row) {
  if (!row || row.status !== 'published') return null;
  // Deliberate allowlist: never spread a source record into a public response.
  return { id: row.id, vendor_id: row.vendor_id, display_name: row.display_name,
    product_service: row.product_service, experience: row.experience, published_at: row.published_at,
    ...Object.fromEntries(RATING_FIELDS.map(field => [field, row[field]])), photos: publicPhotoIndexes(row) };
}
export function summarizeReviews(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.status !== 'published') continue;
    let group = groups.get(row.vendor_id);
    if (!group) { group = { vendor_id: row.vendor_id, count: 0, ...Object.fromEntries(RATING_FIELDS.map(key => [key, 0])) }; groups.set(row.vendor_id, group); }
    group.count++;
    for (const key of RATING_FIELDS) group[key] += row[key];
  }
  return [...groups.values()].map(group => {
    const averages = Object.fromEntries(RATING_FIELDS.map(key => [key, group[key] / group.count]));
    return { vendor_id: group.vendor_id, count: group.count, overall: RATING_FIELDS.reduce((sum, key) => sum + averages[key], 0) / 4, ...averages };
  });
}
