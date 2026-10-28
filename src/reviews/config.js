export async function loadReviewConfig() {
  // Local capability-bearing preview config is ignored by Git. Pages uses the
  // checked-in public-only configuration when that local override is absent.
  try { return (await import(new URL('../../public-config.js', import.meta.url).href)).reviewConfig; }
  catch { return (await import(new URL('../../public-config.production.js', import.meta.url).href)).reviewConfig; }
}
