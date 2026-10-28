export const PHOTO_LIMITS = Object.freeze({
  maxFiles: 5,
  maxInputBytes: 10 * 1024 * 1024,
  maxPixels: 60_000_000,
  maxInputSide: 12_000,
  maxOutputSide: 2560,
  jpegQuality: 0.9,
  timeoutMs: 90_000,
});

// Identify actual bytes, not the phone's occasionally empty/incorrect MIME label.
export function identifyPhoto(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'png';
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 256));
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'webp';
  if (text.slice(4, 8) === 'ftyp') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = Math.min(view.getUint32(0), bytes.length, 256);
    const brands = [text.slice(8, 12)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(text.slice(i, i + 4));
    if (brands.some((brand) => ['avif', 'avis'].includes(brand))) return null;
    if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))) return 'heif';
  }
  return null;
}

export function validatePhotoSize(size) {
  if (!Number.isFinite(size) || size <= 0 || size > PHOTO_LIMITS.maxInputBytes) {
    throw new Error('Choose a photo no larger than 10 MB.');
  }
}

// Check native-format dimensions before asking the browser to allocate pixels.
export function headerDimensions(bytes, format) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === 'png' && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (format === 'jpeg') {
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i++] !== 0xff) return null;
      while (bytes[i] === 0xff) i++;
      const marker = bytes[i++];
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = view.getUint16(i);
      if (length < 2 || i + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: view.getUint16(i + 5), height: view.getUint16(i + 3) };
      }
      i += length;
    }
  }
  if (format === 'webp' && bytes.length >= 30) {
    const chunk = new TextDecoder().decode(bytes.subarray(12, 16));
    if (chunk === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') return { width: 1 + ((bytes[21] | (bytes[22] << 8)) & 0x3fff), height: 1 + (((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 0x3fff) };
  }
  return null;
}

export function validateDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > PHOTO_LIMITS.maxInputSide || height > PHOTO_LIMITS.maxInputSide ||
      width * height > PHOTO_LIMITS.maxPixels) {
    throw new Error('Photo is too large to process: maximum 60 megapixels and 12,000 pixels per side.');
  }
}

export function outputDimensions(width, height) {
  validateDimensions(width, height);
  const ratio = Math.min(1, PHOTO_LIMITS.maxOutputSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
