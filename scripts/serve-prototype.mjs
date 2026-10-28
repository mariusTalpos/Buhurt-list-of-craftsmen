import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif', '.csv': 'text/csv' };
export function prototypeServer({ photosOnly = false, basePath = '' } = {}) {
  const photoPaths = new Set(['/prototypes/photos.html', '/prototypes/photos.js',
    '/assets/photos/process-photo.js', '/assets/photos/photo-worker.js',
    '/assets/photos/heif-decoder.js', '/assets/photos/HEIF-LICENSE.txt']);
  return createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (basePath) {
        if (!pathname.startsWith(basePath)) { response.writeHead(404).end(); return; }
        pathname = '/' + pathname.slice(basePath.length);
      }
      if (photosOnly && pathname === '/') { response.writeHead(302, { Location: '/prototypes/photos.html' }).end(); return; }
      if (photosOnly && !photoPaths.has(pathname)) { response.writeHead(404).end(); return; }
      // Explicit allowlist: never expose .local, .env, Git, or node_modules.
      if (!(pathname === '/' || pathname === '/index.html' || pathname === '/moderation.html' || pathname === '/vendors.csv' || pathname === '/public-config.js' || pathname === '/public-config.production.js' ||
          pathname.startsWith('/prototypes/') || pathname.startsWith('/assets/photos/') ||
          pathname.startsWith('/assets/reviews/') ||
          pathname.startsWith('/tests/fixtures/'))) { response.writeHead(404).end(); return; }
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(path);
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const photosOnly = process.argv.includes('--photos-only');
  const port = photosOnly ? 8001 : 8000;
  prototypeServer({ photosOnly }).listen(port, photosOnly ? '127.0.0.1' : '0.0.0.0', () => {
    console.log(`Photo prototype: http://localhost:${port}/prototypes/photos.html (${photosOnly ? 'photo assets only, bound to loopback' : 'LAN-accessible'}; local development only).`);
  });
}
