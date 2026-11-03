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
  // Matches NovaTune.Golf.zip  OR  NovaTune.Golf-II.zip  OR  NovaTune.Golf-III.zip
  return fs.readdirSync(ROOT)
    .filter(f => /^NovaTune\.[A-Za-z]+(-[IVX]+)?\.zip$/i.test(f))
    .map(f => path.join(ROOT, f))[0] || null;
}

/**
 * Parse a zip filename into { name, cycle }.
 *   NovaTune.Golf.zip      → { name: 'Golf',  cycle: 1 }
 *   NovaTune.Golf-II.zip   → { name: 'Golf',  cycle: 2 }
 *   NovaTune.Zulu-III.zip  → { name: 'Zulu',  cycle: 3 }
 */
function parseNatoToken(zipPath) {
  const base  = path.basename(zipPath, '.zip');         // e.g. NovaTune.Golf-II
  const token = base.split('.')[1] || '';               // e.g. Golf-II
  const [name, suffix] = token.split('-');              // ['Golf', 'II'] or ['Golf', undefined]
  const cycle = suffix ? fromRoman(suffix) : 1;
  return { name, cycle };
}

/** Build a zip filename token from { name, cycle } */
function formatNatoToken({ name, cycle }) {
  return cycle === 1 ? name : `${name}-${toRoman(cycle)}`;
}

/** Given the current NATO token, return the next one (cycles forever) */
function nextNatoToken(current) {
  if (!current) return { name: NATO[0], cycle: 1 };

  const { name, cycle } = current;
  const idx = NATO.findIndex(n => n.toLowerCase() === name.toLowerCase());

  if (idx === -1) return { name: NATO[0], cycle: 1 };   // unknown → restart

  if (idx + 1 < NATO.length) {
    // Still letters left in this cycle
    return { name: NATO[idx + 1], cycle };
  } else {
    // Finished Zulu — start next cycle: Alpha-II, Bravo-II, …
    return { name: NATO[0], cycle: cycle + 1 };
  }
}

// ─── Roman numeral helpers (supports up to ~40 cycles, way more than enough) ──

const ROMAN_MAP = [
  [1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],
  [100,'C'], [90,'XC'], [50,'L'], [40,'XL'],
  [10,'X'],  [9,'IX'],  [5,'V'],  [4,'IV'],  [1,'I'],
];

function toRoman(n) {
  let result = '';
  for (const [val, sym] of ROMAN_MAP) {
    while (n >= val) { result += sym; n -= val; }
  }
  return result;
}

function fromRoman(s) {
  const vals = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur  = vals[s[i].toUpperCase()] || 0;
    const next = vals[(s[i+1] || '').toUpperCase()] || 0;
    total += cur < next ? -cur : cur;
  }
  return total || 1;
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
  let currentToken = null;

  if (existingZip) {
    currentToken = parseNatoToken(existingZip);
    const destInTemps = path.join(TEMPS, path.basename(existingZip));
    fs.renameSync(existingZip, destInTemps);
    console.log(`  📦  Archived existing zip → temps/${path.basename(existingZip)}`);
  } else {
    // Peek at temps/ to figure out the last used NATO token
    const archived = fs.readdirSync(TEMPS)
      .filter(f => /^NovaTune\.[A-Za-z]+(-[IVX]+)?\.zip$/i.test(f))
      .sort((a, b) => {
        const ta = parseNatoToken(path.join(TEMPS, a));
        const tb = parseNatoToken(path.join(TEMPS, b));
        // Sort by cycle first, then by NATO index within that cycle
        if (ta.cycle !== tb.cycle) return ta.cycle - tb.cycle;
        const ai = NATO.findIndex(n => n.toLowerCase() === ta.name.toLowerCase());
        const bi = NATO.findIndex(n => n.toLowerCase() === tb.name.toLowerCase());
        return ai - bi;
      });
    if (archived.length > 0) {
      currentToken = parseNatoToken(path.join(TEMPS, archived[archived.length - 1]));
      console.log(`  ℹ  No zip in root; last archived was: ${archived[archived.length - 1]}`);
    } else {
      console.log('  ℹ  No existing zip found — starting fresh from Alpha');
    }
  }

  // 3. Determine next NATO token
  const nextToken   = nextNatoToken(currentToken);
  const natoLabel   = formatNatoToken(nextToken);
  const destZipName = `NovaTune.${natoLabel}.zip`;
  const destZip     = path.join(ROOT, destZipName);

  // Human-friendly cycle description
  const cycleDesc = nextToken.cycle === 1
    ? ''
    : `  (cycle ${toRoman(nextToken.cycle)} — wrapped past Zulu ${nextToken.cycle - 1} time${nextToken.cycle > 2 ? 's' : ''})`;

  console.log(`  🔤  Next release name: ${natoLabel}${cycleDesc}`);
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
