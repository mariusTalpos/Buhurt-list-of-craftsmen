// src/photos/photo-policy.js
var PHOTO_LIMITS = Object.freeze({
  maxFiles: 5,
  maxInputBytes: 10 * 1024 * 1024,
  maxPixels: 6e7,
  maxInputSide: 12e3,
  maxOutputSide: 2560,
  jpegQuality: 0.9,
  timeoutMs: 9e4
});
function validatePhotoSize(size) {
  if (!Number.isFinite(size) || size <= 0 || size > PHOTO_LIMITS.maxInputBytes) {
    throw new Error("Choose a photo no larger than 10 MB.");
  }
}

// src/photos/process-photo.js
async function processPhoto(file) {
  validatePhotoSize(file.size);
  const input = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./photo-worker.js", import.meta.url), { type: "module" });
    const cleanup = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Photo processing timed out. Try a smaller copy of the photo."));
    }, PHOTO_LIMITS.timeoutMs);
    worker.onerror = () => {
      cleanup();
      reject(new Error("This browser could not process the photo. Try a smaller photo or another supported browser."));
    };
    worker.onmessage = ({ data }) => {
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.postMessage({ input }, [input]);
  });
}
export {
  PHOTO_LIMITS,
  processPhoto
};
