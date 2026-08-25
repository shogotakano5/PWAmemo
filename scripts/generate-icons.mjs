#!/usr/bin/env node
/**
 * Generates the PWA icon set as PNGs with no image dependencies: the shapes are
 * rasterised into an RGBA buffer here and encoded with zlib + PNG chunks.
 * Run via `npm run icons` (also wired into `npm run build`).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const ACCENT = [47, 109, 246];
const PAPER = [255, 255, 255];
const SAMPLES = 4; // supersampling grid per axis, for smooth corners

/* ------------------------------------------------------------------ PNG -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- shapes -- */

/** Signed coverage test for an axis-aligned rounded rectangle. */
function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function blend(target, offset, color, alpha) {
  for (let c = 0; c < 3; c += 1) {
    target[offset + c] = Math.round(target[offset + c] * (1 - alpha) + color[c] * alpha);
  }
  target[offset + 3] = Math.round(target[offset + 3] * (1 - alpha) + 255 * alpha);
}

/**
 * Draws the app mark: a rounded blue tile with three "written lines" on it.
 * `padding` leaves room inside the maskable safe zone.
 */
function renderIcon(size, { maskable = false, opaqueBackground = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  if (opaqueBackground) {
    for (let i = 0; i < size * size; i += 1) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = 255;
    }
  }

  // Maskable icons are cropped to a circle of ~80% width by some launchers, so
  // the tile is full-bleed there and the glyph is pulled well inside.
  const tileInset = maskable ? 0 : size * 0.06;
  const tileLeft = tileInset;
  const tileTop = tileInset;
  const tileRight = size - tileInset;
  const tileBottom = size - tileInset;
  const tileRadius = maskable ? size * 0.02 : size * 0.22;

  const glyphInset = maskable ? size * 0.28 : size * 0.24;
  const lineHeight = size * 0.072;
  const lineRadius = lineHeight / 2;
  const gap = size * 0.13;
  const glyphTop = size / 2 - (lineHeight * 3 + gap * 2) / 2;
  const lines = [1, 1, 0.6].map((widthRatio, index) => ({
    left: glyphInset,
    right: glyphInset + (size - glyphInset * 2) * widthRatio,
    top: glyphTop + index * (lineHeight + gap),
    bottom: glyphTop + index * (lineHeight + gap) + lineHeight,
  }));

  const step = 1 / SAMPLES;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let tileHits = 0;
      let lineHits = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          if (insideRoundedRect(px, py, tileLeft, tileTop, tileRight, tileBottom, tileRadius)) {
            tileHits += 1;
            for (const line of lines) {
              if (insideRoundedRect(px, py, line.left, line.top, line.right, line.bottom, lineRadius)) {
                lineHits += 1;
                break;
              }
            }
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      if (tileHits === 0) continue;
      const offset = (y * size + x) * 4;
      blend(rgba, offset, ACCENT, tileHits / total);
      if (lineHits > 0) blend(rgba, offset, PAPER, lineHits / total);
    }
  }
  return encodePng(size, size, rgba);
}

/* ---------------------------------------------------------------- main -- */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-192.png', 192, { maskable: true }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { opaqueBackground: true }],
  ['favicon-32.png', 32, {}],
];

for (const [name, size, options] of targets) {
  writeFileSync(join(OUT_DIR, name), renderIcon(size, options));
  process.stdout.write(`icons: ${name} (${size}x${size})\n`);
}
