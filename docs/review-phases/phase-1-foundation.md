# Phase 1: Supabase foundation and phone photos

Status: Complete. Hosted and desktop checks passed on October 27, 2026; the owner confirmed the temporary HTTPS phone test looked good and accepted Phase 1 before authorizing Phase 2. Device/browser and numeric phone timings were not recorded.

## Objective

Prepare the small backend and prove phone-photo processing works. Finish with a tested foundation for submission work, not a publicly launched feature.

Read [the specification](../reviews-spec.md) and [the work-plan index](../reviews-work-plan.md). Keep GitHub Pages, vendors.csv, one reviews table, private file storage, and one moderator. Do not add reviewer accounts, order tracking, revision history, or audit logs.

## Prerequisites

- Inspect the repository instructions, current files, and uncommitted changes before editing.
- Inspect connected Supabase projects and organizations before creating anything. Reuse the intended project if it exists. If creation is needed, have the owner select the organization and use the agreed Free plan and a US East region.
- Obtain the owner's chosen moderator identity through the normal account setup flow. Do not put passwords or secret keys in chat or Git.
- A live project is needed for hosted verification, but local setup and photo work can begin without it.
- Read the current Supabase skill and relevant documentation before implementation; use supported CLI/MCP workflows and pinned dependencies.

## Tasks

- [x] Add the minimal Supabase configuration, public configuration example, and secret-file exclusions. Keep the existing site runnable without review configuration.
- [x] Define the reviews table: ID, stable vendor ID, pending/published status, public name/product/text, four required integer ratings from 1–5, private contact name/method/details, optional private note, photo references, public-photo choice, and timestamps.
- [x] Create private photo storage. Establish database/storage access rules that deny public access to raw review records and private files. Restrict owner access to the specific moderator account, not every authenticated user.
- [x] Provision the single owner account, disable public signups and anonymous sign-ins, and document how the owner signs in. Keep this distinct from the Supabase dashboard account.
- [x] Build a small local image-processing prototype for JPEG, HEIC/HEIF, PNG, and WebP. Start with browser conversion; test an alternative compatible with Supabase only if needed. Do not silently add a paid service.
- [x] Produce upright, browser-friendly images without location metadata. Desktop conversion/metadata checks passed and the owner accepted the phone preview. Physical-device model, timings, and memory measurements were not captured; this was qualitative acceptance, not a benchmark.
- [x] Save repeatable schema/setup files using the current Supabase workflow. Record what was actually applied to the hosted project; do not imply local files are deployed.
- [x] Document the interface expected by later phases: review field names, photo output format/limits, vendor validation source, owner authorization, and submission/public/admin endpoint responsibilities. Use this file's handoff section rather than a new architecture document unless necessary.

## Completion checks

- [x] A legitimate owner can access a private sample; anonymous and non-owner callers cannot retrieve it or change it. Tested with hosted database role/JWT-subject simulation; anonymous HTTP reads/inserts also return database permission denials. A real password-login/browser session and stored-file lifecycle will be exercised when the moderation/submission interfaces exist.
- [x] Database constraints reject missing, fractional, or out-of-range ratings and invalid statuses/contact-method values.
- [x] Real supported image samples convert with correct orientation and no location metadata in automated checks. The owner confirmed the phone test looked good. Test device/browser were not supplied; independently sourced HEIF variants beyond the tested HEIC container remain unverified.
- [x] Setup files and pinned dependencies are saved, no secrets are tracked, and the existing directory still renders. The initial schema was applied to the fresh hosted project. Full local Supabase reset/replay is unverified because Docker is not running; fresh-project owner binding requires that project's actual Auth user ID as described below.

Do not mark the phase complete while hosted permissions or required photo formats remain unverified. Complete independent local work and record any missing access/device checks.

## Handoff to Phase 2

### Hosted state

- Free project **buhurt-directory**, ID **viiltjxyojhlswtieexc**, region **us-east-1** (North Virginia), organization selected by the owner. API URL: `https://viiltjxyojhlswtieexc.supabase.co`.
- Applied migrations: `20261027231820_reviews_foundation` and `20261027232146_bind_review_owner`. Local files match the versions reported by hosted migration history. The CLI generated the initial files; filenames were aligned with MCP-assigned versions after application.
- One application table: `public.reviews`. Private bucket: **review-photos**, 10 MiB/object, processed JPEG/WebP only. No anonymous table grants or storage policies. Owner-only SELECT/INSERT/UPDATE/DELETE policies apply to the exact Auth UID returned by `private.review_owner_id()`.
- Owner account was created by the user in the dashboard and confirmed. Bound Auth UID: **debb0065-2b93-449e-b6f5-f60b65e1b1ca**. Use the chosen moderator email and password with Supabase email/password sign-in in Phase 3; the dashboard's ChatGPT login is separate. The password was never read or stored by the implementation.
- Public signup and anonymous Auth sign-in are disabled on the hosted project and in `supabase/config.toml`. Verified through the public Auth settings endpoint after saving in the dashboard.
- No Edge Functions, submission routes, public review responses, or moderation UI have been deployed. Hosted review count is zero; transactional SQL fixtures were rolled back.

### Files and repeatable setup

- `supabase/config.toml`: generated by pinned CLI 2.122.0, then configured for Postgres 17 and disabled signups. `public-config.example.js`: public URL/key shape only. Copy to ignored `public-config.js` when connecting later phases. Retrieve the publishable key through Supabase; never substitute a secret/service key.
- `supabase/migrations/20261027231820_reviews_foundation.sql`: baseline schema, constraints, trigger, fail-closed owner helper, private bucket, grants, and RLS. `supabase/setup/bind-owner.mjs <verified-auth-user-uuid>` generates the owner-binding SQL. The saved binding migration is specific to the current hosted owner.
- To provision a different fresh project, apply the baseline, create that project's owner Auth account, and generate/apply a new binding for its actual UUID. Do not blindly reuse this project's owner-binding migration for a different account. Auth settings are configured separately in the dashboard; the migration does not change hosted Auth configuration.
- `package.json` / `package-lock.json`: exact direct versions for libheif-js, esbuild, Playwright, and the Supabase CLI. Run `npm ci`, `npm run build:photos`, and `npm test`. Browser fixtures: `npm run fixtures:photos`, then `npm run test:photos` (requires Playwright's matching Chromium installation).
- `supabase/tests/foundation.sql`: rerunnable privileged database tests, fully rolled back. `scripts/check-public-access.mjs`: read-only/Auth-setting and denied-insert checks using `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; it creates no records.
- Docker is not running on this machine. `supabase migration list --local` could not connect to `127.0.0.1:54322`; no local full-stack replay is claimed. Hosted migrations and live SQL checks succeeded through the connected integration.

### Photo interface

- Source entry: `src/photos/process-photo.js`; built browser module: `assets/photos/process-photo.js`. Call `await processPhoto(file)` sequentially for up to five files. It returns `{ blob, width, height, sourceWidth, sourceHeight, format, durationMs }` or throws an understandable error. No upload occurs.
- Each photo uses a disposable module worker; HEIF loads the bundled, pinned libheif WASM decoder locally. Native formats use browser decoding. Canvas encoding returns JPEG quality 0.9, white background for transparency, no original EXIF/XMP, and a maximum 2560-pixel longest side, without upscaling.
- Input: 10 MiB/file, up to 60 MP and 12,000 pixels/side. Native dimensions are checked from file headers before decoding; HEIF dimensions are checked before allocating the RGBA buffer. One worker at a time limits retained memory; timeout is 90 seconds. The decoder can still require substantial memory for large HEIF inputs, so mobile limits remain provisional until a real device is checked.
- Preview: `npm run dev:photos` → `http://localhost:8000/prototypes/photos.html`. It is a development-only server with LAN access and an explicit path allowlist; it does not serve environment files, node_modules, or private configuration. The temporary server was stopped after testing; restart it for another phone test.
- Fixture sources/hashes and test limitations: `tests/fixtures/README.md` and `scripts/fetch-photo-fixtures.mjs`. Generated JPEGs, screenshot, and metrics are under ignored `test-results/photos/`.

### Contract for subsequent phases

- Field names: `vendor_id`, `display_name`, `product_service`, `experience`, `quality`, `value_for_money`, `responsiveness`, `production_speed`, `contact_name`, `contact_method`, `contact_details`, `photo_paths`, `photos_public`, `owner_note`, plus ID/status/timestamps. Contact values: `facebook`, `instagram`, `whatsapp`, `phone`, `email`. Ratings are stored as numeric values with strict integer/range constraints because Postgres integer casts can round fractional input.
- Submission API in Phase 2 must validate vendor IDs against `vendors.csv` (or its backend-shipped copy), verify protection/limits, generate a review UUID and opaque image filenames, and save a complete pending review only after its processed files exist. Paths use `<review-uuid>/<photo-uuid>.jpg` (or `.webp`). Do not grant anonymous raw-table/storage access to implement uploads.
- Public API in Phase 4 selects only published public fields. Never serialize contacts/notes. Deliver photos only while the review remains published and `photos_public` permits it; do not open the whole bucket or use long-lived public URLs that defeat withdrawal.
- Owner actions in Phase 3 authenticate the session and enforce the bound UID on every action. Edit in place; two states only. Delete must remove file objects via Storage as well as the review record. The database does not delete file bytes automatically.

### Verification and outstanding checks

- Hosted SQL passed: 24 missing/out-of-range/fractional/NaN/infinite-rating rejections; invalid status/contact/photo paths; owner read/update; non-owner read/write/delete denial; anonymous raw-table denial. Fixtures rolled back.
- Public HTTP checks passed: signup disabled, anonymous Auth disabled, raw review SELECT and INSERT denied with database code `42501` (HTTP 401 for anonymous requests).
- Three unit tests passed. Chromium **156.0.8078.4**, Windows desktop, 390×844 viewport: two HEIC samples, same-container `.heif` filename, EXIF-rotated JPEG, derived PNG/WebP, corrupt-file rejection, local-only processing, and existing directory rendering all passed. Re-encoded outputs contain no EXIF/XMP; HEIC outputs were about 428–455 KB and took about 150–209 ms in this run. These timings are not physical-phone measurements.
- Visual inspection of the converted landscape sample showed upright output with clear fine scene detail; real armor-detail quality is not yet verified.
- Security Advisor: no application-schema/RLS findings; one provider warning for leaked-password protection, which requires Pro. Keep Free as agreed. [Provider documentation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Performance Advisor only reports the new index as unused, expected for an empty project.
- **Resolved phone-access blocker:** the LAN address did not load on the phone. A restricted temporary HTTPS preview was provided instead; the owner said it looked good and explicitly authorized Phase 2, accepting Phase 1. No firewall settings changed. Quantitative phone performance/memory measurements and the precise device/browser were not captured. Local Docker replay is also still unverified; these limitations are preserved rather than implied to have passed.

Checkpoint: database/access setup and image processing are separate stopping points if the phase needs multiple sessions.

## Execution prompt

> Execute Phase 1 in docs/review-phases/phase-1-foundation.md. Inspect current repository and Supabase state first, preserve existing work, implement only this phase, verify its completion checks, and update its status and handoff plus the work-plan index. Record blockers accurately. Do not launch the public feature or start Phase 2.

## Progress / next step

Foundation implemented and hosted checks passed. A temporary HTTPS photo-only preview was prepared on October 27 after the phone could not reach the LAN address. It serves exactly the prototype and photo-processing assets, rejects uploads (HTTP 405), and denies directory/CSV, fixtures, source, configuration, and private files (HTTP 404). HEIC conversion through the HTTPS preview passed a desktop browser check with no photo upload.

The restricted local server is started with `node scripts/serve-prototype.mjs --photos-only` on loopback port 8001, then exposed using the official Cloudflare Quick Tunnel tool (downloaded to ignored `.cache/tools/`). This is a disposable development preview, not deployment of the review feature. The temporary hostname is sent in chat and lasts only while its processes run; stop those processes after the phone test. Do not expose the normal development server or reuse the preview as production hosting. [Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

The owner accepted the HTTPS phone test. The temporary tunnel and photo-only server were stopped at the beginning of Phase 2. Phase 1 is complete with the verification limits recorded above; continue with the Phase 2 handoff for the current implementation state.
