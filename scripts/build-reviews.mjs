import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
// IDs are the first CSV field. The current directory uses numeric IDs and no
// multiline fields; refuse unsupported changes rather than accepting invented IDs.
const csv = await readFile('vendors.csv', 'utf8');
const ids = csv.trim().split(/\r?\n/).slice(1).map((line) => {
  const match = /^(?:"(\d+)"|(\d+)),/.exec(line);
  if (!match) throw new Error('Vendor CSV ID format changed; update the backend vendor generator.');
  return match[1] ?? match[2];
});
if (new Set(ids).size !== ids.length) throw new Error('Duplicate vendor IDs');
await mkdir('supabase/functions/review-submit', { recursive: true });
await writeFile('supabase/functions/review-submit/vendors.js', `// Generated from vendors.csv; regenerate before deploying submissions.\nexport const vendorIds = ${JSON.stringify(ids)};\n`);
await mkdir('assets/reviews', { recursive: true });
await build({ entryPoints: ['src/reviews/review-form.js'], bundle: true, format: 'esm',
  outfile: 'assets/reviews/review-form.js', target: ['es2022'], external: ['../photos/process-photo.js'] });
await build({ entryPoints: ['src/reviews/moderation.js'], bundle: true, format: 'esm',
  outfile: 'assets/reviews/moderation.js', target: ['es2022'], minifyWhitespace: true });
await build({ entryPoints: ['src/reviews/public-reviews.js'], bundle: true, format: 'esm',
  outfile: 'assets/reviews/public-reviews.js', target: ['es2022'] });
console.log(`Built review form and ${ids.length} backend vendor references.`);
