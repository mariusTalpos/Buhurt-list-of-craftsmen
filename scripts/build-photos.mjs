import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('assets/photos', { recursive: true });
await build({
  entryPoints: ['src/photos/process-photo.js', 'src/photos/photo-worker.js'],
  bundle: true, format: 'esm', outdir: 'assets/photos', platform: 'browser', target: ['es2022'],
  external: ['./heif-decoder.js'], minify: false,
});
await copyFile('node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs', 'assets/photos/heif-decoder.js');
await copyFile('node_modules/libheif-js/LICENSE', 'assets/photos/HEIF-LICENSE.txt');
console.log('Built local photo modules and pinned libheif WASM decoder.');
