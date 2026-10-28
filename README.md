# Buhurt Vendor Directory

A lightweight directory of armor smiths, craftsmen, and other commission services for Buhurt fighters. Vendors are stored in a single CSV file, added via a paste-URL script, and browsed through a static HTML viewer.

The reviews pilot is live at [the directory](https://mariustalpos.github.io/Buhurt-list-of-craftsmen/); owner login is at [moderation](https://mariustalpos.github.io/Buhurt-list-of-craftsmen/moderation.html). See the Phase 4 handoff for phone-acceptance status. Run `npm run check:live` for non-destructive production smoke checks.

## Feature specifications

- [Community reviews (draft)](docs/reviews-spec.md) — submission, ratings, moderation, private evidence, and first-release requirements.
- [Reviews work plan](docs/reviews-work-plan.md) — Supabase setup and four implementation phases.

### Phase 1 development tools

Install pinned tools with `npm ci`, then run:

```bash
npm run build:photos
npm test
npm run fixtures:photos
npm run test:photos
npm run dev:photos
```

The optional fixture command downloads public upstream test photos with pinned hashes. The local prototype is at `http://localhost:8000/prototypes/photos.html`; processing stays in the browser. The development server allows LAN access for photo testing and serves an allowlisted set of site/prototype/assets files. The existing static directory still works independently, including with the Python server below. The original Phase 1 milestone did not launch reviews; the pilot status is recorded above.

Hosted setup, database checks, remaining verification, and the Phase 2 interface are recorded in the [Phase 1 handoff](docs/review-phases/phase-1-foundation.md#handoff-to-phase-2).

### Phase 2 private submission testing

Run `npm run build:reviews` after changing the form or vendor CSV. This rebuilds the form assets and the backend's accepted vendor IDs. `npm test` checks validation and recovery behavior; `npm run test:reviews:browser` checks the mobile form and lost-response retry with an isolated test backend.

The [Phase 2 handoff](docs/review-phases/phase-2-submission.md#handoff-to-phase-3) documents the original hosted private preview, upload protocol, and fixtures. Local `public-config.js` and `.local/` preview credentials are ignored by Git. Without enabled configuration, review buttons remain hidden and the directory still works. For the deployed pilot, use the live site and real Turnstile check.

### Phase 3 owner moderation

Start the allowlisted development server with `npm run dev:photos` and open [the moderator page](http://localhost:8000/moderation.html). Use the moderator email/password created in Phase 1. This login is separate from the Supabase dashboard login. It has no signup flow, and only the bound owner account can use the queue. Reloading the page requires signing in again; the browser does not persist the session or review data.

Choose a pending/published review, inspect its private contact details and photos, and save any agreed corrections or owner note. All four ratings remain required. Save changes before approving. A public-photo checkbox can omit an image, but the reviewer's private-photo choice cannot be overridden. Unpublish returns a review to pending. Delete permanently removes the review and stored photos after confirmation; if cleanup fails, reload and retry Delete.

`npm run build:reviews` builds both submission and moderation assets. Run `npm test` and `npm run test:moderation:browser` for authorization, lifecycle, failure/retry, and mobile/keyboard checks. `npm run check:moderation:hosted` performs read-only checks with the ignored local preview configuration. The [Phase 3 handoff](docs/review-phases/phase-3-moderation.md#handoff-to-phase-4) records endpoint contracts and deployed state. The original synthetic hosted reviews were deleted during verification; the queue is empty. This phase did not deploy the static website or enable public submissions/photos.

## Quick start

### Phase 4 public-review preview and release preparation

The directory preview now shows published reviews, category/overall averages, counts, review links, and copyable Discord contact instructions. Run `npm run build:reviews`, `npm run preview:reviews`, and `npm run dev:photos`, then open http://localhost:8000/. The hosted queue is empty after synthetic test cleanup; submit and moderate a fresh test to populate the preview. Hosted public reads remain protected by the local preview capability.

Run `npm test`, `npm run test:public:browser`, and `npm run check:release` for development checks. The public browser test covers the complete flow under the GitHub Pages repository path with an isolated backend. Details, hosted checks, and final release steps are in the [Phase 4 handoff](docs/review-phases/phase-4-public-launch.md#handoff--execution-prompt).

GitHub Pages publishes **master**, root `/`, at https://mariustalpos.github.io/Buhurt-list-of-craftsmen/. Browser code falls back from ignored local `public-config.js` to safe checked-in `public-config.production.js`. The owner has authorized the pilot and production feature flags are enabled with the real Turnstile site key. Use `npm run check:launch` for the launch configuration check. Backend deployments are separate from a Git push. See the Phase 4 handoff for live verification and phone-acceptance status. Once the hosted backend is in public mode it uses the real bot secret; make real submissions at the HTTPS Pages site, rather than the local test-key preview.

### Browse the directory

From the project folder, start a local server:

```bash
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

### Add a vendor

Paste a Facebook group or business page URL (preferred over personal profiles):

```bash
python scripts/add_vendor.py "https://www.facebook.com/groups/some-vendor"
```

If the vendor lists a website under Facebook **About > Links**, the script tries to auto-detect it from the About page. You can also paste it manually:

```bash
python scripts/add_vendor.py "https://www.facebook.com/groups/some-vendor" --website "https://their-shop.com"
```

Optional flags: `--name`, `--category`, `--instagram`, `--location`, `--profile`.
The script will:

1. Normalize and dedupe the URL
2. Detect whether it is a group, page, or profile
3. Warn you if it looks like a personal profile
4. Try to fetch the page title, or derive a name from the URL
5. Try to extract a website link from the Facebook About page (best-effort; may fail without login)
6. Append a new row to `vendors.csv`

Use `--force` to skip the personal-profile warning:

```bash
python scripts/add_vendor.py "https://www.facebook.com/some.person" --force
```

After adding, enrich the entry in `vendors.csv` with `category`, `location`, `notes`, or `website_url` when you have time.

## Data schema

`vendors.csv` columns:

| Column | Description |
|--------|-------------|
| `id` | Auto-generated |
| `name` | Vendor name (auto-filled when possible) |
| `facebook_url` | Primary Facebook link — prefer group/catalog or business page |
| `facebook_type` | `group`, `page`, or `profile` (type of the primary URL) |
| `facebook_profile_url` | Optional personal profile for messaging (when they also have a group/catalog) |
| `website_url` | External shop/site from Facebook About > Links (optional) |
| `instagram_url` | Instagram profile URL (optional) |
| `category` | e.g. steel, titanium, shields, weapons, leather, fabric, repairs, other |
| `location` | Country, state, or region |
| `notes` | Free text |
| `status` | `new`, `verified`, or `inactive` |
| `date_added` | ISO date |

**One vendor, up to two Facebook links.** Prefer the group or business page as `facebook_url` (catalog). If they also have a personal profile for messaging, store it in `facebook_profile_url` — do not create a second row.

```bash
python scripts/add_vendor.py "https://www.facebook.com/groups/some-catalog" \
  --profile "https://www.facebook.com/profile.php?id=123" \
  --name "Workshop Name" --category steel
```

## Categories

See [`categories.txt`](categories.txt) for the suggested list.

## Deploy with DuckDNS + Caddy

Public URL: [https://facapprovedvendors.duckdns.org](https://facapprovedvendors.duckdns.org)

1. Keep DuckDNS updated: `bash scripts/duckdns-update.sh`
2. Put `caddy.exe` in this project folder (gitignored)
3. On your router, forward **TCP 80** and **TCP 443** to this PC
4. Allow those ports in Windows Firewall for Caddy
5. From this folder (Git Bash or PowerShell **as Administrator** so Caddy can bind 80/443):

```bash
./caddy.exe run
```

Caddy will serve the site and request an HTTPS certificate automatically once the ports are reachable from the internet.

## Sharing via GitHub Pages (alternative)

When you are ready to share the directory with the community:

1. Create a GitHub repository and push this project
2. In the repo settings, go to **Pages**
3. Set source to **Deploy from branch**, branch `main`, folder `/ (root)`
4. The viewer will be live at `https://<username>.github.io/<repo>/`

To suggest new vendors, contributors can open a pull request that only edits `vendors.csv`.

## Project structure

```
vendors.csv          # source of truth
index.html           # browse/filter UI
Caddyfile            # public HTTPS server config
scripts/
  add_vendor.py      # paste-URL ingestion
categories.txt       # category reference
README.md
```
