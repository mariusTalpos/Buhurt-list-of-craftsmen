# Phase 3: Owner moderation

Status: **Complete for private development use.** Verified October 27, 2026 (final hosted checks October 28 UTC). Depends on [Phase 2](phase-2-submission.md). No public website release occurred.

## Objective

Give the owner a small private interface to manage submissions without using the database editor.

Read [the specification](../reviews-spec.md), [the work-plan index](../reviews-work-plan.md), and the previous phase handoffs. Reuse the owner identity and backend access rules established in Phase 1.

## Prerequisites

- A working submission flow and at least one synthetic pending review with photos.
- Owner login provisioned and hosted backend deployment access available.
- The public review UI is not required yet; publication can be checked through authenticated/backend tests.

## Tasks

- [x] Build the owner login/logout flow and a moderation page with pending/published lists. No signup flow or reviewer accounts.
- [x] Show review text, ratings, photo choice, photos, private contact details, and optional owner note. Keep private data out of public responses and caches.
- [x] Implement Approve to publish a complete pending review. Validate the required fields/photos and all four ratings before publication.
- [x] Implement Edit in place for corrections agreed with the reviewer. Allow private owner notes. Do not create revisions, action history, or per-order tracking.
- [x] Implement Unpublish to return a review to pending and withdraw public access to its photos. Keep the stored review available to the owner.
- [x] Implement Delete with a confirmation, removing the review and its stored files. Handle partial storage/database failures honestly and make retry possible.
- [x] Permit the owner to omit an unsuitable photo from publication without publishing photos the reviewer marked private. Preserve the one submission-level privacy choice.
- [x] Enforce the exact owner account on every private read/action, including direct API calls. A hidden page or any authenticated Supabase session is not sufficient authorization.
- [x] Show clear success/error states. Do not add required action reasons, rejection archives, email messages, or special clarification statuses; clarification stays pending.

## Completion checks

- [x] The owner can sign in, inspect a submission, approve it, edit it, unpublish it, delete it, and sign out. Actual owner sign-in and hosted lifecycle verified in the browser; the owner entered the password personally.
- [x] Anonymous and non-owner callers cannot read private details or perform any action, including by calling endpoints directly. Hosted anonymous/forged-token checks, database role simulation, and handler authorization tests passed; no extra Auth account was created just for testing.
- [x] In-place edits retain the same review ID and one score contribution; missing/invalid ratings cannot be saved. Tests reject missing, fractional, string, and out-of-range ratings; stale edits return 409. Public statistics remain Phase 4 work.
- [x] Public-photo permission is respected. Hosted tests verified approved/shared retrieval, omission, private photos remaining private after approval, and withdrawal on unpublish/delete. Every new request rechecks current state and returns no-store responses without signed URLs.
- [x] Deletion removes associated stored files; failed operations display an error and can be retried without corrupting another review. Both hosted fixtures and their actual files were deleted; isolated tests cover storage/DB failures and lost replies.
- [x] The moderation page is usable at phone and desktop sizes and by keyboard. Chromium tests at 390×844 and 1280×900 passed with no horizontal overflow; screenshots were inspected. A separate physical-phone moderation acceptance test remains in the Phase 4 pilot, not claimed here.

## Handoff to Phase 4

### Pages, configuration, and deployment

- Owner page: `moderation.html`, locally at **http://localhost:8000/moderation.html**. Source: `src/reviews/moderation.js`; generated bundle/styles: `assets/reviews/moderation.js` and `moderation.css`. The existing directory has no public admin link. Start the allowlisted local server with `npm run dev:photos`; it now serves this page as well. The local preview server was left running for owner testing; no tunnel was started.
- Use the Phase 1 moderator email/password, separate from the dashboard's ChatGPT sign-in. There is no signup screen. Supabase sessions remain in memory (`persistSession: false`); reload requires sign-in. Password fields are cleared on submission, and sign-out clears review DOM/photo object URLs. Contact details/notes never enter localStorage or public responses.
- The page needs the Supabase URL/publishable key in ignored `public-config.js`; it does not need submissionEnabled or a bot widget. `npm run build:reviews` builds both browser features and regenerates allowed vendor IDs. No frontend configuration should contain a server secret.
- Project `viiltjxyojhlswtieexc` remains on Free and active. **review-moderate version 3** is deployed; **review-submit version 4** is unchanged. The new function has `verify_jwt=false` because it authenticates private routes itself and has a separately gated photo-preview route. Every private route verifies the bearer token through Auth `getUser`, then checks `review_owner_access()` against the same exact UUID binding used by RLS. Caller-scoped DB/Storage requests retain those RLS policies as a second check.
- Applied migration: **20261028001712_review_moderation**. Adds only `excluded_photo_paths` to the existing review record and an authenticated-only, security-invoker boolean owner-access RPC with an empty search path. Exclusions must be a subset of that review's original paths. No new table, state, history, account, retention job, or monitor was added.
- `npm run preview:reviews` also writes ignored `.local/moderation-deployment-files.json`, with the existing preview capability's hash substituted into the server bundle. Deploy those packaged files with entrypoint `supabase/functions/review-moderate/index.ts` and import map `supabase/functions/review-moderate/deno.json`. The checked-in empty hash fails closed when public mode is disabled; never print or publish the raw local preview capability.

### Endpoint contracts

Base URL: `https://viiltjxyojhlswtieexc.supabase.co/functions/v1/review-moderate?action=...`. Private calls send the browser-safe `apikey` and **Authorization: Bearer <owner access token>**. Do not put tokens or private form data in URLs. CORS defaults to localhost/127.0.0.1:8000; production uses the existing exact `REVIEW_ALLOWED_ORIGINS` setting.

| Action | Method / input | Result |
|---|---|---|
| list | GET, `status=pending` or `published` | `{reviews}` containing queue summaries |
| get | GET, `id` | `{review}` with all owner-only fields |
| photo | GET, `id`, zero-based `index` | Owner-only image bytes; no signed URL |
| edit | POST, `{id, expected_updated_at, changes}` | `{review}` updated in place |
| approve | POST, `{id, expected_updated_at}` | `{review}` published after full validation and checking actual stored photos |
| unpublish | POST, `{id, expected_updated_at}` | `{review}` returned to pending |
| delete | POST, `{id, expected_updated_at, confirm:true}` | `{deleted:true}` only after file/record removal is confirmed |
| public-photo | GET, `id`, zero-based `index` | Image bytes only when currently published, permitted by reviewer, and included by owner; otherwise 404 |

`changes` includes display_name, product_service, experience, all four numeric ratings, contact_name, contact_method, contact_details, owner_note, and excluded_photo_paths. It cannot change ID/vendor, workflow state, timestamps, original photo paths, or the reviewer's photos_public choice. All editable review fields/ratings are required; notes may be empty. Pass the exact `updated_at` string from the last read (preserve timestamp precision). Stale changes return 409 rather than overwrite another change. The page disables Approve until unsaved edits are saved.

The private endpoint returns contacts and notes only after owner authorization. The public-photo lookup explicitly selects only ID/state/photo-permission fields; it never returns a whole review. Successful and failed endpoint responses use `Cache-Control: no-store, private, max-age=0` and vary by Origin/Authorization/preview header.

### Photo access and deletion

- The bucket remains private. Public-photo delivery is implemented here only as the hook needed to verify moderation withdrawal. It is **closed to general public use**, requiring the existing `x-review-preview` capability while `REVIEW_PUBLIC_ENABLED` is false. No public review list, statistics API, or public frontend was added.
- Delivery checks `status='published'`, `photos_public=true`, and that the requested original photo is not in `excluded_photo_paths` on every request. It streams bytes with no-store headers, never a reusable signed Storage URL or redirect. Owner access can still view excluded/private originals. Previously downloaded bytes cannot be recalled; unpublish/exclusion/delete prevent new retrieval.
- An owner omission retains the original private file for reference. Private-photo consent has no override in the edit API. A review can be approved with all photos omitted publicly, while retaining its required private evidence.
- Delete first unpublishes, removes the review's own Storage directory files, confirms none remain, and then removes its row. This is a small retryable sequence, **not an atomic database/Storage transaction**. On cleanup failure, the row stays pending so the owner can reload/retry Delete. If files were removed but the DB response failed, the error says so; repeated deletion of an already-absent record succeeds. Approval rejects a row whose required files are missing. No rejection archive or extra deletion state is used.
- Updates/deletion use the row timestamp to detect stale edits. This is a one-owner tool; avoid doing conflicting actions to the same review in multiple tabs. No distributed job or lock service was introduced.

### Verification, fixtures, and remaining work

- `npm test`: **20 tests passed**, including six moderation tests covering exact authorization gating, complete ratings, same-ID edits, stale changes, photo permissions/exclusion, missing evidence, partial deletion failures, lost replies, and safe retry. Authorization tests include malformed JSON shapes and forged/non-owner callers.
- `npm run test:moderation:browser`: passed in Chromium **156.0.8078.4**, phone/desktop viewports, sign-in/out, private details, escaped hostile text, save failure/retry, photo omission, approve/unpublish/delete, private-photo display, native keyboard focus, no overflow, and no persisted Auth session. It uses an isolated store/Auth stub; hosted checks below are separate.
- Actual owner sign-in succeeded and displayed two pending reviews (owner confirmed). The live UI then read private details/photos, edited the same row, approved both privacy choices, omitted/restored a shared photo, unpublished, deleted both fixtures after owner confirmation, and signed out. Backend SQL confirmed **0 review rows / 0 published rows / 0 Storage photos** afterward.
- `npm run check:moderation:hosted`: **17 checks passed per run** against the actual function: anonymous and forged-token access denied for all seven private actions, ungated public-photo request denied, private photo denied, shared photo allowed only while published/included and denied after omission/unpublish/deletion. `--expect-shared` checks the allowed state. New fixtures can be supplied with `--shared-id=<UUID>` and `--private-id=<UUID>`.
- `supabase/tests/moderation.sql`, `foundation.sql`, and `submission-limits.sql` passed against hosted Postgres and rolled back. Owner access succeeds; simulated authenticated non-owner access to records/photos/actions fails; anonymous helper invocation fails; cross-review exclusions fail. These are DB role simulations, not a newly created second login. Storage/DB fault injection was confined to the isolated tests, not the hosted service.
- Screenshots/results are ignored under `test-results/moderation/`; existing submission browser regression also passed. `git diff --check` passed. Existing work was preserved; no commit/push/static deployment occurred.
- Deleted hosted fixtures: `529330d7-5b09-44f7-9086-53bd8e26ca0c` and `b6964c1f-05c2-46c0-a2b6-edbde610eb89`, plus their two actual files. **No hosted synthetic fixtures are retained.** The Phase 2 fixture IDs are historical. Phase 4 should submit fresh labeled synthetic reviews; don't use Phase 2's `--reuse-fixtures` expecting these deleted records to exist.
- No Phase 3 blocker remains. Local Docker migration replay and a physical-phone moderation check were not performed; hosted migrations/SQL and browser checks provide the recorded verification. Phase 4 still owns production Turnstile/hostname settings, public review responses/averages, real deployment path/CORS checks, physical-phone/pilot acceptance, and launch authorization. The optional email monitor remains inactive.
- Security Advisor has no new application finding. Existing findings remain: intentionally client-denied private rate-limit table has no RLS policy ([explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)), and leaked-password protection is disabled on this Free project ([guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). No paid-plan/security setting change was made.

Checkpoint: login/read-only queue and mutation actions are separate stopping points if needed. Do not publish the frontend feature yet.

## Execution prompt

> Execute Phase 3 in docs/review-phases/phase-3-moderation.md after checking the preceding handoffs. Implement the owner-only moderation interface and actions, verify authorization and file handling, and update status/handoff and the work-plan index. Keep the two-state workflow and in-place edits. Do not start Phase 4 or launch publicly.

## Progress / next step

Phase 3 is complete and the queue is ready for private manual testing at the local moderator page. Both original hosted test reviews/photos were removed, and the owner was signed out after verification. Continue with Phase 4 only in a separately authorized session. Public submission/photo gates remain closed; no pilot launch or email automation occurred.
