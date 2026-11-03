#!/usr/bin/env node
/**
 * zip.js — NovaTune release archiver
 *
 * Usage:  node zip.js
 *
 * What it does:
 *   1. Finds any existing NovaTune.*.zip in the project root
 *   2. Moves it to temps/ (creates temps/ if needed)
 *   3. Determines the next NATO phonetic name in sequence
 *   4. Creates NovaTune.<NatoName>.zip with the shareable source files
 *
 * Files included in the zip:
 *   assets/**          — icons, fonts, images
 *   main/**            — source JS (excludes *.bundle.js.map)
 *   renderer/**        — renderer source, styles, UI components, services
 *   package.json       — project manifest
 *   package-lock.json  — lockfile
 *   electron.config.js — build config
 *   esbuild.main.config.js
 *   LICENSE
 *   README.md
 *   .gitignore
 *
 * Files excluded:
 *   node_modules/      — too large, install with npm i
 *   dist/              — build output
 *   temps/             — archive folder
 *   scripts/           — internal dev/debug scripts
 *   scratch/           — dev scratch files
 *   data/              — user data (SQLite, etc.)
 *   playlists/         — user playlists
 *   bin/               — binaries (yt-dlp.exe, etc.)
 *   screenshots/       — dev screenshots
 *   NOTES/             — personal notes
 *   test-downloads/    — test artifacts
 *   *.bundle.js.map    — sourcemaps (huge, not needed)
 *   Any existing *.zip files
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zl   = require('node:zlib');
const { execSync } = require('child_process');

// ─── NATO phonetic alphabet in order ──────────────────────────────────────────
const NATO = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
  'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa',
  'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey',
  'Xray', 'Yankee', 'Zulu',
];

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT  = __dirname;
const TEMPS = path.join(ROOT, 'temps');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find an existing NovaTune.*.zip in the root dir */
function findExistingZip() {
  return fs.readdirSync(ROOT)
    .filter(f => /^NovaTune\.\w+\.zip$/i.test(f))
    .map(f => path.join(ROOT, f))[0] || null;
}

/** Extract the NATO name from a zip filename like NovaTune.Foxtrot.zip */
function extractNatoName(zipPath) {
  const base  = path.basename(zipPath, '.zip');           // NovaTune.Foxtrot
  const parts = base.split('.');
  return parts[1] || null;                                // Foxtrot
}

/** Given the current NATO name, return the next one */
function nextNatoName(current) {
  if (!current) return NATO[0];
  const idx = NATO.findIndex(n => n.toLowerCase() === current.toLowerCase());
  if (idx === -1) return NATO[0];                         // unknown → restart
  if (idx + 1 >= NATO.length) {
    console.error('✖  Exhausted all NATO names (Zulu was the last)!');
    process.exit(1);
  }
  return NATO[idx + 1];
}

/** Walk a directory recursively, yielding absolute file paths */
function* walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkDir(full);
    else yield full;
  }
}

// ─── What to include ──────────────────────────────────────────────────────────

/**
 * Folders to include (relative to ROOT).
 * Everything inside is added unless the file-level filter rejects it.
 */
const INCLUDE_DIRS = ['assets', 'main', 'renderer'];

/** Root-level files to include explicitly */
const INCLUDE_ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'electron.config.js',
  'esbuild.main.config.js',
  'LICENSE',
  'README.md',
  '.gitignore',
];

/** Per-file filter — return true to EXCLUDE */
function shouldExclude(absPath) {
  const rel = path.relative(ROOT, absPath).replace(/\\/g, '/');
  // Sourcemaps are huge and not useful for sharing
  if (rel.endsWith('.bundle.js.map')) return true;
  // Any zip files that somehow end up in included dirs
  if (rel.endsWith('.zip'))           return true;
  return false;
}

// ─── Collect entries ──────────────────────────────────────────────────────────

function collectEntries() {
  const entries = []; // { absPath, zipEntry }

  // Directories
  for (const dirName of INCLUDE_DIRS) {
    const dirAbs = path.join(ROOT, dirName);
    if (!fs.existsSync(dirAbs)) {
      console.warn(`  ⚠  Skipping missing directory: ${dirName}/`);
      continue;
    }
    for (const absPath of walkDir(dirAbs)) {
      if (shouldExclude(absPath)) continue;
      const zipEntry = path.relative(ROOT, absPath).replace(/\\/g, '/');
      entries.push({ absPath, zipEntry });
    }
  }

  // Root-level files
  for (const fname of INCLUDE_ROOT_FILES) {
    const absPath = path.join(ROOT, fname);
    if (!fs.existsSync(absPath)) {
      console.warn(`  ⚠  Skipping missing file: ${fname}`);
      continue;
    }
    entries.push({ absPath, zipEntry: fname });
  }

  return entries;
}

// ─── Build zip using PowerShell (no external npm deps needed) ─────────────────

function buildZip(entries, destZip) {
  // Write a temp manifest file listing all source→entry pairs
  const manifest = entries
    .map(e => `${e.absPath}\t${e.zipEntry}`)
    .join('\n');
  const manifestPath = path.join(ROOT, 'temps', '_zip_manifest.txt');
  fs.writeFileSync(manifestPath, manifest, 'utf8');

  const ps = `
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$destZip = '${destZip.replace(/\\/g, '\\\\')}'
$manifestPath = '${manifestPath.replace(/\\/g, '\\\\')}'

$stream = [System.IO.File]::Open($destZip, [System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)

$lines = Get-Content $manifestPath -Encoding UTF8
$count = 0
foreach ($line in $lines) {
  $parts = $line.Split("\`t")
  $srcPath  = $parts[0]
  $zipEntry = $parts[1]
  if (-not (Test-Path $srcPath)) { Write-Host "  SKIP (missing): $zipEntry"; continue }
  $entry = $zip.CreateEntry($zipEntry, [System.IO.Compression.CompressionLevel]::Optimal)
  $entryStream = $entry.Open()
  $srcStream = [System.IO.File]::OpenRead($srcPath)
  $srcStream.CopyTo($entryStream)
  $srcStream.Dispose()
  $entryStream.Dispose()
  $count++
}

$zip.Dispose()
$stream.Dispose()
Write-Host "  Zipped $count files"
`.trim();

  const psScript = path.join(ROOT, 'temps', '_zip_build.ps1');
  fs.writeFileSync(psScript, ps, 'utf8');

  try {
    const out = execSync(
      `powershell -ExecutionPolicy Bypass -File "${psScript}"`,
      { encoding: 'utf8', cwd: ROOT }
    );
    console.log(out.trim());
  } finally {
    // Cleanup temp files
    if (fs.existsSync(psScript))   fs.unlinkSync(psScript);
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('\n🎵  NovaTune Release Archiver\n');

  // 1. Ensure temps/ exists
  if (!fs.existsSync(TEMPS)) {
    fs.mkdirSync(TEMPS, { recursive: true });
    console.log('  Created temps/');
  }

  // 2. Move any existing zip to temps/
  const existingZip = findExistingZip();
  let currentNatoName = null;

  if (existingZip) {
    currentNatoName = extractNatoName(existingZip);
    const destInTemps = path.join(TEMPS, path.basename(existingZip));
    fs.renameSync(existingZip, destInTemps);
    console.log(`  📦  Archived existing zip → temps/${path.basename(existingZip)}`);
  } else {
    // Peek at temps/ to figure out the last used NATO name
    const archived = fs.readdirSync(TEMPS)
      .filter(f => /^NovaTune\.\w+\.zip$/i.test(f))
      .sort((a, b) => {
        const ai = NATO.findIndex(n => a.toLowerCase().includes(n.toLowerCase()));
        const bi = NATO.findIndex(n => b.toLowerCase().includes(n.toLowerCase()));
        return ai - bi;
      });
    if (archived.length > 0) {
      currentNatoName = extractNatoName(archived[archived.length - 1]);
      console.log(`  ℹ  No zip in root; last archived was: ${path.basename(archived[archived.length - 1])}`);
    } else {
      console.log('  ℹ  No existing zip found — starting fresh from Alpha');
    }
  }

  // 3. Determine next NATO name
  const natoName = nextNatoName(currentNatoName);
  const destZipName = `NovaTune.${natoName}.zip`;
  const destZip     = path.join(ROOT, destZipName);

  console.log(`  🔤  Next release name: ${natoName}`);
  console.log(`  📁  Output: ${destZipName}\n`);

  // 4. Collect files
  const entries = collectEntries();
  console.log(`  🗂  Collected ${entries.length} files to zip...\n`);

  // 5. Build zip
  buildZip(entries, destZip);

  // 6. Report
  const size = (fs.statSync(destZip).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅  Created: ${destZipName}  (${size} MB)`);
  if (existingZip) {
    console.log(`   Old zip archived to: temps/${path.basename(existingZip)}`);
  }
  console.log('');
}

main();
