// Public values only. See the Phase 4 handoff before preparing a release.
export const reviewConfig = Object.freeze({
  supabaseUrl: 'https://viiltjxyojhlswtieexc.supabase.co',
  supabasePublishableKey: 'REPLACE_WITH_sb_publishable_KEY',
  submissionEnabled: false, // Keep disabled until the form/backend are configured.
  reviewsEnabled: false, // Enable when public read deployment is ready.
  turnstileSiteKey: 'REPLACE_WITH_SITE_KEY', // Public identifier, never the secret.
  // previewToken is only used in ignored local development configuration.
  // Production visitors do not need accounts or preview credentials.
});
