// Node.js script to generate valid PNG icons for ReelFlow extension
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table & function
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

function generatePng(size) {
  const width = size;
  const height = size;
  const rawData = Buffer.alloc((width * 4 + 1) * height);

  // Design: Dark sleek purple-to-cyan gradient background with a rounded square,
  // and a vibrant forward/downward scroll arrow icon.
  const radius = size * 0.22;
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawData[rowOffset] = 0; // Filter byte 0 (None)

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;

      // Rounded rect mask
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const halfSize = (width / 2) - 2;
      const cornerDx = Math.max(0, dx - (halfSize - radius));
      const cornerDy = Math.max(0, dy - (halfSize - radius));
      const distFromCorner = Math.sqrt(cornerDx * cornerDx + cornerDy * cornerDy);

      let alpha = 0;
      if (distFromCorner <= radius) {
        alpha = 1;
        // Anti-aliasing edge
        if (distFromCorner > radius - 1) {
          alpha = Math.max(0, radius - distFromCorner);
        }
      }

      if (alpha === 0) {
        rawData[pixelOffset] = 0;
        rawData[pixelOffset + 1] = 0;
        rawData[pixelOffset + 2] = 0;
        rawData[pixelOffset + 3] = 0;
        continue;
      }

      // Base gradient: Neon violet (#8b5cf6 -> #ec4899 -> #06b6d4)
      const tY = y / height;
      const tX = x / width;
      let r = Math.round(139 * (1 - tX) + 236 * tX);
      let g = Math.round(92 * (1 - tY) + 72 * tY);
      let b = Math.round(246 * (1 - tX) + 212 * tX);

      // Icon: Reel frame & Downward Arrow in the center
      // Normalize coords to [-1, 1]
      const nx = (x - cx) / (width * 0.45);
      const ny = (y - cy) / (height * 0.45);

      let isForeground = false;

      // Downward arrow shape
      // Stem: |nx| < 0.2 && ny >= -0.55 && ny <= 0.15
      // Head: |nx| <= (0.55 - ny) && ny > 0.05 && ny <= 0.55
      const inStem = Math.abs(nx) <= 0.18 && ny >= -0.65 && ny <= 0.15;
      const inHead = ny > 0.05 && ny <= 0.65 && Math.abs(nx) <= (0.65 - ny) * 0.9;

      if (inStem || inHead) {
        isForeground = true;
      }

      if (isForeground) {
        // Bright white/cyan glow for the arrow
        r = 255;
        g = 255;
        b = 255;
      }

      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = Math.round(alpha * 255);
    }
  }

  const deflated = zlib.deflateSync(rawData);

  // PNG Header
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT chunk
  const idatChunk = createChunk('IDAT', deflated);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

[16, 48, 128].forEach(size => {
  const pngBuffer = generatePng(size);
  const outPath = path.join(__dirname, `icon${size}.png`);
  fs.writeFileSync(outPath, pngBuffer);
  console.log(`Generated ${outPath} (${pngBuffer.length} bytes)`);
});
