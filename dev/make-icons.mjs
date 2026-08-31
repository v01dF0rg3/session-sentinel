// Generates the extension icons as PNGs with no dependencies.
//
// Design: near-black rounded square, white disc, black padlock with a keyhole cut out.
// Proportions measured off the supplied reference art and expressed in normalised
// coordinates (x and y span -1..1, y increasing downward) so every size matches.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const BG = [10, 12, 19];      // near-black, faint blue cast
const FG = [255, 255, 255];   // disc

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- shapes, all in normalised coordinates ---------------------------------

function inRoundedSquare(x, y, extent, r) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const lim = extent - r;
  if (ax > extent || ay > extent) return false;
  if (ax <= lim || ay <= lim) return true;
  return Math.hypot(ax - lim, ay - lim) <= r;
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x1 - r, x));
  const cy = Math.max(y0 + r, Math.min(y1 - r, y));
  return Math.hypot(x - cx, y - cy) <= r + 1e-9;
}

const BODY = { x0: -0.35, y0: -0.14, x1: 0.35, y1: 0.45, r: 0.05 };

// A padlock shackle is a constant-thickness arch: a domed top on two straight legs.
// Modelling it as an ellipse instead gives a pointed, keyhole-ish top that reads wrong.
const SHACKLE = {
  arcCy: -0.245,   // centre of the top arc
  outer: 0.257,    // outer half-width, and the outer arc radius
  inner: 0.148,    // inner half-width, and the inner arc radius
  legBottom: -0.10 // legs run down behind the body
};

function inShackle(x, y) {
  const ax = Math.abs(x);
  if (ax > SHACKLE.outer || y > SHACKLE.legBottom) return false;

  if (y <= SHACKLE.arcCy) {
    // Domed top.
    const d = Math.hypot(x, y - SHACKLE.arcCy);
    return d <= SHACKLE.outer && d >= SHACKLE.inner;
  }
  // Straight legs.
  return ax >= SHACKLE.inner;
}

function inLock(x, y) {
  return inRoundedRect(x, y, BODY.x0, BODY.y0, BODY.x1, BODY.y1, BODY.r) || inShackle(x, y);
}

// Keyhole: a circle with a tapered stem widening as it drops.
function inKeyhole(x, y) {
  const cy = 0.13;
  const r = 0.082;
  if (Math.hypot(x, y - cy) <= r) return true;
  const stemBottom = 0.30;
  if (y < cy || y > stemBottom) return false;
  const t = (y - cy) / (stemBottom - cy);
  const halfWidth = r * (0.30 + 0.23 * t);
  return Math.abs(x) <= halfWidth;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  // Small icons need more samples: at 16px a single pixel spans a lot of curve.
  const SS = size <= 32 ? 6 : 4;
  const DISC_R = 0.657;

  // Hinting for the 16px favicon. At that size the keyhole is under two pixels wide and
  // only muddies the silhouette, so it is dropped and the lock is enlarged slightly to
  // keep its shape readable. Every larger size renders the full artwork.
  const tiny = size <= 16;
  const lockScale = tiny ? 0.90 : 1;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, cover = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / SS) / size) * 2 - 1;

          if (!inRoundedSquare(x, y, 0.995, 0.27)) continue;

          let colour = BG;
          if (Math.hypot(x, y) <= DISC_R) {
            // Inside the disc the lock is punched out in the background colour, and the
            // keyhole is punched back out of the lock.
            const lx = x / lockScale;
            const ly = y / lockScale;
            colour = inLock(lx, ly) && !(!tiny && inKeyhole(lx, ly)) ? BG : FG;
          }

          r += colour[0]; g += colour[1]; b += colour[2];
          cover += 1;
        }
      }

      if (cover === 0) continue;
      const i = (py * size + px) * 4;
      pixels[i] = Math.round(r / cover);
      pixels[i + 1] = Math.round(g / cover);
      pixels[i + 2] = Math.round(b / cover);
      pixels[i + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  }
  return pixels;
}

for (const size of (process.env.SIZES ? process.env.SIZES.split(',').map(Number) : [16, 32, 48, 128])) {
  writeFileSync(join(OUT, `icon-${size}.png`), png(size, render(size)));
  console.log(`icon-${size}.png`);
}
