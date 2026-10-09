/**
 * Lossless BMP → PNG conversion with no image library (floor plans are often
 * uploaded as uncompressed BMP — several MB each).
 *
 * Supports uncompressed 1/4/8/16/24/32-bit BMPs (BI_RGB / BI_BITFIELDS,
 * bottom-up or top-down). Returns null for anything else (RLE, JPEG/PNG-in-BMP,
 * OS/2 headers), so the caller keeps the original file.
 *
 * Images with ≤256 colours become palette PNGs (typical for drawings).
 */

import zlib from "zlib";

interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, row-major, top row first. */
  rgba: Uint8Array;
  hasAlpha: boolean;
}

const BI_RGB = 0;
const BI_BITFIELDS = 3;
const BI_ALPHABITFIELDS = 6;

function maskShiftAndMax(mask: number): { shift: number; max: number } {
  if (!mask) return { shift: 0, max: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift += 1;
  return { shift, max: mask >>> shift };
}

/** Decode an uncompressed BMP to RGBA, or null when the format is not supported. */
export function decodeBmp(buf: Buffer): DecodedImage | null {
  if (buf.length < 54 || buf.toString("ascii", 0, 2) !== "BM") return null;
  const pixelOffset = buf.readUInt32LE(10);
  const dibSize = buf.readUInt32LE(14);
  if (dibSize < 40) return null;

  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  const colorsUsed = buf.readUInt32LE(46);
  if (width <= 0 || rawHeight === 0) return null;
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return null;
  if (![BI_RGB, BI_BITFIELDS, BI_ALPHABITFIELDS].includes(compression)) return null;
  if (compression !== BI_RGB && bpp !== 16 && bpp !== 32) return null;

  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  if (pixelOffset + stride * height > buf.length) return null;

  // Palette (≤8-bit).
  let palette: Uint8Array | null = null;
  if (bpp <= 8) {
    const count = colorsUsed || 1 << bpp;
    const start = 14 + dibSize;
    if (start + count * 4 > pixelOffset) return null;
    palette = new Uint8Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      palette[i * 3] = buf[start + i * 4 + 2];
      palette[i * 3 + 1] = buf[start + i * 4 + 1];
      palette[i * 3 + 2] = buf[start + i * 4];
    }
  }

  // Channel masks (16/32-bit).
  let masks: number[] | null = null;
  if (bpp === 16 || bpp === 32) {
    if (compression === BI_RGB) {
      masks = bpp === 16 ? [0x7c00, 0x03e0, 0x001f, 0] : [0x00ff0000, 0x0000ff00, 0x000000ff, 0];
    } else {
      // Masks follow a 40-byte header, or sit inside a V4/V5 header.
      const at = 54;
      if (at + 12 > buf.length) return null;
      masks = [buf.readUInt32LE(at), buf.readUInt32LE(at + 4), buf.readUInt32LE(at + 8), 0];
      if (dibSize >= 56 || compression === BI_ALPHABITFIELDS) masks[3] = buf.readUInt32LE(at + 12);
    }
  }
  const channels = masks ? masks.map(maskShiftAndMax) : null;

  const rgba = new Uint8Array(width * height * 4);
  // 32-bit BI_RGB: the 4th byte is unused unless the file actually fills it
  // (same rule browsers use) — read it, decide after.
  const rawAlpha32 = bpp === 32 && compression === BI_RGB;
  let anyAlpha = false;
  let allAlphaZero = true;

  for (let y = 0; y < height; y += 1) {
    const srcRow = pixelOffset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (bpp <= 8) {
        const bitPos = x * bpp;
        const byte = buf[srcRow + (bitPos >> 3)];
        const idx = (byte >> (8 - bpp - (bitPos & 7))) & ((1 << bpp) - 1);
        r = palette![idx * 3] ?? 0;
        g = palette![idx * 3 + 1] ?? 0;
        b = palette![idx * 3 + 2] ?? 0;
      } else if (bpp === 24) {
        const p = srcRow + x * 3;
        b = buf[p];
        g = buf[p + 1];
        r = buf[p + 2];
      } else {
        const value = bpp === 16 ? buf.readUInt16LE(srcRow + x * 2) : buf.readUInt32LE(srcRow + x * 4);
        const ch = channels!;
        const read = (i: number) =>
          ch[i].max ? Math.round((((value & masks![i]) >>> ch[i].shift) * 255) / ch[i].max) : 0;
        r = read(0);
        g = read(1);
        b = read(2);
        if (rawAlpha32) {
          a = buf[srcRow + x * 4 + 3];
          if (a !== 0) allAlphaZero = false;
        } else if (ch[3].max) {
          a = read(3);
        }
      }
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }

  if (rawAlpha32 && allAlphaZero) {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  }
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      anyAlpha = true;
      break;
    }
  }
  return { width, height, rgba, hasAlpha: anyAlpha };
}

// ── PNG encoding ─────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Per-row adaptive filtering (the usual minimum-sum-of-absolutes heuristic). */
function filterRows(raw: Uint8Array, rowBytes: number, height: number, bpp: number): Buffer {
  const out = Buffer.alloc((rowBytes + 1) * height);
  const candidates = Array.from({ length: 5 }, () => Buffer.alloc(rowBytes));
  for (let y = 0; y < height; y += 1) {
    const row = raw.subarray(y * rowBytes, (y + 1) * rowBytes);
    const prev = y > 0 ? raw.subarray((y - 1) * rowBytes, y * rowBytes) : null;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f += 1) {
      const dst = candidates[f];
      let sum = 0;
      for (let i = 0; i < rowBytes; i += 1) {
        const left = i >= bpp ? row[i - bpp] : 0;
        const up = prev ? prev[i] : 0;
        const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
        let pred = 0;
        if (f === 1) pred = left;
        else if (f === 2) pred = up;
        else if (f === 3) pred = (left + up) >> 1;
        else if (f === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        const v = (row[i] - pred) & 0xff;
        dst[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    const o = y * (rowBytes + 1);
    out[o] = best;
    candidates[best].copy(out, o + 1);
  }
  return out;
}

export function encodePng(image: DecodedImage): Buffer {
  const { width, height, rgba, hasAlpha } = image;

  // Palette when the image has at most 256 distinct colours.
  const paletteIndex = new Map<number, number>();
  let usePalette = true;
  for (let i = 0; i < rgba.length; i += 4) {
    const key = ((rgba[i] << 24) | (rgba[i + 1] << 16) | (rgba[i + 2] << 8) | rgba[i + 3]) >>> 0;
    if (!paletteIndex.has(key)) {
      if (paletteIndex.size >= 256) {
        usePalette = false;
        break;
      }
      paletteIndex.set(key, paletteIndex.size);
    }
  }

  let colorType: number;
  let bytesPerPixel: number;
  let raw: Uint8Array;
  const extra: Buffer[] = [];

  if (usePalette) {
    colorType = 3;
    bytesPerPixel = 1;
    raw = new Uint8Array(width * height);
    for (let p = 0, i = 0; i < rgba.length; i += 4, p += 1) {
      const key = ((rgba[i] << 24) | (rgba[i + 1] << 16) | (rgba[i + 2] << 8) | rgba[i + 3]) >>> 0;
      raw[p] = paletteIndex.get(key)!;
    }
    const plte = Buffer.alloc(paletteIndex.size * 3);
    const trns = Buffer.alloc(paletteIndex.size);
    for (const [key, idx] of paletteIndex) {
      plte[idx * 3] = (key >>> 24) & 0xff;
      plte[idx * 3 + 1] = (key >>> 16) & 0xff;
      plte[idx * 3 + 2] = (key >>> 8) & 0xff;
      trns[idx] = key & 0xff;
    }
    extra.push(chunk("PLTE", plte));
    if (hasAlpha) extra.push(chunk("tRNS", trns));
  } else if (hasAlpha) {
    colorType = 6;
    bytesPerPixel = 4;
    raw = rgba;
  } else {
    colorType = 2;
    bytesPerPixel = 3;
    raw = new Uint8Array(width * height * 3);
    for (let p = 0, i = 0; i < rgba.length; i += 4, p += 3) {
      raw[p] = rgba[i];
      raw[p + 1] = rgba[i + 1];
      raw[p + 2] = rgba[i + 2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const filtered = filterRows(raw, width * bytesPerPixel, height, bytesPerPixel);
  const idat = zlib.deflateSync(filtered, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** BMP buffer → PNG buffer, or null when the BMP format is not supported. */
export function bmpToPng(bmp: Buffer): Buffer | null {
  const image = decodeBmp(bmp);
  return image ? encodePng(image) : null;
}
