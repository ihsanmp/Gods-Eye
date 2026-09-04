/**
 * Build app/GodsEyeView.ico from public/logo.svg.
 *
 * Windows shortcuts need a real .ico; the project only ships an SVG. Sharp is
 * already a devDependency (it renders the QA screenshots), so this needs no new
 * install. The ICO is assembled by hand because sharp has no .ico encoder:
 * modern Windows reads PNG-payload ICO entries directly, so each size is just a
 * PNG blob behind a 16-byte directory record.
 *
 *   node app/make-icon.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(APP_DIR, '..');

/** Windows picks the nearest size per surface: tray/list, desktop, then jumbo. */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * The logo is a wide viewBox (775x520) on transparency. Squaring it with
 * `contain` keeps the aspect ratio and centres it, so the icon never stretches.
 * The dark backdrop matches the app's own ground — a transparent icon
 * disappears against a dark taskbar.
 */
const BACKDROP = { r: 12, g: 19, b: 22, alpha: 255 };

async function renderPng(svg, size) {
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .flatten({ background: BACKDROP })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Assemble an ICO container around already-encoded PNG buffers.
 * @param {Array<{size: number, data: Buffer}>} images
 * @returns {Buffer}
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  // Payloads start after the header and the whole directory.
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const at = index * 16;
    // 256 is stored as 0 — the field is one byte, so 256 does not fit.
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, at + 0);
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1);
    directory.writeUInt8(0, at + 2); // palette colours (0 = truecolour)
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

const svg = await readFile(path.join(ROOT, 'public', 'logo.svg'));
const images = [];
for (const size of SIZES) {
  images.push({ size, data: await renderPng(svg, size) });
}

const target = path.join(APP_DIR, 'GodsEyeView.ico');
await writeFile(target, buildIco(images));
console.log(`Wrote ${target} (${SIZES.join(', ')} px)`);
