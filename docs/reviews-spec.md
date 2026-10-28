# Community reviews: small first-release specification

Status: Implemented and deployed for the owner-authorized pilot. Production bot setup and live submission/moderation/photo acceptance passed on iPhone with Opera GX. All four work phases are complete; see the work plan for verification details and the intentionally retained example-vendor test.

## Goal and scale

Add reviews to the existing Buhurt craftsman directory for roughly 100 people, with one owner manually approving submissions. Visitors do not create accounts. The owner personally handles questionable submissions, repeat reviews, and requests for changes.

Build a form, photo storage, a small database, an owner-only moderation screen, and public reviews with average ratings. The public owner contact is Discord **_gemini**, all lowercase.

## Where the data lives

Keep the website on GitHub Pages and manually maintained listings in **vendors.csv**. Add an external hosted backend for reviews. GitHub Pages serves static HTML, CSS, and JavaScript; the browser's JavaScript can call that external backend. Pages itself does not host this database or submission service. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

| Part | Location and purpose |
|---|---|
| Website and vendor listings | GitHub Pages and vendors.csv, preserving existing cards, search, and filters |
| Review records | Hosted database: text, ratings, contact details, approval status, and photo references |
| Actual photos | Hosted file storage, separate from the database and Git repository |
| Submission/moderation API | Hosted backend that validates submissions and controls access |
| Owner screen | Small authenticated interface for approval and editing |

Each review stores the craftsman's existing CSV ID. Keep IDs stable and do not reuse them. The backend checks IDs against the listing data; a copy of the CSV can ship with the backend. There is no need to migrate listings into the database now. The CSV remains easy to maintain manually, while the database accepts submissions without requiring Git commits.

The owner has confirmed GitHub Pages is the current deployment. Older Caddy instructions in the repository are not the deployment assumption for this feature.

## Hosting decision

**Selected: GitHub Pages + Supabase.** Keep the existing frontend and vendor CSV on GitHub Pages. Use Supabase Postgres for reviews, Supabase Storage for photos, Edge Functions for the submission/public/moderation API where needed, and Supabase Auth for the owner only. No reviewer accounts and no server for the owner to administer. [Supabase Storage](https://supabase.com/docs/guides/storage), [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

| Option | Current pricing and capacity | Assessment |
|---|---|---|
| Supabase Free | $0; 500 MB database, 1 GB file storage, 5 GB egress plus 5 GB cached egress. Pauses after one week of inactivity. | Starting plan for the pilot. |
| Supabase Pro | Starts at $25/month. | An upgrade option, not a requirement merely because the site has reviews. |

Pricing checked October 27, 2026: [Supabase](https://supabase.com/pricing). Image processing may require separate capacity; this is not a guarantee that the entire implementation will be free. No paid upgrade is part of the current plan.

Photos and page views matter more to cost than review text. For illustration, 100 reviews with three processed photos averaging 1 MB each would use about 300 MB of image storage. Resize/compress photos while retaining useful product detail.

During the first implementation phase, verify HEIC/HEIF conversion with this setup. File storage does not itself guarantee conversion. Client-side conversion is acceptable if it works on target phones; otherwise assess a compatible server-side converter. Test this before building the rest of the upload flow; any additional paid service would be a separate decision.

## Review form

Open from a craftsman's card with that craftsman selected.

| Field | Requirement | Visibility after approval |
|---|---|---|
| Craftsman | Existing vendor ID | Public |
| Display name | Required; first name or community handle | Public |
| Contact name | Required; a name the owner can recognize | Owner only |
| Contact method | Required; exactly Facebook, Instagram, WhatsApp, regular phone number, or email | Owner only |
| Contact details | Facebook/Instagram profile link, WhatsApp/phone number with country code, or email address | Owner only |
| Product/service | Required; short description such as “steel gauntlets” | Public |
| Experience | Required; what went well or poorly. Suggested maximum: 5,000 characters. | Public |
| Category ratings | Required; whole-number 1–5 rating in every category | Public |
| Photos | Required; 1–5 images. Suggested limit: 10 MB per image. | Public by default; owner-only option available |

No required order numbers, order dates/status fields, reviewer profiles, community references, or relationship disclosures. There are no order records.

Contact helper text:

> Choose one way the moderator can reach you: Facebook, Instagram, WhatsApp, regular phone number, or email. These details stay private and will not appear on your review. If we cannot reach you, your review will not be approved.

Change the contact input label to match the selected method. Keep WhatsApp distinct from regular phone contact. Use basic format checks, without verification emails, SMS codes, social login, or automated identity checks. The owner decides whether the submission is credible. Discord is the owner's contact, not a sixth reviewer contact option.

Preview the public content and ask reviewers to confirm it is their own experience and they have permission to share the photos. Since all four ratings are required, the proposed eligibility rule remains a received item or completed service that the reviewer can assess. Negative experiences with late or defective products are welcome; do not ask reviewers to invent a quality rating for an undelivered item.

## Photos

**Default: publish photos with the approved review.** Include one visible, initially checked option: “Show my photos with my published review.” Unchecking it makes all photos in that submission owner-only. No per-image privacy settings are needed. The owner may omit a sensitive photo, but cannot publish photos marked private.

Support JPEG/JPG, HEIC/HEIF, PNG, and WebP from phone cameras or libraries without manual conversion. Generate browser-friendly JPEG or WebP copies, preserve orientation, remove location metadata, and retain product detail. Motion/Live Photos use the still image; video and RAW/ProRAW are out of scope. Show format/size errors without clearing the form.

Photo selection and previews stay in the browser until **Submit**. There are no server-side drafts or background uploads while someone fills in the form. On submission, save the review and photos privately. Report success only when both are saved. Failed submissions should remove files they created; residual files from interrupted uploads can be removed manually in the storage dashboard. No separate abandoned-upload system or scheduled cleanup service.

## Ratings and public display

All four categories are mandatory. No default selections or “Cannot assess” option. Higher is better.

| Category | Meaning |
|---|---|
| Quality | Workmanship, fit, finish, and whether the received item/service met expectations |
| Value for money | Whether the price was worthwhile relative to quality and service, not simply how cheap it was |
| Responsiveness | How promptly the craftsman replied to messages |
| Production speed | How promptly work was produced relative to the agreed lead time; exclude shipping/customs delays |

Use labels from 1 = very poor to 5 = excellent, with 3 = satisfactory. Do not collect exact response times.

- Review score = sum of four ratings / 4.
- Craftsman overall score = average review score across published reviews.
- Category score = average of that category across the same published reviews.
- Show one review count; calculate with unrounded values and display one decimal place.

Review scores of 4.0 and 3.0 produce an overall score of 3.5. Pending/deleted reviews do not count. With no published reviews, show “No reviews yet,” not zero stars.

Cards show the overall average, four category averages, review count, and “Read reviews” / “Write a review” actions. The review view shows display name, product/service, experience, ratings, publication date, and photos permitted for publication. Keep existing directory sorting. Compute averages from published reviews when loading them; no statistics table or background aggregation service.

## Submission and moderation

1. A visitor fills out the form and presses Submit.
2. The backend validates it and checks bot protection, saves a pending review with its photos, and returns a confirmation/reference.
3. The owner opens the private queue and reads the review, contact information, and photos.
4. The owner approves, edits following contact with the reviewer, leaves it pending while asking questions, or deletes it.
5. Approval makes permitted content public and includes its ratings in the averages.

Use just two statuses: **pending** and **published**. Waiting for clarification is still pending. Rejection means deletion; there is no rejection archive. Unpublish returns a review to pending. Delete removes the review, its contact details, and associated photos. Pending photos must not be accessible publicly, even through direct URLs.

The owner screen needs pending/published lists and **Approve, Edit, Unpublish, Delete** actions. All require owner authentication. There are no visitor accounts, public edit endpoints, or public signups that grant moderator access.

Repeat reviews and suspected duplicates are handled manually. No automated one-review-per-order policy, identity matching, or order tracking. Editing updates the review in place; it does not create another vote or saved revision history. Substantive text/rating changes must reflect the reviewer's request or agreement. Confirm deletion in the owner screen to reduce accidental removal.

Keep normal created, updated, and published timestamps. **No moderation audit log, actor field, action-history table, or required reasons for each action.** An optional private note is sufficient for anything the owner wants to remember.

Display this in the footer, submission confirmation, and review view:

> Contact _gemini on Discord to correct or remove a review, or report a concern. Include the review link or submission reference.

Make the handle selectable/copyable. No Discord integration, report form, automatic notifications, email delivery service, or special edit links. The owner checks change requests against the original contact details/conversation as needed and makes changes personally.

## Minimal storage design

One application table, **reviews**, is enough:

- Review ID, vendor ID, status, and created/updated/published timestamps.
- Public display name, product/service, experience, and four required 1–5 ratings.
- Private contact name, method, and details; optional private owner note.
- A list of photo storage references and one **photos_public** choice.

Actual images live in file storage. Contact details belong to each submission; there is no separate reviewer/user record. Provider-managed owner authentication is separate.

Phase 2 also uses one small private internal counter table for request rate limits. It stores hashed network keys, counts, and expiry only; it does not add reviewer identities, order records, or moderation history.

Keep underlying review records and image storage private. The public API returns only published public fields and permitted photos, never contacts or notes. Never put service/owner credentials in the GitHub Pages frontend. These access rules remain necessary at this scale.

## Basic protection and upkeep

- Backend-validated bot challenge, a honeypot, and modest submission/upload rate limits. No duplicate-image analysis or fraud scoring.
- Server checks for vendor ID, all ratings, text length, image contents, and upload size. Display review text as plain text. Apply limits before expensive uploads.
- Owner-only access to private submissions and moderation. Visitors cannot set approval status or overwrite reviews.
- Manual deletion of spam/rejected reviews and their photos. Clarification requests stay pending until the owner acts. No automated retention schedules.
- No project-run backups, restore drills, or recovery tooling. Provider-managed features may exist, but the application does not require/manage them or promise recovery of deleted data.
- If the backend is unavailable, keep the directory working and show “Reviews temporarily unavailable.” Use the provider's dashboard for storage/service checks; no custom monitoring system.
- Optional later: a task-attached email monitor for Supabase inactivity warnings and recovery, described in the work plan. It is not active or required for launch; it does not add an application monitoring service.

## Checks before launch

1. Phone users can submit using each of the five contact methods, all four ratings, and supported images without an account.
2. Missing/invalid ratings and images give useful errors; representative HEIC/HEIF uploads convert and display correctly.
3. Pending reviews, contact details, notes, and private photos cannot be retrieved publicly. Photo publication follows the reviewer's choice.
4. Only the owner can approve, edit, unpublish, or delete. Changes update public content and averages.
5. No upload occurs before Submit; failed submissions do not report success. Deleting reviews removes associated stored photos.
6. Bot protection and rate limits work, the form works on phones and by keyboard, and the Discord handle is exactly **_gemini**.

## Implementation plan

Hosting is settled. Follow [the phased work plan](reviews-work-plan.md) for the small amount of owner setup, implementation checkpoints, and progress tracking. Review quotas, revision histories, audit records, retention schedules, and backups remain outside this scope.
