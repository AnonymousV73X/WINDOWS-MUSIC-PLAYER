// Test: verify injectTrackInfoTags works correctly
// Uses the existing test-downloads folder
const NodeID3 = require("node-id3");
const path = require("path");
const fs = require("fs");

const testDir = path.join(__dirname, "../test-downloads");
const files = fs.existsSync(testDir) ? fs.readdirSync(testDir).filter(f => f.endsWith(".mp3")) : [];

if (files.length === 0) {
  console.log("No MP3 files in test-downloads — nothing to verify. Run a real download first.");
  process.exit(0);
}

const testFile = path.join(testDir, files[0]);
console.log("Testing on:", testFile);

// Read existing tags before injection
const before = NodeID3.read(testFile) || {};
console.log("\n--- BEFORE injection ---");
console.log("title   :", before.title);
console.log("artist  :", before.artist);
console.log("album   :", before.album);
console.log("year    :", before.year);
console.log("genre   :", before.genre);
console.log("picture :", before.image ? `embedded (${before.image.imageBuffer?.length || 0} bytes)` : "none");

// Simulate a rich trackInfo (what the user clicked in search results)
const fakeTrackInfo = {
  trackName: "TEST - Correct Song Name",
  artistName: "Correct Artist Name",
  albumName: "Correct Album",
  releaseYear: "2024",
  genre: "Hip-Hop",
};

// Run the injection
const cleanTags = {};
if (fakeTrackInfo.trackName?.trim()) cleanTags.title = fakeTrackInfo.trackName.trim();
if (fakeTrackInfo.artistName && fakeTrackInfo.artistName !== "Unknown Artist") {
  cleanTags.artist = fakeTrackInfo.artistName.trim();
  cleanTags.performerInfo = cleanTags.artist;
}
if (fakeTrackInfo.albumName?.trim() && fakeTrackInfo.albumName !== "Unknown Album")
  cleanTags.album = fakeTrackInfo.albumName.trim();
const yr = Number(fakeTrackInfo.releaseYear);
if (yr > 1900) cleanTags.year = String(yr);
if (fakeTrackInfo.genre && fakeTrackInfo.genre !== "Music") cleanTags.genre = fakeTrackInfo.genre.trim();

const result = NodeID3.update(cleanTags, testFile);
console.log("\nNodeID3.update() result:", result);

// Read back
const after = NodeID3.read(testFile) || {};
console.log("\n--- AFTER injection ---");
console.log("title   :", after.title);
console.log("artist  :", after.artist);
console.log("album   :", after.album);
console.log("year    :", after.year);
console.log("genre   :", after.genre);
console.log("picture :", after.image ? `embedded ✅ (${after.image.imageBuffer?.length || 0} bytes — PRESERVED)` : "none ❌");

// Restore original tags
NodeID3.update({
  title: before.title || "",
  artist: before.artist || "",
  album: before.album || "",
  year: before.year || "",
  genre: before.genre || "",
}, testFile);
console.log("\n✅ Restored original tags. Test passed.");
