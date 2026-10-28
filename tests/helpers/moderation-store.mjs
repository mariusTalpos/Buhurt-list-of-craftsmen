export const publicId = '529330d7-5b09-44f7-9086-53bd8e26ca0c';
export const privateId = 'b6964c1f-05c2-46c0-a2b6-edbde610eb89';
export function moderationStore() {
  const rows = new Map(); const photos = new Map(); let tick = 0;
  const now = () => new Date(1793142000000 + ++tick * 1000).toISOString();
  for (const [id, shared] of [[publicId, true], [privateId, false]]) {
    const paths = [1, 2].map(n => `${id}/00000000-0000-0000-0000-${String(n).padStart(12, '0')}.jpg`);
    const stamp = now();
    rows.set(id, { id, vendor_id: '1', status: 'pending', display_name: `Synthetic ${shared ? 'public' : 'private'} photos`,
      product_service: 'Test gauntlets', experience: 'Synthetic review for lifecycle tests, not a real purchase.',
      quality: 4, value_for_money: 3, responsiveness: 5, production_speed: 2,
      contact_name: 'Private test contact', contact_method: 'email', contact_details: 'test@example.invalid',
      owner_note: '', photos_public: shared, photo_paths: paths, excluded_photo_paths: [],
      created_at: stamp, updated_at: stamp, published_at: null });
    paths.forEach(path => photos.set(path, new Blob([new Uint8Array([255,216,255,217])], { type: 'image/jpeg' })));
  }
  const clone = value => value ? structuredClone(value) : null;
  const failures = { remove: false, afterRemove: false, delete: false };
  const store = {
    async list(status) { return [...rows.values()].filter(row => row.status === status).map(clone); },
    async get(id) { return clone(rows.get(id)); },
    async update(id, version, patch) {
      const row = rows.get(id); if (!row || version !== row.updated_at) return null;
      const updated = { ...row, ...clone(patch), updated_at: now() };
      updated.published_at = updated.status === 'pending' ? null : row.published_at ?? now();
      rows.set(id, updated); return clone(updated);
    },
    async delete(id, version) { if (failures.delete) throw new Error('DB offline'); if (rows.get(id)?.updated_at !== version) return false; rows.delete(id); return true; },
    async listPhotos(id) { return [...photos.keys()].filter(path => path.startsWith(`${id}/`)); },
    async removePhotos(paths) { if (failures.remove) throw new Error('Storage offline'); paths.forEach(path => photos.delete(path)); if (failures.afterRemove) throw new Error('Lost reply'); },
    async photo(path) { return photos.get(path); },
  };
  return { rows, photos, failures, store };
}
export function editFields(row, patch = {}) {
  return { ...Object.fromEntries(['display_name', 'product_service', 'experience', 'contact_name', 'contact_method', 'contact_details', 'quality', 'value_for_money', 'responsiveness', 'production_speed', 'owner_note', 'excluded_photo_paths'].map(key => [key, row[key]])), ...patch };
}
