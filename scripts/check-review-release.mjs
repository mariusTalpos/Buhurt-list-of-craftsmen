import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { reviewConfig } from '../public-config.production.js';
const allowed=['supabaseUrl','supabasePublishableKey','reviewsEnabled','submissionEnabled','turnstileSiteKey'];
assert.ok(Object.keys(reviewConfig).every(key=>allowed.includes(key)),'Production configuration must contain public fields only, without preview credentials.');
assert.equal(reviewConfig.supabaseUrl,'https://viiltjxyojhlswtieexc.supabase.co');
assert.ok(reviewConfig.supabasePublishableKey.startsWith('sb_publishable_'));
assert.equal(typeof reviewConfig.reviewsEnabled,'boolean');assert.equal(typeof reviewConfig.submissionEnabled,'boolean');
for(const path of ['assets/reviews/review-form.js','assets/reviews/public-reviews.js','assets/reviews/moderation.js','assets/reviews/public-reviews.css','assets/photos/photo-worker.js'])await access(path);
if(process.argv.includes('--launch')){
  assert.equal(reviewConfig.reviewsEnabled,true,'Public review display is still disabled.');
  assert.equal(reviewConfig.submissionEnabled,true,'Submissions are still disabled.');
  assert.ok(reviewConfig.turnstileSiteKey && !/^[123]x0+AA$/.test(reviewConfig.turnstileSiteKey),'Configure the real public Turnstile site key first.');
  console.log('Static release configuration passed. Hosted production bot/origin tests and launch authorization are still required.');
}else console.log('Public configuration/assets are valid. Launch readiness is separate; use --launch after final Turnstile configuration.');
