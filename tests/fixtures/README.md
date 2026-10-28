# Optional upstream photo test fixtures

Run `node scripts/fetch-photo-fixtures.mjs` to download and verify the three samples used by `npm run test:photos`. Downloads are optional for ordinary unit tests. Binary fixtures and generated test outputs are ignored by Git; do not publish the photos as directory content.

- `libheif-example.heic`: the [libheif upstream example](https://github.com/strukturag/libheif/tree/master/examples). Tests decoder compatibility and image detail; it is not a new phone-camera capture.
- `phone.heic`: sample `0002.heic` used by the [heic-decode maintainer's tests](https://github.com/catdad-experiments/heic-decode/blob/master/scripts/images.js). Source device is not asserted. Also tested with a `.heif` filename and MIME type: this is the same HEIF container, not a different independently sourced HEIF subtype.
- `orientation-6.jpg`: [EXIF orientation example](https://github.com/recurser/exif-orientation-examples). Stored 1200×1800; must display 1800×1200 after EXIF orientation is applied.

SHA-256 digests and source URLs are pinned in the download script. Tests also encode valid PNG and WebP fixtures from the JPEG's pixels in the browser, verify their conversion, inspect output for EXIF/XMP removal, and reject corrupt files.

These fixtures do not verify a modern 12/48 MP phone capture, every HEIF codec/profile, physical-phone speed/memory, or the visual quality of real armor details. Those checks remain explicit Phase 1 acceptance items.
