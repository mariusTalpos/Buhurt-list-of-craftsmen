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
function identifyPhoto(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return "png";
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 256));
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "webp";
  if (text.slice(4, 8) === "ftyp") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = Math.min(view.getUint32(0), bytes.length, 256);
    const brands = [text.slice(8, 12)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(text.slice(i, i + 4));
    if (brands.some((brand) => ["avif", "avis"].includes(brand))) return null;
    if (brands.some((brand) => ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand))) return "heif";
  }
  return null;
}
function validatePhotoSize(size) {
  if (!Number.isFinite(size) || size <= 0 || size > PHOTO_LIMITS.maxInputBytes) {
    throw new Error("Choose a photo no larger than 10 MB.");
  }
}
function headerDimensions(bytes, format) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === "png" && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (format === "jpeg") {
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i++] !== 255) return null;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 217 || marker === 218) return null;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = view.getUint16(i);
      if (length < 2 || i + length > bytes.length) return null;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        return { width: view.getUint16(i + 5), height: view.getUint16(i + 3) };
      }
      i += length;
    }
  }
  if (format === "webp" && bytes.length >= 30) {
    const chunk = new TextDecoder().decode(bytes.subarray(12, 16));
    if (chunk === "VP8X") return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 };
    if (chunk === "VP8L") return { width: 1 + ((bytes[21] | bytes[22] << 8) & 16383), height: 1 + ((bytes[22] >> 6 | bytes[23] << 2 | bytes[24] << 10) & 16383) };
  }
  return null;
}
function validateDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > PHOTO_LIMITS.maxInputSide || height > PHOTO_LIMITS.maxInputSide || width * height > PHOTO_LIMITS.maxPixels) {
    throw new Error("Photo is too large to process: maximum 60 megapixels and 12,000 pixels per side.");
  }
}
function outputDimensions(width, height) {
  validateDimensions(width, height);
  const ratio = Math.min(1, PHOTO_LIMITS.maxOutputSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

// src/photos/photo-worker.js
self.onmessage = async ({ data: { input } }) => {
  const started = performance.now();
  let bitmap;
  let images = [];
  let decoder;
  try {
    validatePhotoSize(input.byteLength);
    const format = identifyPhoto(new Uint8Array(input));
    if (!format) throw new Error("Choose a JPEG, HEIC/HEIF, PNG, or WebP photo.");
    let source;
    let width;
    let height;
    if (format === "heif") {
      const { default: createLibheif } = await import("./heif-decoder.js");
      const libheif = await createLibheif();
      decoder = new libheif.HeifDecoder();
      images = decoder.decode(new Uint8Array(input));
      if (!images.length) throw new Error("This HEIC/HEIF photo could not be decoded.");
      const image = images.find((item) => item.is_primary?.()) ?? images[0];
      width = image.get_width();
      height = image.get_height();
      validateDimensions(width, height);
      const pixels = new ImageData(width, height);
      await new Promise((resolve, reject) => image.display(pixels, (result) => {
        if (result) resolve();
        else reject(new Error("This HEIC/HEIF photo could not be decoded."));
      }));
      source = new OffscreenCanvas(width, height);
      source.getContext("2d").putImageData(pixels, 0, 0);
    } else {
      const dimensions = headerDimensions(new Uint8Array(input), format);
      if (!dimensions) throw new Error("This photo has an invalid or unsupported image header.");
      validateDimensions(dimensions.width, dimensions.height);
      bitmap = await createImageBitmap(new Blob([input], { type: `image/${format}` }), { imageOrientation: "from-image" });
      width = bitmap.width;
      height = bitmap.height;
      validateDimensions(width, height);
      source = bitmap;
    }
    const output = outputDimensions(width, height);
    const canvas = new OffscreenCanvas(output.width, output.height);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(source, 0, 0, output.width, output.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: PHOTO_LIMITS.jpegQuality });
    if (blob.type !== "image/jpeg" || blob.size > PHOTO_LIMITS.maxInputBytes) throw new Error("Could not produce a JPEG within the photo size limit.");
    self.postMessage({ blob, width: output.width, height: output.height, sourceWidth: width, sourceHeight: height, format, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Could not process this photo." });
  } finally {
    bitmap?.close();
    for (const image of images) image.free?.();
    decoder?.delete?.();
  }
};
