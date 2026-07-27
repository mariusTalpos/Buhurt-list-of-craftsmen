# Buhurt Vendor Directory

A lightweight directory of armor smiths, craftsmen, and other commission services for Buhurt fighters. Vendors are stored in a single CSV file, added via a paste-URL script, and browsed through a static HTML viewer.

## Quick start

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

Optional flags: `--name`, `--category`, `--instagram`, `--location`.
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
| `facebook_url` | Canonical business/catalog link |
| `facebook_type` | `group`, `page`, or `profile` (auto-detected) |
| `website_url` | External shop/site from Facebook About > Links (optional) |
| `instagram_url` | Instagram profile URL (optional) |
| `category` | e.g. steel, titanium, shields, weapons, leather, fabric, repairs, other |
| `location` | Country, state, or region |
| `notes` | Free text |
| `status` | `new`, `verified`, or `inactive` |
| `date_added` | ISO date |

**One link per vendor.** Use the group or business page where they post their catalog. If a vendor has both a personal profile and a group, store only the group URL.

## Categories

See [`categories.txt`](categories.txt) for the suggested list.

## Sharing publicly (GitHub Pages)

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
scripts/
  add_vendor.py      # paste-URL ingestion
categories.txt       # category reference
README.md
```
