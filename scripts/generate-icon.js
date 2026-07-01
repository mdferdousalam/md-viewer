// Generates assets/icon.png (1024x1024) — a Markdown-style mark on a rounded
// blue tile. Dependency-free: writes a valid PNG using Node's zlib.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const px = Buffer.alloc(SIZE * SIZE * 4); // RGBA

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

function fillRoundedRect(x0, y0, x1, y1, radius, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // rounded corners
      let dx = 0, dy = 0;
      if (x < x0 + radius && y < y0 + radius) { dx = x0 + radius - x; dy = y0 + radius - y; }
      else if (x >= x1 - radius && y < y0 + radius) { dx = x - (x1 - radius - 1); dy = y0 + radius - y; }
      else if (x < x0 + radius && y >= y1 - radius) { dx = x0 + radius - x; dy = y - (y1 - radius - 1); }
      else if (x >= x1 - radius && y >= y1 - radius) { dx = x - (x1 - radius - 1); dy = y - (y1 - radius - 1); }
      if (dx * dx + dy * dy > radius * radius) continue;
      set(x, y, color[0], color[1], color[2], color[3] ?? 255);
    }
  }
}

function fillRect(x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) set(x, y, color[0], color[1], color[2], color[3] ?? 255);
}

function fillTriangleDown(cx, top, halfW, height, color) {
  for (let y = 0; y < height; y++) {
    const w = Math.round(halfW * (1 - y / height));
    for (let x = cx - w; x <= cx + w; x++) set(x, top + y, color[0], color[1], color[2], color[3] ?? 255);
  }
}

// Background: rounded blue tile with a subtle vertical gradient.
for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE;
  const r = Math.round(78 + t * -20);
  const g = Math.round(161 + t * -30);
  const b = Math.round(255 + t * -35);
  for (let x = 0; x < SIZE; x++) set(x, y, r, g, b, 0); // start transparent; tile masks below
}
fillRoundedRect(96, 96, SIZE - 96, SIZE - 96, 180, [40, 60, 90, 255]);
fillRoundedRect(112, 112, SIZE - 112, SIZE - 112, 168, [78, 145, 235, 255]);

// White "M" (two verticals + center V) — the Markdown mark style.
const white = [255, 255, 255, 255];
const barW = 90;
const topY = 340, botY = 690;
// left bar
fillRect(300, topY, 300 + barW, botY, white);
// right bar
fillRect(634, topY, 634 + barW, botY, white);
// center V (two slanted strokes approximated with steps)
for (let y = topY; y < topY + 220; y++) {
  const prog = (y - topY) / 220;
  const lx = Math.round(300 + barW + prog * 120);
  const rx = Math.round(634 - prog * 120);
  fillRect(lx, y, lx + barW, y + 6, white);
  fillRect(rx - barW, y, rx, y + 6, white);
}

// Down arrow to the right.
const ax = 760;
fillRect(ax, topY, ax + 70, 560, white);      // shaft
fillTriangleDown(ax + 35, 545, 120, 150, white); // head

// --- PNG encode ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
// add filter byte (0) per row
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('Wrote', out, `(${(png.length / 1024).toFixed(1)} KB)`);
