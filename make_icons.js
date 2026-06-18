const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const iconDir = path.join(__dirname, "assets", "icons");
fs.mkdirSync(iconDir, { recursive: true });

const svg = Buffer.from(`
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="180" y1="120" x2="844" y2="904" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#191924"/>
      <stop offset="1" stop-color="#08080c"/>
    </linearGradient>
    <radialGradient id="disc" cx="50%" cy="42%" r="58%">
      <stop offset="0" stop-color="#242437"/>
      <stop offset="0.62" stop-color="#141420"/>
      <stop offset="1" stop-color="#0b0b10"/>
    </radialGradient>
    <filter id="shadow" x="-18%" y="-18%" width="136%" height="136%">
      <feDropShadow dx="0" dy="34" stdDeviation="34" flood-color="#000" flood-opacity="0.42"/>
    </filter>
  </defs>

  <rect x="64" y="64" width="896" height="896" rx="196" fill="url(#bg)"/>
  <circle cx="512" cy="488" r="334" fill="url(#disc)" filter="url(#shadow)"/>
  <circle cx="512" cy="488" r="300" fill="none" stroke="#2c2c3f" stroke-width="9"/>
  <circle cx="512" cy="488" r="246" fill="none" stroke="#272739" stroke-width="7"/>
  <circle cx="512" cy="488" r="190" fill="none" stroke="#232333" stroke-width="6"/>

  <circle cx="512" cy="488" r="132" fill="#1DB954"/>
  <rect x="454" y="494" width="20" height="66" rx="8" fill="#fff"/>
  <rect x="486" y="454" width="20" height="106" rx="8" fill="#fff"/>
  <rect x="518" y="476" width="20" height="84" rx="8" fill="#fff"/>
  <rect x="550" y="434" width="20" height="126" rx="8" fill="#fff"/>
  <circle cx="512" cy="488" r="18" fill="#101018"/>
</svg>`);

const pngSizes = [16, 24, 32, 48, 64, 128, 256];

function iconDirEntry(size, imageSize, imageOffset) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(imageSize, 8);
  entry.writeUInt32LE(imageOffset, 12);
  return entry;
}

async function png(size) {
  return sharp(svg)
    .resize(size, size, { fit: "contain" })
    .png()
    .toBuffer();
}

async function writeIco(entries, outputPath) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = header.length + entries.length * 16;
  const directory = [];
  for (const entry of entries) {
    directory.push(iconDirEntry(entry.size, entry.buffer.length, offset));
    offset += entry.buffer.length;
  }

  fs.writeFileSync(outputPath, Buffer.concat([header, ...directory, ...entries.map((entry) => entry.buffer)]));
}

async function main() {
  const entries = await Promise.all(pngSizes.map(async (size) => ({ size, buffer: await png(size) })));

  await writeIco(entries, path.join(iconDir, "icon.ico"));
  await sharp(svg).resize(512, 512).png().toFile(path.join(iconDir, "icon.png"));
  await sharp(svg).resize(32, 32).png().toFile(path.join(iconDir, "tray.png"));

  console.log("Wrote assets/icons/icon.ico, icon.png, and tray.png");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
