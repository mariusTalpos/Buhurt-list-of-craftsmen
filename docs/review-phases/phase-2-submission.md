# Phase 2: Review submission

Status: Complete for private development testing, October 27, 2026. Depends on [Phase 1](phase-1-foundation.md), accepted by the owner. Public submissions remain closed; production bot credentials/hostname configuration are launch prerequisites.

## Objective

Let a visitor submit a complete review and photos into a private moderation queue. No visitor account and no automatic publication.

Read [the specification](../reviews-spec.md), [the work-plan index](../reviews-work-plan.md), and the Phase 1 handoff. Reuse its field names, storage, permissions, and tested image processing.

## Prerequisites

- Phase 1's hosted storage/access checks and required photo-format checks are complete.
- Project configuration and backend deployment access are available.
- Use test bot-challenge configuration during development. Production protection requires the chosen provider's credentials and allowed site hostname before public exposure; Turnstile is the current recommendation.

## Tasks

- [x] Build the mobile-friendly form from a vendor card, preserving existing directory behavior. Include public display name, private contact name, exactly five contact options, corresponding contact details, product/service, experience, all four ratings, and 1–5 photos.
- [x] Explain value for money, responsiveness, and production speed. No preselected ratings or partial submissions.
- [x] Add local image processing/preview and the single initially checked “Show my photos with my published review” choice. Show which information will be public and which stays private.
- [x] Keep images and form contents in the browser until Submit. Do not create saved drafts or upload on file selection.
- [x] Implement the submission endpoint with server validation of vendor IDs, ratings, text/contact limits, and actual image contents/sizes. Treat client-converted files as untrusted input.
- [x] Check the bot challenge on the backend, honeypot, and modest rate limits before expensive upload work. Browser-only validation or disabling a button is not server protection. Keep the mechanism small and document its limits.
- [x] Save only pending reviews. Do not accept client-selected publication states, arbitrary storage paths, or edits to existing reviews.
- [x] Make submission success conditional on a complete saved review and required photos. Handle partial failures and clean up created files where possible; do not build a new cleanup service.
- [x] Prevent accidental repeated clicks, preserve form contents on failure while the page stays open, and offer a useful retry message. Do not claim a failed submission will be queued for later.
- [x] Show a submission reference and Discord `_gemini` correction/contact instructions after success. No email notifications or editing links.

## Completion checks

- [x] Each of Facebook, Instagram, WhatsApp, regular phone number, and email can submit without account creation or automatic identity verification. All five backend paths and the matching UI labels passed automated checks.
- [x] A complete review with public-photo choice on or off saves privately with four valid ratings. Two hosted synthetic fixtures confirm both choices.
- [x] Missing ratings/images, invalid vendor IDs, malformed/oversized images, failed bot checks, and excessive attempts are rejected by the backend. Unit tests, hosted validation checks, and persistent-limit SQL checks passed.
- [x] Network/storage failures show no false success and retain the form while open. Simulated lost final replies and ambiguous storage/database writes passed; no database row is created until required uploaded objects exist.
- [x] Anonymous callers cannot retrieve the pending review, contact details, or known pending photo, or call the rate-limit RPC. Direct anonymous raw-table writes remain denied; original private storage policies are unchanged.
- [x] Mobile layout/keyboard and HEIC preparation passed in Chromium at 390×844 with no horizontal overflow and no pre-submit uploads. Phase 1's phone-photo path was accepted by the owner. The complete Phase 2 form has not yet received a separate physical-device/user acceptance test; retain that for the prelaunch pilot check.

## Handoff to Phase 3

### Implementation and deployed state

- Form: `src/reviews/review-form.js`, compiled to `assets/reviews/review-form.js`, styles in `assets/reviews/review-form.css`. Cards render a Write a review button that stays hidden unless public configuration explicitly enables submissions. Existing directory filters/sorting still work without that configuration.
- Browser workflow/retry logic: `src/reviews/submission-client.js`. Shared form/backend validation: `supabase/functions/_shared/review-policy.js`. The Phase 1 photo processor is reused without changing its accepted input formats.
- Hosted project: `viiltjxyojhlswtieexc`. Edge Function: **review-submit**, deployed version **4**. Source: `supabase/functions/review-submit/`. Runtime imports are pinned in `deno.json` to Supabase JS 2.118.0 and jpeg-js 0.4.4.
- Applied migration: **20261027234232_submission_rate_limits** (local filename aligned with the hosted migration version). Adds one small internal counter table in `private`, plus a service-role-only RPC. The only application/review table is still `public.reviews`; no reviewer/order/history tables were added.
- No GitHub Pages deployment or Phase 3 moderation interface was created. There are two pending test records, two associated private photos, and zero published reviews. The old phone-preview tunnel was stopped.

### API and upload protocol

All four actions use POST at `https://viiltjxyojhlswtieexc.supabase.co/functions/v1/review-submit?action=...`. Responses do not return contact details or photo URLs.

1. **start** accepts JSON `{ review, photos: [{ size, sha256 }], challenge }`. The review uses Phase 1's field names, plus `confirmed: true` and an empty `website` honeypot. Unknown/privileged fields are rejected. Valid vendor IDs are generated from the CSV by `scripts/build-reviews.mjs`; regenerate/redeploy if listings change.
2. After metadata validation, backend bot verification, and rate limiting, start generates a review UUID, opaque photo paths, and a signed 30-minute upload permit. It creates no review row or stored photo. The permit contains the supplied form data; keep it in memory/headers, never a URL or log.
3. **photo** takes JPEG bytes with `x-upload-permit` and zero-based `x-photo-index` headers. It checks the signed manifest's exact size/hash, decodes the image to reject corrupt content, caps dimensions to 2560 pixels/side and 7 MP, removes JPEG application/comment metadata and trailing data, then saves privately. One photo per request keeps processing within the Edge Function's CPU/memory limits.
4. **finish** takes the permit, verifies all expected stored objects exist, and inserts only a pending review. Response: `{ reference: <UUID>, status: 'pending' }`. Repeated finish requests return the same reference; a lost reply must not create a new review.
5. **cancel** cleans partial objects only if a review has not committed. If already saved, it returns that reference and leaves its files alone. Expired signed permits can still recover an existing reference or clean partial files; they cannot authorize new uploads or finalization of an expired attempt.

The browser preserves entered fields and processed photos after failure. It cleans partial uploads when feasible. If finish may have committed, it preserves the permit and retries the same reference. Closing the page or a prolonged outage can still leave unreferenced partial files; these can be removed manually through Storage. There is no background cleanup service or saved draft system.

### Private preview and production setup

- The deployed function is currently **closed to the public**: it requires `x-review-preview`, checked against a SHA-256 hash in the deployed server bundle, as well as the development bot check. The raw preview capability is only in ignored `.local/review-preview.json` and `public-config.js`. It grants submission only, never access to private records or moderation.
- `scripts/prepare-review-preview.mjs` prepares that local configuration and `.local/review-deployment-files.json`. It never prints credential values. The checked-in `deployment.js` has an empty preview hash and therefore fails closed if deployed directly with public mode disabled.
- `verify_jwt=false` is intentional: reviewers do not have Auth accounts. The function performs its own preview-capability / Turnstile / signed-permit checks. Do not replace those checks with a browser-only guard or an unrestricted anonymous storage/table policy.
- Current allowed origins default to localhost and 127.0.0.1 on port 8000. CORS is an additional browser constraint, not authentication. The server uses Supabase's injected secret keys, falling back to the injected legacy service-role key for compatibility; neither belongs in frontend configuration.
- Before the Phase 4 public pilot: configure a real Turnstile widget for the actual GitHub Pages hostname and backend `TURNSTILE_SECRET_KEY`, set exact `REVIEW_ALLOWED_ORIGINS`, and enable `REVIEW_PUBLIC_ENABLED=true`. Supply the public site key in frontend configuration and omit the preview capability from production. Public mode refuses development bot secrets. No paid plan is required by this configuration.
- Production bot credentials/hostname setup remains outstanding by design; do not publicly enable submissions before it and moderation are ready. A sample backend template is in `supabase/functions/.env.example`. [Turnstile setup](https://developers.cloudflare.com/turnstile/get-started/), [Supabase function secrets](https://supabase.com/docs/guides/functions/secrets).

### Basic protection and limits

- Form limits match database constraints; each contact method receives only basic format checks. Four whole-number ratings are mandatory. JPEG, HEIC/HEIF, PNG, and WebP inputs become JPEG locally; the backend independently decodes/validates that JPEG.
- Bot checks are sent server-side to Cloudflare with a timeout, with production hostname/action checks. Preview uses documented test keys; it is not production bot protection. The private preview capability prevents arbitrary public use of those test keys.
- Persistent counters allow 10 starts, 50 photo requests, 30 finish requests, and 20 cancels per source address per hour, keyed by action-specific HMAC hashes. Raw addresses are not stored. Extraction uses the first gateway `x-forwarded-for` entry as in Supabase's documented example. These are basic network limits, not identity tracking; shared networks can hit them and changing addresses can evade them.
- Counters expire after an hour and stale entries are removed during a subsequent counter call, without a scheduled task. The RPC is service-role-only. Security Advisor reports no policies on this private RLS-enabled table as informational: client access is intentionally denied, while the service role bypasses RLS. The existing Pro-only leaked-password warning also remains. [Rate-limit/private API guidance](https://supabase.com/docs/guides/api/securing-your-api), [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

### Verification and fixtures for Phase 3

- **14 unit/integration tests passed:** missing/fractional ratings, injected privileged fields, all contact methods, both photo choices, bot failures, limits, tampered/expired permits, missing photos, corrupt JPEGs, metadata removal, cleanup, ambiguous writes, and idempotent retry. Run `npm test`.
- **Browser flow passed:** Chromium 156.0.8078.4, 390×844 viewport, required fields/ratings, five contact labels, keyboard tab order, HEIC processing with no upload on selection, public preview without private contact data, and a simulated lost successful finish reply followed by retry. Exactly one review was saved in the isolated test store. The browser test mocks the widget and backend store; hosted tests below exercise real Supabase separately. Run `npm run test:reviews:browser`.
- **Hosted tests passed:** private capability required, invalid fields/challenge/photos rejected, both photo choices persisted as pending, persistent rate limit reached, and no public raw-table/photo/RPC access. Run `scripts/test-submission-hosted.mjs` carefully: it creates synthetic fixtures unless `--reuse-fixtures` is supplied, and exercising the limit temporarily throttles that test source.
- **Hosted image boundary passed:** a detailed 2560×2560 synthetic JPEG of 10,342,927 bytes was decoded/validated/saved with HTTP 200, about 4.2 seconds including network/Storage. Its upload was cancelled and removed, with no review record created. This is not a guarantee about every codec/device; the endpoint returns a failure rather than false success if runtime limits are exceeded.
- **Database checks passed:** the counter RPC permits attempts 1–10 and denies attempt 11, and denies anonymous invocation. Original foundation constraint/RLS checks remain applicable. Test SQL lives under `supabase/tests/` and rolls back.
- Images, browser metrics, and test results are under ignored `test-results/reviews/`, `test-results/submission-hosted.json`, and `test-results/submission-image-limit.json`.
- Retained hosted fixtures, both for vendor ID 1: `529330d7-5b09-44f7-9086-53bd8e26ca0c` (public-after-approval photos) and `b6964c1f-05c2-46c0-a2b6-edbde610eb89` (private photos). Display names begin **Phase 2 test**; contact is `phase2@example.invalid`; their experience text explicitly identifies synthetic test data. No real person or purchase is represented. Delete these through Phase 3 after lifecycle testing.

### Next-phase boundaries

Phase 3 builds owner login, private lists, and moderation actions against the existing records/storage. Preserve the exact-owner checks, pending/published states, photo choice, and backend preview gate. Deleting a review must delete actual Storage objects too. Phase 4 handles public review views, averages, production bot setup, and the final physical-device/pilot acceptance check. Do not create public read responses or a moderation UI as part of this completed phase.

Checkpoint: form/preview work can be finished separately from backend integration. This phase does not expose a public submission feature before moderation is ready.

## Execution prompt

> Execute Phase 2 in docs/review-phases/phase-2-submission.md after checking Phase 1's handoff. Implement only the submission flow and its protection/error handling, run the completion checks, and update phase status/handoff and the work-plan index. Do not add reviewer accounts, launch publicly, or start Phase 3.

## Progress / next step

Phase 2 implemented and verified in private development mode. Proceed with Phase 3 in a separately authorized work session. No public review feature deployment or email-monitor activation occurred.
