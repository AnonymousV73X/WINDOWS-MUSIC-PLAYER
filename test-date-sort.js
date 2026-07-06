// Test script to verify date sorting fix
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "data", "library.db");

// Create test database
const db = new Database(DB_PATH);

// Initialize schema if needed
db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    album TEXT,
    genre TEXT,
    year INTEGER,
    duration INTEGER,
    dateAdded INTEGER,
    filePath TEXT,
    data TEXT
  );
`);

// Get all tracks and check dateAdded values
const tracks = db
  .prepare(
    "SELECT id, title, filePath, dateAdded FROM tracks ORDER BY dateAdded DESC LIMIT 10",
  )
  .all();

console.log("Tracks sorted by dateAdded (DESC):");
console.log("==================================");
tracks.forEach((track, idx) => {
  const date = new Date(track.dateAdded);
  const fileExists = fs.existsSync(track.filePath);
  console.log(`${idx + 1}. ${track.title}`);
  console.log(`   dateAdded: ${track.dateAdded} (${date.toISOString()})`);
  console.log(`   File exists: ${fileExists}`);
  if (fileExists) {
    const stats = fs.statSync(track.filePath);
    const mtime = Math.floor(stats.mtimeMs);
    console.log(`   File mtime: ${mtime} (${new Date(mtime).toISOString()})`);
    console.log(
      `   Match: ${track.dateAdded === mtime ? "YES" : "NO - refresh needed"}`,
    );
  }
  console.log();
});

console.log(
  `Total tracks in database: ${db.prepare("SELECT COUNT(*) as count FROM tracks").get().count}`,
);

db.close();
