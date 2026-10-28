import { PHOTO_LIMITS, validatePhotoSize } from './photo-policy.js';
export { PHOTO_LIMITS } from './photo-policy.js';

// Returns a newly encoded JPEG Blob and dimensions. It never uploads anything.
// One worker per image releases the HEIF decoder's WASM heap after processing.
export async function processPhoto(file) {
  validatePhotoSize(file.size);
  const input = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./photo-worker.js', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Photo processing timed out. Try a smaller copy of the photo.'));
    }, PHOTO_LIMITS.timeoutMs);
    worker.onerror = () => {
      cleanup();
      reject(new Error('This browser could not process the photo. Try a smaller photo or another supported browser.'));
    };
    worker.onmessage = ({ data }) => {
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.postMessage({ input }, [input]);
  });
}
