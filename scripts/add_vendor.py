#!/usr/bin/env python3
"""Add a Buhurt vendor to vendors.csv from a Facebook URL."""

import argparse
import csv
import re
import sys
from datetime import date
from pathlib import Path
from urllib.error import URLError
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "vendors.csv"

FIELDS = [
    "id",
    "name",
    "facebook_url",
    "facebook_type",
    "website_url",
    "instagram_url",
    "category",
    "location",
    "notes",
    "status",
    "date_added",
]

BLOCKED_WEBSITE_HOSTS = {
    "facebook.com",
    "fb.com",
    "fb.me",
    "instagram.com",
    "whatsapp.com",
    "messenger.com",
    "meta.com",
}


def normalize_facebook_url(url: str) -> str:
    url = url.strip()
    if not url:
        raise ValueError("URL cannot be empty.")

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    host = parsed.netloc.lower().removeprefix("www.")
    if host not in {"facebook.com", "fb.com", "m.facebook.com"}:
        raise ValueError("URL must be a Facebook link (facebook.com).")

    path = parsed.path.rstrip("/") or "/"
    strip_suffixes = ("/photos", "/about", "/videos", "/reviews", "/events", "/mentions")
    for suffix in strip_suffixes:
        if path.lower().endswith(suffix):
            path = path[: -len(suffix)] or "/"
            break
    normalized = f"https://www.facebook.com{path}"
    if parsed.query:
        normalized += f"?{parsed.query}"
    return normalized


def detect_facebook_type(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.lower()
    query = parse_qs(parsed.query)

    if "/groups/" in path:
        return "group"
    if "/pages/" in path:
        return "page"
    if path.endswith("/profile.php") and "id" in query:
        return "profile"
    if "/people/" in path:
        return "profile"

    vanity = parsed.path.strip("/")
    if vanity and "/" not in vanity and "." in vanity:
        parts = vanity.split(".")
        if len(parts) >= 3 and parts[-1].isdigit():
            return "profile"

    return "page"


def slug_from_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.strip("/")
    if not path:
        return ""

    if path.startswith("groups/") and "/user/" in path:
        return ""
    if path.startswith("groups/"):
        slug = path.split("/", 2)[-1]
    elif path.startswith("pages/"):
        parts = path.split("/")
        slug = parts[-1] if len(parts) >= 3 else parts[-1]
    elif path == "profile.php":
        slug = parse_qs(parsed.query).get("id", [""])[0]
    else:
        slug = path.split("/")[0]

    slug = re.sub(r"[-_.]+", " ", slug)
    slug = re.sub(r"\s+", " ", slug).strip()

    if not slug or slug.isdigit():
        return ""

    parts = slug.split()
    if len(parts) > 1 and parts[-1].isdigit():
        parts = parts[:-1]

    return " ".join(part.title() for part in parts)


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def fetch_page_html(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=10) as response:
            return response.read().decode("utf-8", errors="replace")
    except (URLError, TimeoutError, ValueError):
        return ""


def fetch_page_title(url: str) -> str:
    html = fetch_page_html(url)
    if not html:
        return ""

    for pattern in (
        r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']',
        r"<title[^>]*>([^<]+)</title>",
    ):
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            title = match.group(1).strip()
            title = re.sub(r"\s*[-|]\s*Facebook$", "", title, flags=re.IGNORECASE)
            if title and not is_generic_facebook_title(title):
                return title
    return ""


def is_generic_facebook_title(title: str) -> bool:
    normalized = title.strip().lower()
    generic_titles = {
        "facebook",
        "error",
        "log in to facebook",
        "log into facebook",
    }
    return normalized in generic_titles or normalized.startswith("log in")


def is_blocked_host(host: str) -> bool:
    host = host.lower().removeprefix("www.")
    return any(host == blocked or host.endswith(f".{blocked}") for blocked in BLOCKED_WEBSITE_HOSTS)


def normalize_website_url(url: str) -> str:
    url = url.strip()
    if not url:
        return ""

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    if not parsed.netloc or is_blocked_host(parsed.netloc):
        raise ValueError(f"Not a valid external website URL: {url}")

    return f"{parsed.scheme}://{parsed.netloc.lower()}{parsed.path.rstrip('/')}"


def normalize_instagram_url(url: str) -> str:
    url = url.strip()
    if not url:
        return ""

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    host = parsed.netloc.lower().removeprefix("www.")
    if host not in {"instagram.com"}:
        raise ValueError("URL must be an Instagram link (instagram.com).")

    path = parsed.path.rstrip("/") or "/"
    return f"https://www.instagram.com{path}/"


def candidate_urls_from_html(html: str) -> list[str]:
    candidates: list[str] = []

    for encoded in re.findall(r"l\.facebook\.com/l\.php\?u=([^&\"\\]+)", html, re.IGNORECASE):
        decoded = unquote(encoded)
        if decoded.startswith(("http://", "https://")):
            candidates.append(decoded)

    for match in re.finditer(
        r'"(?:website|external_url|link_url|url)":"(https?:\\/\\/[^"\\]+)"',
        html,
        re.IGNORECASE,
    ):
        candidates.append(match.group(1).replace("\\/", "/"))

    for match in re.finditer(r'href="(https?:\/\/[^"]+)"', html, re.IGNORECASE):
        candidates.append(match.group(1).replace("\\/", "/"))

    return candidates


def pick_website_url(candidates: list[str]) -> str:
    for candidate in candidates:
        try:
            return normalize_website_url(candidate)
        except ValueError:
            continue
    return ""


def about_urls(facebook_url: str, facebook_type: str) -> list[str]:
    if facebook_type == "profile":
        return [facebook_url]

    about = f"{facebook_url}/about"
    return [about, facebook_url]


def resolve_website(facebook_url: str, facebook_type: str) -> str:
    for url in about_urls(facebook_url, facebook_type):
        html = fetch_page_html(url)
        if not html:
            continue
        website = pick_website_url(candidate_urls_from_html(html))
        if website:
            return website
    return ""


def read_vendors() -> list[dict]:
    if not CSV_PATH.exists():
        return []

    with CSV_PATH.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def next_id(vendors: list[dict]) -> str:
    numeric_ids = [int(row["id"]) for row in vendors if row.get("id", "").isdigit()]
    return str(max(numeric_ids, default=0) + 1)


def resolve_name_and_location(url: str) -> tuple[str, str]:
    title = fetch_page_title(url)
    if title:
        if " | " in title:
            name, location = title.split(" | ", 1)
            return name.strip(), location.strip()
        return title, ""
    return slug_from_url(url), ""


def resolve_name(url: str) -> str:
    name, _ = resolve_name_and_location(url)
    return name


def confirm_profile_add() -> bool:
    prompt = (
        "Looks like a personal profile — use group/business page if available. "
        "Add anyway? [y/N]: "
    )
    answer = input(prompt).strip().lower()
    return answer in {"y", "yes"}


def add_vendor(
    url: str,
    force: bool = False,
    website_url: str = "",
    instagram_url: str = "",
    name: str = "",
    category: str = "",
    location: str = "",
) -> dict:
    normalized = normalize_facebook_url(url)
    facebook_type = detect_facebook_type(normalized)
    vendors = read_vendors()

    if any(row.get("facebook_url") == normalized for row in vendors):
        raise ValueError(f"Vendor already exists: {normalized}")

    if facebook_type == "profile" and not force:
        if not confirm_profile_add():
            raise SystemExit("Cancelled.")

    resolved_name, resolved_location = resolve_name_and_location(normalized)
    if name:
        resolved_name = name.strip()
    if location:
        resolved_location = location.strip()
    if website_url:
        website = normalize_website_url(website_url)
    else:
        website = resolve_website(normalized, facebook_type)
    instagram = normalize_instagram_url(instagram_url) if instagram_url else ""

    status = "verified" if resolved_name else "new"
    row = {
        "id": next_id(vendors),
        "name": resolved_name,
        "facebook_url": normalized,
        "facebook_type": facebook_type,
        "website_url": website,
        "instagram_url": instagram,
        "category": category.strip(),
        "location": resolved_location,
        "notes": "",
        "status": status,
        "date_added": date.today().isoformat(),
    }

    write_header = not CSV_PATH.exists() or CSV_PATH.stat().st_size == 0
    with CSV_PATH.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        if write_header:
            writer.writeheader()
        writer.writerow(row)

    return row


def main() -> None:
    parser = argparse.ArgumentParser(description="Add a Buhurt vendor from a Facebook URL.")
    parser.add_argument("facebook_url", help="Facebook group, page, or profile URL")
    parser.add_argument(
        "--website",
        help="Vendor website from Facebook About > Links (optional; auto-detected when possible)",
    )
    parser.add_argument("--instagram", help="Instagram profile URL")
    parser.add_argument("--location", help="Country, state, or region")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip personal-profile warning",
    )
    parser.add_argument("--name", help="Vendor name (overrides auto-detected name)")
    parser.add_argument(
        "--category",
        help="Category or comma-separated categories (e.g. shields,soft_kit,boots)",
    )
    args = parser.parse_args()

    try:
        row = add_vendor(
            args.facebook_url,
            force=args.force,
            website_url=args.website or "",
            instagram_url=args.instagram or "",
            name=args.name or "",
            category=args.category or "",
            location=args.location or "",
        )
    except ValueError as error:
        print(f"Error: {error}")
        raise SystemExit(1) from error

    name_display = row["name"] or "(no name yet)"
    extras = []
    if row["website_url"]:
        extras.append(f"website: {row['website_url']}")
    if row["instagram_url"]:
        extras.append(f"instagram: {row['instagram_url']}")
    if row["location"]:
        extras.append(f"location: {row['location']}")
    extras_display = f", {', '.join(extras)}" if extras else ""
    print(
        f"Added: {name_display} ({row['facebook_type']}, {row['status']}{extras_display}) - review in viewer"
    )


if __name__ == "__main__":
    main()
