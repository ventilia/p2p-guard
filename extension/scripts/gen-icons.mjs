/**
 * Генератор иконок расширения (щит на тёмном фоне) без внешних зависимостей.
 * Запуск: node scripts/gen-icons.mjs → public/icons/icon{16,48,128}.png
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');

const BG = [20, 23, 31, 255]; // #14171F
const FG = [240, 185, 11, 255]; // #F0B90B — фирменный жёлтый Binance
const FG_DARK = [20, 23, 31, 255];

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixelAt) {
  // Каждая строка PNG начинается с байта фильтра (0 = None)
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Щит: сверху прямоугольник, снизу сужение в остриё. */
function inShield(nx, ny, scale = 1) {
  const halfWidth = 0.27 * scale;
  const top = 0.5 - 0.32 * scale;
  const bottom = 0.5 + 0.34 * scale;
  const shoulder = 0.5 + 0.06 * scale;

  if (ny < top || ny > bottom) return false;

  const dx = Math.abs(nx - 0.5);
  if (ny <= shoulder) return dx <= halfWidth;

  const t = (ny - shoulder) / (bottom - shoulder);
  return dx <= halfWidth * (1 - t * t);
}

function pixel(size) {
  const radius = size * 0.22;
  return (x, y) => {
    const nx = (x + 0.5) / size;
    const ny = (y + 0.5) / size;

    // Скруглённые углы подложки
    const cx = Math.min(x + 0.5, size - x - 0.5);
    const cy = Math.min(y + 0.5, size - y - 0.5);
    if (cx < radius && cy < radius) {
      const dist = Math.hypot(radius - cx, radius - cy);
      if (dist > radius) return [0, 0, 0, 0];
    }

    if (inShield(nx, ny)) {
      // Внутренняя выемка — «галочка» негативом
      const inner = inShield(nx, ny, 0.62);
      if (inner && ny > 0.42 && ny < 0.62 && Math.abs(nx - 0.5) < 0.14) return FG_DARK;
      return FG;
    }

    return BG;
  };
}

await mkdir(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png = encodePng(size, pixel(size));
  await writeFile(resolve(outDir, `icon${size}.png`), png);
  console.log(`✓ icon${size}.png (${png.length} байт)`);
}
