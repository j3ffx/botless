// Renders the icons (a split circle: half solid red "AI", half white ring "human", on a dark tile)
// to PNG at each size with 4x4 supersampling. No image libraries needed.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const TILE = [24, 24, 27], EDGE = [58, 58, 64], RED = [229, 45, 45], WHITE = [245, 245, 245];
/**
 * x,y in [0,1]. `inset` is the transparent margin on each side. The Chrome Web Store wants 96×96 artwork in the
 * 128×128 icon (inset 16/128); toolbar sizes keep a near-full tile, or the artwork would shrink to 12 px at 16.
 */
function sample(x, y, inset) {
  const t = 1 - 2 * inset; // tile size; everything below scales with it
  const r = 0.229 * t; // corner radius
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - inset - r), 0), dy = Math.max(Math.abs(y - 0.5) - (0.5 - inset - r), 0);
  const edge = Math.hypot(dx, dy) - r; // < 0 inside the tile
  if (edge > 0) return null;
  const d = Math.hypot(x - 0.5, y - 0.5);
  if (d < 0.302 * t) {
    if (x < 0.5) return RED; // solid half: "AI"
    return d > 0.198 * t ? WHITE : TILE; // ring half: "human"
  }
  return edge > -0.012 ? EDGE : TILE; // faint outline, so the dark tile still shows on dark backgrounds
}

mkdirSync('src/static/icons', { recursive: true });
for (const [size, inset] of [[16, 0.02], [32, 0.02], [48, 0.02], [128, 16 / 128]]) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const c = sample((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size, inset);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (y * size + x) * 4;
    if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; px[o + 3] = (255 * a) / (ss * ss); }
  }
  writeFileSync(`src/static/icons/icon-${size}.png`, png(size, px));
}
console.log('icons written');
