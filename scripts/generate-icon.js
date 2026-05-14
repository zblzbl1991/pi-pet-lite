/**
 * Icon generator for Clawd Desktop Pet.
 *
 * Generates a simple 256x256 ICO file with a green cat-face icon.
 * Run via `npm run postinstall` or directly with `node scripts/generate-icon.js`.
 *
 * The ICO format is required by electron-builder for Windows.
 * This script creates a minimal but functional icon without needing
 * any image processing dependencies.
 */

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ICON_PATH = path.join(ASSETS_DIR, 'icon.ico');

function generateIcon() {
  // Ensure assets directory exists
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // Generate a 256x256 PNG image with a cat face design
  const size = 256;
  const pngData = createCatFacePNG(size);

  // Create ICO file containing the PNG
  // ICO format: header (6 bytes) + directory entry (16 bytes) + PNG data
  const headerSize = 6;
  const entrySize = 16;
  const dataSize = pngData.length;

  const ico = Buffer.alloc(headerSize + entrySize + dataSize);

  // ICO Header
  ico.writeUInt16LE(0, 0);     // Reserved
  ico.writeUInt16LE(1, 2);     // Type: 1 = ICO
  ico.writeUInt16LE(1, 4);     // Number of images: 1

  // Directory entry
  ico.writeUInt8(size >= 256 ? 0 : size, 6);  // Width (0 = 256)
  ico.writeUInt8(size >= 256 ? 0 : size, 7);  // Height (0 = 256)
  ico.writeUInt8(0, 8);        // Color palette
  ico.writeUInt8(0, 9);        // Reserved
  ico.writeUInt16LE(1, 10);    // Color planes
  ico.writeUInt16LE(32, 12);   // Bits per pixel
  ico.writeUInt32LE(dataSize, 14);  // Image data size
  ico.writeUInt32LE(headerSize + entrySize, 18);  // Image data offset

  // Copy PNG data
  pngData.copy(ico, headerSize + entrySize);

  fs.writeFileSync(ICON_PATH, ico);
  console.log(`Generated icon: ${ICON_PATH}`);
}

/**
 * Create a minimal PNG image with a cat face design.
 * Uses raw RGBA pixel data with PNG compression.
 */
function createCatFacePNG(size) {
  // Create RGBA pixel data
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const faceRadius = size * 0.38;

  // Colors
  const bgR = 0, bgG = 0, bgB = 0, bgA = 0;              // Transparent
  const faceR = 80, faceG = 180, faceB = 120, faceA = 255; // Green
  const darkR = 30, darkG = 100, darkB = 70, darkA = 255;  // Dark green
  const whiteR = 255, whiteG = 255, whiteB = 255, whiteA = 255;
  const pinkR = 240, pinkG = 140, pinkB = 160, pinkA = 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Default: transparent
      pixels[idx] = bgR;
      pixels[idx + 1] = bgG;
      pixels[idx + 2] = bgB;
      pixels[idx + 3] = bgA;

      // Cat face (circle)
      if (dist <= faceRadius) {
        pixels[idx] = faceR;
        pixels[idx + 1] = faceG;
        pixels[idx + 2] = faceB;
        pixels[idx + 3] = faceA;
      }

      // Cat ears (two triangles at the top)
      const leftEarCenterX = center - faceRadius * 0.6;
      const rightEarCenterX = center + faceRadius * 0.6;
      const earBaseY = center - faceRadius * 0.5;

      // Left ear
      const ldx = x - leftEarCenterX;
      const ldy = y - (center - faceRadius * 1.2);
      if (ldy < 0) {
        const earWidth = faceRadius * 0.5 * (1 - Math.abs(ldy) / (faceRadius * 0.8));
        if (Math.abs(ldx) < earWidth && ldy > -faceRadius * 0.8) {
          pixels[idx] = faceR;
          pixels[idx + 1] = faceG;
          pixels[idx + 2] = faceB;
          pixels[idx + 3] = faceA;
        }
      }

      // Right ear
      const rdx = x - rightEarCenterX;
      const rdy = y - (center - faceRadius * 1.2);
      if (rdy < 0) {
        const earWidth = faceRadius * 0.5 * (1 - Math.abs(rdy) / (faceRadius * 0.8));
        if (Math.abs(rdx) < earWidth && rdy > -faceRadius * 0.8) {
          pixels[idx] = faceR;
          pixels[idx + 1] = faceG;
          pixels[idx + 2] = faceB;
          pixels[idx + 3] = faceA;
        }
      }

      // Eyes (two dark circles)
      const eyeRadius = faceRadius * 0.13;
      const leftEyeX = center - faceRadius * 0.28;
      const rightEyeX = center + faceRadius * 0.28;
      const eyeY = center - faceRadius * 0.1;

      const leftEyeDist = Math.sqrt((x - leftEyeX) ** 2 + (y - eyeY) ** 2);
      const rightEyeDist = Math.sqrt((x - rightEyeX) ** 2 + (y - eyeY) ** 2);

      if (leftEyeDist <= eyeRadius || rightEyeDist <= eyeRadius) {
        pixels[idx] = darkR;
        pixels[idx + 1] = darkG;
        pixels[idx + 2] = darkB;
        pixels[idx + 3] = darkA;
      }

      // Eye highlights (small white dots)
      const hlRadius = eyeRadius * 0.35;
      const hlOffset = eyeRadius * 0.3;
      const leftHlDist = Math.sqrt((x - (leftEyeX + hlOffset)) ** 2 + (y - (eyeY - hlOffset)) ** 2);
      const rightHlDist = Math.sqrt((x - (rightEyeX + hlOffset)) ** 2 + (y - (eyeY - hlOffset)) ** 2);

      if (leftHlDist <= hlRadius || rightHlDist <= hlRadius) {
        pixels[idx] = whiteR;
        pixels[idx + 1] = whiteG;
        pixels[idx + 2] = whiteB;
        pixels[idx + 3] = whiteA;
      }

      // Nose (small pink triangle)
      const noseY = center + faceRadius * 0.15;
      const noseWidth = faceRadius * 0.08;
      const noseHeight = faceRadius * 0.06;
      const noseDistFromCenter = y - noseY;
      if (noseDistFromCenter >= 0 && noseDistFromCenter <= noseHeight) {
        const noseW = noseWidth * (1 - noseDistFromCenter / noseHeight);
        if (Math.abs(x - center) <= noseW) {
          pixels[idx] = pinkR;
          pixels[idx + 1] = pinkG;
          pixels[idx + 2] = pinkB;
          pixels[idx + 3] = pinkA;
        }
      }

      // Mouth (simple curved line below nose)
      const mouthY = center + faceRadius * 0.22;
      const mouthWidth = faceRadius * 0.2;
      const mouthDist = Math.abs(y - mouthY);
      if (mouthDist < 2 && Math.abs(x - center) < mouthWidth) {
        const curve = (x - center) * (x - center) / (faceRadius * 0.15);
        if (y - mouthY > curve - 2) {
          pixels[idx] = darkR;
          pixels[idx + 1] = darkG;
          pixels[idx + 2] = darkB;
          pixels[idx + 3] = darkA;
        }
      }
    }
  }

  return encodePNG(pixels, size, size);
}

/**
 * Minimal PNG encoder.
 * Creates a valid PNG file from raw RGBA pixel data.
 */
function encodePNG(pixels, width, height) {
  // PNG uses deflate compression (zlib)
  const zlib = require('zlib');

  // Build raw image data: each row starts with filter byte 0 (None)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // Filter: None
    pixels.copy(rawData, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(rawData);

  // Build PNG file
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = createChunk('IHDR', (() => {
    const buf = Buffer.alloc(13);
    buf.writeUInt32BE(width, 0);
    buf.writeUInt32BE(height, 4);
    buf.writeUInt8(8, 8);   // Bit depth
    buf.writeUInt8(6, 9);   // Color type: RGBA
    buf.writeUInt8(0, 10);  // Compression
    buf.writeUInt8(0, 11);  // Filter
    buf.writeUInt8(0, 12);  // Interlace
    return buf;
  })());

  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

/**
 * Create a PNG chunk with CRC32.
 */
function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcInput);

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuf]);
}

/**
 * CRC32 lookup table and computation.
 */
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xEDB88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Run
generateIcon();
