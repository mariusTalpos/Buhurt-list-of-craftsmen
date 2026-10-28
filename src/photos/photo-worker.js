import { PHOTO_LIMITS, identifyPhoto, headerDimensions, validateDimensions, validatePhotoSize, outputDimensions } from './photo-policy.js';

self.onmessage = async ({ data: { input } }) => {
  const started = performance.now();
  let bitmap;
  let images = [];
  let decoder;
  try {
    validatePhotoSize(input.byteLength);
    const format = identifyPhoto(new Uint8Array(input));
    if (!format) throw new Error('Choose a JPEG, HEIC/HEIF, PNG, or WebP photo.');
    let source;
    let width;
    let height;
    if (format === 'heif') {
      // Local bundled WASM: no user photo is sent to a conversion service.
      const { default: createLibheif } = await import('./heif-decoder.js');
      const libheif = await createLibheif();
      decoder = new libheif.HeifDecoder();
      images = decoder.decode(new Uint8Array(input));
      if (!images.length) throw new Error('This HEIC/HEIF photo could not be decoded.');
      // libheif applies HEIF rotation/mirroring. Use the primary still image.
      const image = images.find((item) => item.is_primary?.()) ?? images[0];
      width = image.get_width(); height = image.get_height();
      validateDimensions(width, height);
      const pixels = new ImageData(width, height);
      await new Promise((resolve, reject) => image.display(pixels, (result) => {
        if (result) resolve(); else reject(new Error('This HEIC/HEIF photo could not be decoded.'));
      }));
      source = new OffscreenCanvas(width, height);
      source.getContext('2d').putImageData(pixels, 0, 0);
    } else {
      const dimensions = headerDimensions(new Uint8Array(input), format);
      if (!dimensions) throw new Error('This photo has an invalid or unsupported image header.');
      validateDimensions(dimensions.width, dimensions.height);
      bitmap = await createImageBitmap(new Blob([input], { type: `image/${format}` }), { imageOrientation: 'from-image' });
      width = bitmap.width; height = bitmap.height;
      validateDimensions(width, height);
      source = bitmap;
    }
    const output = outputDimensions(width, height);
    const canvas = new OffscreenCanvas(output.width, output.height);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(source, 0, 0, output.width, output.height);
    // Canvas encoding copies pixels only, removing original EXIF/GPS metadata.
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: PHOTO_LIMITS.jpegQuality });
    if (blob.type !== 'image/jpeg' || blob.size > PHOTO_LIMITS.maxInputBytes) throw new Error('Could not produce a JPEG within the photo size limit.');
    self.postMessage({ blob, width: output.width, height: output.height, sourceWidth: width, sourceHeight: height, format, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not process this photo.' });
  } finally {
    bitmap?.close();
    for (const image of images) image.free?.();
    decoder?.delete?.();
  }
};
