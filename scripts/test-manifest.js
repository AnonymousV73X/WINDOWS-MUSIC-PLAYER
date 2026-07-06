/**
 * NovaTune — Manifest round-trip test
 * Verifies the writer → reader → lookup pipeline works end-to-end
 * with a small synthetic library. Run with:
 *   node scripts/test-manifest.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const ManifestWriter = require("../main/manifest");
const ManifestReader = require("../main/manifestReader");

function makeTrack(i) {
  const filePath = `C:/Users/user/Music/${String(i).padStart(2,"0")}.mp3`;
  return {
    id: crypto.createHash("sha256").update(filePath).digest("hex").substring(0, 16),
    filePath,
    fileName: path.basename(filePath),
    title: `Test Track ${i}`,
    artist: i % 3 === 0 ? "Unknown Artist" : `Artist ${i % 5}`,
    album: i % 4 === 0 ? "Unknown Album" : `Album ${i % 7}`,
    albumArtist: "",
    genre: i % 2 === 0 ? "Electronic" : "Jazz",
    year: 1990 + i,
    trackNumber: i,
    discNumber: 1,
    duration: 120.5 + i,
    bitrate: 320,
    sampleRate: 44100,
    channels: 2,
    format: "MP3",
    _hasCoverArt: i % 5 !== 0,
    _thumbHash: i % 3 === 0 ? "AAAAYe" + btoa(String(i)).slice(0, 20) : null,
    fileSize: 1000000 + i,
    dateAdded: Date.now() - i * 1000,
    dateModified: Date.now() - i * 100,
  };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "novatune-test-"));
const manifestPath = path.join(tmpDir, "library.bin");

try {
  // ── Build tracks ──
  const N = 100;
  const tracks = [];
  for (let i = 0; i < N; i++) tracks.push(makeTrack(i));
  console.log(`Built ${tracks.length} synthetic tracks.`);

  // ── Write manifest ──
  const writeResult = ManifestWriter.writeSync(manifestPath, tracks, {
    folderFingerprint: "test-folder-fp",
  });
  console.log(`Wrote manifest: ${writeResult.size}B, ${writeResult.ms}ms`);

  // ── Read manifest ──
  const buf = fs.readFileSync(manifestPath);
  const reader = new ManifestReader(buf);
  if (!reader.valid) {
    console.error("FAIL: reader invalid:", reader.error);
    process.exit(1);
  }
  console.log(`Reader valid. trackCount=${reader.trackCount}, version=${reader.version}, flags=0x${reader.flags.toString(16)}`);
  console.log(`  Available sort orders: [${reader.getAvailableSortOrders().join(", ")}]`);

  // ── Verify all tracks decode correctly ──
  let mismatches = 0;
  const originalById = new Map(tracks.map(t => [t.id, t]));
  for (let i = 0; i < reader.trackCount; i++) {
    const decoded = reader.getTrackAt(i);
    const orig = originalById.get(decoded.id);
    if (!orig) { mismatches++; continue; }
    // Compare key fields
    if (decoded.title !== orig.title ||
        decoded.artist !== orig.artist ||
        decoded.album !== orig.album ||
        decoded.filePath !== orig.filePath ||
        Math.abs(decoded.duration - orig.duration) > 0.01 ||
        decoded.year !== orig.year ||
        decoded.trackNumber !== orig.trackNumber ||
        decoded.format !== orig.format ||
        decoded._hasCoverArt !== orig._hasCoverArt ||
        decoded.fileSize !== orig.fileSize ||
        decoded.dateAdded !== orig.dateAdded ||
        decoded.dateModified !== orig.dateModified) {
      console.error(`  MISMATCH at idx ${i} (id=${decoded.id}):`);
      console.error("    orig:", JSON.stringify(orig, null, 2).split("\n").slice(0, 5).join("\n"));
      console.error("    dec :", JSON.stringify(decoded, null, 2).split("\n").slice(0, 5).join("\n"));
      mismatches++;
      if (mismatches > 3) break;
    }
  }
  if (mismatches > 0) {
    console.error(`FAIL: ${mismatches} mismatches found.`);
    process.exit(1);
  }
  console.log(`  All ${reader.trackCount} tracks decoded correctly. ✓`);

  // ── Test findById (binary search) ──
  const sampleId = tracks[42].id;
  const t0 = process.hrtime.bigint();
  const found = reader.findById(sampleId);
  const t1 = process.hrtime.bigint();
  if (!found || found.id !== sampleId) {
    console.error(`FAIL: findById(${sampleId}) returned ${found ? found.id : "null"}`);
    process.exit(1);
  }
  console.log(`  findById(${sampleId}) → ${found.title} in ${Number(t1 - t0) / 1e6}ms ✓`);

  // ── Test findByFilePath (hash lookup) ──
  const samplePath = tracks[42].filePath;
  const t2 = process.hrtime.bigint();
  const foundByPath = reader.findByFilePath(samplePath);
  const t3 = process.hrtime.bigint();
  if (!foundByPath || foundByPath.id !== sampleId) {
    console.error(`FAIL: findByFilePath(${samplePath}) returned ${foundByPath ? foundByPath.id : "null"}`);
    process.exit(1);
  }
  console.log(`  findByFilePath(${samplePath}) → ${foundByPath.title} in ${Number(t3 - t2) / 1e6}ms ✓`);

  // ── Test findByFilePath with normalized path (different slashes) ──
  const samplePathBack = samplePath.replace(/\//g, "\\").toUpperCase();
  const foundByBackPath = reader.findByFilePath(samplePathBack);
  if (!foundByBackPath || foundByBackPath.id !== sampleId) {
    console.error(`FAIL: findByFilePath(${samplePathBack}) returned ${foundByBackPath ? foundByBackPath.id : "null"}`);
    process.exit(1);
  }
  console.log(`  findByFilePath with backslashes+uppercase → same track ✓ (path normalization works)`);

  // ── Test sort orders ──
  const sortTitle = reader.getSortOrder("sortTitleAsc");
  if (!sortTitle) { console.error("FAIL: sortTitleAsc missing"); process.exit(1); }
  // Verify the sort is actually correct
  let sortOk = true;
  for (let i = 1; i < sortTitle.length; i++) {
    const a = reader.getTrackAt(sortTitle[i - 1]).title.toLowerCase();
    const b = reader.getTrackAt(sortTitle[i]).title.toLowerCase();
    if (a > b) { sortOk = false; break; }
  }
  if (!sortOk) { console.error("FAIL: sortTitleAsc is not actually sorted"); process.exit(1); }
  console.log(`  sortTitleAsc verified (length=${sortTitle.length}) ✓`);

  // ── Test range decode ──
  const range = reader.getTracksRange(0, 10, "sortDateAddedDesc");
  if (range.length !== 10) {
    console.error(`FAIL: range length ${range.length}, expected 10`);
    process.exit(1);
  }
  // sortDateAddedDesc: highest dateAdded first
  for (let i = 1; i < range.length; i++) {
    if (range[i].dateAdded > range[i - 1].dateAdded) {
      console.error(`FAIL: sortDateAddedDesc not descending at idx ${i}: ${range[i].dateAdded} > ${range[i - 1].dateAdded}`);
      process.exit(1);
    }
  }
  console.log(`  getTracksRange(0, 10, sortDateAddedDesc) verified ✓`);

  // ── Test corrupt manifest detection ──
  const corruptBuf = Buffer.from(buf);
  corruptBuf[20] = corruptBuf[20] ^ 0xff; // flip a bit in trackCount
  const corruptReader = new ManifestReader(corruptBuf);
  if (corruptReader.valid) {
    console.error("FAIL: corrupt manifest should be invalid");
    process.exit(1);
  }
  console.log(`  Corrupt manifest correctly rejected: "${corruptReader.error}" ✓`);

  // ── Test empty library ──
  const emptyPath = path.join(tmpDir, "empty.bin");
  ManifestWriter.writeSync(emptyPath, [], { folderFingerprint: "" });
  const emptyBuf = fs.readFileSync(emptyPath);
  const emptyReader = new ManifestReader(emptyBuf);
  if (!emptyReader.valid) { console.error("FAIL: empty manifest should be valid:", emptyReader.error); process.exit(1); }
  if (emptyReader.trackCount !== 0) { console.error("FAIL: empty manifest trackCount should be 0"); process.exit(1); }
  console.log(`  Empty manifest: trackCount=0 ✓`);

  console.log("\nAll round-trip tests passed! ✓");
} finally {
  try { fs.unlinkSync(manifestPath); } catch (_) {}
  try { fs.rmdirSync(tmpDir); } catch (_) {}
}
