// Private local preview capability; production never uses this credential.
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('.local', { recursive: true });
let preview;
try { preview = JSON.parse(await readFile('.local/review-preview.json', 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) throw new Error('Provide the browser-safe SUPABASE_PUBLISHABLE_KEY.');
  preview = { supabaseUrl: 'https://viiltjxyojhlswtieexc.supabase.co', supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    submissionEnabled: true, turnstileSiteKey: '1x00000000000000000000AA', previewToken: randomBytes(32).toString('base64url') };
  await writeFile('.local/review-preview.json', JSON.stringify(preview, null, 2));
}
preview.reviewsEnabled = true;
await writeFile('.local/review-preview.json', JSON.stringify(preview, null, 2));
await writeFile('public-config.js', `// Local preview configuration. Ignored by Git; do not publish.\nexport const reviewConfig = Object.freeze(${JSON.stringify(preview, null, 2)});\n`);
const paths = ['supabase/functions/review-submit/index.ts', 'supabase/functions/review-submit/handler.js',
  'supabase/functions/review-submit/deno.json', 'supabase/functions/review-submit/deployment.js',
  'supabase/functions/review-submit/vendors.js', 'supabase/functions/_shared/review-policy.js'];
const files = [];
for (const name of paths) {
  const content = name.endsWith('/deployment.js') ? `export const previewTokenHash = '${createHash('sha256').update(preview.previewToken).digest('hex')}';\n` : await readFile(name, 'utf8');
  files.push({ name, content });
}
await writeFile('.local/review-deployment-files.json', JSON.stringify(files));
const moderationPaths = ['supabase/functions/review-moderate/index.ts', 'supabase/functions/review-moderate/handler.js',
  'supabase/functions/review-moderate/deno.json', 'supabase/functions/_shared/review-policy.js',
  'supabase/functions/review-submit/vendors.js', 'supabase/functions/review-submit/deployment.js'];
const moderationFiles = [];
for (const name of moderationPaths) moderationFiles.push(name.endsWith('/deployment.js') ? files.find(file => file.name === name) : { name, content: await readFile(name, 'utf8') });
await writeFile('.local/moderation-deployment-files.json', JSON.stringify(moderationFiles));
const publicPaths = ['supabase/functions/review-public/index.ts', 'supabase/functions/review-public/handler.js',
  'supabase/functions/review-public/deno.json', 'supabase/functions/_shared/public-review-policy.js',
  'supabase/functions/review-submit/vendors.js', 'supabase/functions/review-submit/deployment.js'];
const publicFiles = [];
for (const name of publicPaths) publicFiles.push(name.endsWith('/deployment.js') ? files.find(file => file.name === name) : { name, content: await readFile(name, 'utf8') });
await writeFile('.local/public-review-deployment-files.json', JSON.stringify(publicFiles));
console.log('Prepared ignored preview configuration and server deployment bundle; no credential values printed.');
