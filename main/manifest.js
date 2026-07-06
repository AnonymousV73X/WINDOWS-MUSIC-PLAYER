/**
 * NovaTune — Binary Manifest Writer  (pure JS, zero deps)
 * ─────────────────────────────────────────────────────────────────────────
 * Counterpart to main/manifestReader.js. Builds library.bin from the
 * array of track objects that saveLibrary() already produces.
 *
 * WHY THIS IS FAST
 *   - Single fs.writeFile of one contiguous Buffer (no row-by-row inserts)
 *   - String dedup means "Unknown Album" is written once for the whole library
 *   - Records are 128 bytes flat → readers can seek by `recordsOff + i*128`
 *   - Sort orders are pre-computed once at write time, never at startup
 *
 * INVARIANTS
 *   - Records are sorted by id (16-byte ASCII hex) so readers can binary-search
 *   - String offsets are absolute (from file start), not relative
 *   - File is sealed with FLAG_SEALED only after CRC32 of header is computed
 *   - Writer is crash-safe: an unsealed file is rejected by the reader
 *
 * CRASH SAFETY
 *   The writer builds the entire Buffer in memory, computes the header CRC,
 *   sets FLAG_SEALED, then writes atomically with a temp-file + rename.
 *   If the process dies mid-write, the temp file is left behind (orphaned)
 *   and the next reader sees a missing or unsealed manifest and falls
 *   back to SQLite — exactly the safety net we want.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const ManifestReader = require("./manifestReader");

const {
  MAGIC,
  VERSION,
  HEADER_SIZE,
  RECORD_SIZE,
  HASH_EMPTY,
  FLAG_HAS_THUMBHASHES,
  FLAG_HAS_SORT_ORDERS,
  FLAG_SEALED,
  FORMAT_ENUM,
  SORT_ORDERS,
  crc32,
  fnv1a,
  normalizePath,
} = ManifestReader;

// ─── Helpers ────────────────────────────────────────────────────────
function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Format enum reverse lookup: "MP3" → 1, "FLAC" → 2, ...
 */
function formatToEnum(formatStr) {
  if (!formatStr) return 0;
  const up = String(formatStr).toUpperCase();
  return FORMAT_ENUM[up] || 0;
}

/**
 * Validate a track ID is exactly 16 ASCII hex chars.
 * If it's not (legacy tracks used a different scheme), we still write
 * it but the reader's binary-search may not work for that record.
 */
function normalizeId(id) {
  if (!id) return "0000000000000000";
  let s = String(id);
  if (s.length > 16) s = s.substring(0, 16);
  else if (s.length < 16) s = s.padEnd(16, "0");
  return s;
}

// ─── String pool with dedup ─────────────────────────────────────────
class StringPool {
  /**
   * @param {number} baseOffset  Absolute offset in the file where the
   *   string pool will be written (i.e. recordsOff + recordsBuf.length).
   *   We need this because records reference strings by ABSOLUTE offset,
   *   and the string pool's location isn't known until we've sized the
   *   records section — which happens BEFORE we add strings.
   *
   * Workaround: compute baseOffset up front (it's deterministic:
   *   HEADER_SIZE + trackCount * RECORD_SIZE) and pass it in.
   */
  constructor(baseOffset) {
    this.baseOffset = baseOffset;
    this.chunks = [];
    this.totalLen = 0;
    /** @type {Map<string, {off:number,len:number}>} */
    this.dedup = new Map();
  }

  /**
   * Add a string and return its (offset, length).
   * Empty strings get offset 0 length 0 (we never legitimately point
   * at byte 0 of the file because the header sits there; readers
   * interpret offset 0 length 0 as "empty" — and for thumbhash,
   * offset 0 means "no thumbhash").
   */
  add(str) {
    if (!str) return { off: 0, len: 0 };
    const s = String(str);
    const cached = this.dedup.get(s);
    if (cached) return cached;

    const off = this.baseOffset + this.totalLen;
    const buf = Buffer.from(s, "utf8");
    const len = buf.length;
    this.chunks.push(buf);
    this.totalLen += len;
    const entry = { off, len };
    this.dedup.set(s, entry);
    return entry;
  }

  toBuffer() {
    if (this.chunks.length === 0) return Buffer.alloc(0);
    return Buffer.concat(this.chunks, this.totalLen);
  }
}

// ─── Manifest Writer ────────────────────────────────────────────────
class ManifestWriter {
  /**
   * Build the manifest Buffer from an array of track objects.
   * Does NOT write to disk — caller can use writeManifest() for that.
   *
   * @param {Object[]} tracks  Array of track objects (same shape as SQLite rows)
   * @param {Object}  [opts]
   * @param {string}  [opts.folderFingerprint]  Folder fingerprint string (hash is stored)
   * @returns {Buffer}
   */
  static build(tracks, opts = {}) {
    const trackCount = tracks.length;
    // Compute the absolute offset where the string pool will live.
    // Records come first (right after the header), strings come after.
    const recordsOff = HEADER_SIZE;
    const stringsBaseOffset = recordsOff + trackCount * RECORD_SIZE;
    const pool = new StringPool(stringsBaseOffset);

    // ── 1. Sort records by id so reader can binary-search ──
    const sorted = tracks.slice().sort((a, b) => {
      const ai = normalizeId(a.id);
      const bi = normalizeId(b.id);
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });

    // ── 2. Build records section (128 bytes each) ──
    const recordsBuf = Buffer.alloc(trackCount * RECORD_SIZE);
    let hasThumbhashes = false;

    for (let i = 0; i < trackCount; i++) {
      const t = sorted[i];
      const off = i * RECORD_SIZE;

      // id[16] — ASCII bytes
      const id = normalizeId(t.id);
      recordsBuf.write(id, off, 16, "ascii");

      // String fields
      const fp = pool.add(t.filePath || "");
      recordsBuf.writeUInt32LE(fp.off, off + 16);
      recordsBuf.writeUInt32LE(fp.len, off + 20);

      const fn = pool.add(t.fileName || "");
      recordsBuf.writeUInt32LE(fn.off, off + 24);
      recordsBuf.writeUInt32LE(fn.len, off + 28);

      const ti = pool.add(t.title || "");
      recordsBuf.writeUInt32LE(ti.off, off + 32);
      recordsBuf.writeUInt32LE(ti.len, off + 36);

      const ar = pool.add(t.artist || "");
      recordsBuf.writeUInt32LE(ar.off, off + 40);
      recordsBuf.writeUInt32LE(ar.len, off + 44);

      const al = pool.add(t.album || "");
      recordsBuf.writeUInt32LE(al.off, off + 48);
      recordsBuf.writeUInt32LE(al.len, off + 52);

      const aa = pool.add(t.albumArtist || "");
      recordsBuf.writeUInt32LE(aa.off, off + 56);
      recordsBuf.writeUInt32LE(aa.len, off + 60);

      const ge = pool.add(t.genre || "");
      recordsBuf.writeUInt32LE(ge.off, off + 64);
      recordsBuf.writeUInt32LE(ge.len, off + 68);

      // thumbHash (off=0 means none)
      if (t._thumbHash) {
        const th = pool.add(t._thumbHash);
        // Note: thumbHash strings are short (~25 chars) and rarely dedup,
        // but the dedup table still handles them correctly.
        recordsBuf.writeUInt32LE(th.off, off + 72);
        recordsBuf.writeUInt16LE(Math.min(th.len, 0xffff), off + 76);
        hasThumbhashes = true;
      } else {
        recordsBuf.writeUInt32LE(0, off + 72);
        recordsBuf.writeUInt16LE(0, off + 76);
      }

      // Numeric fields
      recordsBuf.writeUInt16LE(Math.min(t.year || 0, 0xffff), off + 78);
      recordsBuf.writeUInt16LE(Math.min(t.trackNumber || 0, 0xffff), off + 80);
      recordsBuf.writeUInt16LE(Math.min(t.discNumber || 0, 0xffff), off + 82);
      recordsBuf.writeFloatLE(Number(t.duration) || 0, off + 84);
      recordsBuf.writeUInt32LE(Math.min(t.bitrate || 0, 0xffffffff), off + 88);
      recordsBuf.writeUInt32LE(
        Math.min(t.sampleRate || 0, 0xffffffff),
        off + 92,
      );
      recordsBuf.writeUInt8(Math.min(t.channels || 2, 0xff), off + 96);
      recordsBuf.writeUInt8(formatToEnum(t.format), off + 97);
      recordsBuf.writeUInt8(t._hasCoverArt || t.coverArt ? 1 : 0, off + 98);
      recordsBuf.writeUInt8(0, off + 99); // flags (reserved)

      // u64 fields — write as lo+hi (V8 Number is f64, safe up to 2^53)
      writeU64LE(
        recordsBuf,
        off + 100,
        Math.min(t.fileSize || 0, Number.MAX_SAFE_INTEGER),
      );
      writeU64LE(
        recordsBuf,
        off + 108,
        Math.min(t.dateAdded || 0, Number.MAX_SAFE_INTEGER),
      );
      writeU64LE(
        recordsBuf,
        off + 116,
        Math.min(t.dateModified || 0, Number.MAX_SAFE_INTEGER),
      );

      // off+124..127: reserved (already zeroed by Buffer.alloc)
    }

    // ── 3. Build hash table (filePath → recordIdx) ──
    // Slot count = next power of 2 ≥ 2 * trackCount (load factor ≤ 0.5)
    const slotCount = trackCount === 0 ? 16 : nextPow2(trackCount * 2);
    const slotMask = slotCount - 1;
    const indexBuf = Buffer.alloc(slotCount * 4, 0xff); // 0xFFFFFFFF = empty
    for (let i = 0; i < trackCount; i++) {
      const t = sorted[i];
      const key = normalizePath(t.filePath || t.id || String(i));
      let slot = fnv1a(key) & slotMask;
      // Linear probe
      while (indexBuf.readUInt32LE(slot * 4) !== HASH_EMPTY)
        slot = (slot + 1) & slotMask;
      indexBuf.writeUInt32LE(i, slot * 4);
    }

    // ── 4. Build sort orders ──
    // Precompute all four so the renderer never re-sorts at startup.
    const sortTitleAsc = buildSortIndices(sorted, (a, b) => {
      const ta = (a.title || "").toLowerCase();
      const tb = (b.title || "").toLowerCase();
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    const sortDateAddedDesc = buildSortIndices(sorted, (a, b) => {
      const da = a.dateAdded || 0;
      const db = b.dateAdded || 0;
      if (db !== da) return db - da;
      const ta = (a.title || "").toLowerCase();
      const tb = (b.title || "").toLowerCase();
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    const sortAlbumAsc = buildSortIndices(sorted, (a, b) => {
      const aa = (a.album || "").toLowerCase();
      const bb = (b.album || "").toLowerCase();
      if (aa !== bb) return aa < bb ? -1 : 1;
      const da = a.discNumber || 0;
      const db = b.discNumber || 0;
      if (da !== db) return da - db;
      return (a.trackNumber || 0) - (b.trackNumber || 0);
    });
    const sortArtistAsc = buildSortIndices(sorted, (a, b) => {
      const aa = (a.artist || "").toLowerCase();
      const bb = (b.artist || "").toLowerCase();
      if (aa !== bb) return aa < bb ? -1 : 1;
      const la = (a.album || "").toLowerCase();
      const lb = (b.album || "").toLowerCase();
      if (la !== lb) return la < lb ? -1 : 1;
      const da = a.discNumber || 0;
      const db = b.discNumber || 0;
      if (da !== db) return da - db;
      return (a.trackNumber || 0) - (b.trackNumber || 0);
    });

    // Sort section: 32-byte header + 4 arrays of u32 (trackCount each)
    // The header stores ABSOLUTE file offsets (not relative to sortOff) so
    // the reader can wrap them directly in a Uint32Array view without
    // needing to know sortOff.
    //
    // Layout:
    //   sortOff + 0   sortTitleOff       (absolute)
    //   sortOff + 4   sortTitleCount
    //   sortOff + 8   sortDateAddedOff   (absolute)
    //   ... etc
    //   sortOff + 32  sortTitleAsc data (trackCount * 4 bytes)
    //   sortOff + 32 + trackCount*4  sortDateAddedDesc data
    //   ...
    //
    // We can compute sortOff now because all preceding sections are
    // already sized:
    //   recordsOff = HEADER_SIZE
    //   stringsOff = recordsOff + recordsBuf.length
    //   indexOff   = stringsOff + stringsBuf.length
    //   sortOff    = indexOff + indexBuf.length
    const stringsOffPrecomputed = recordsOff + recordsBuf.length;
    const indexOffPrecomputed = stringsOffPrecomputed + pool.totalLen;
    const sortOffPrecomputed = indexOffPrecomputed + indexBuf.length;
    const sortArraysStart = sortOffPrecomputed + 32;

    const sortHeaderBuf = Buffer.alloc(32);
    const sortArrays = [
      sortTitleAsc,
      sortDateAddedDesc,
      sortAlbumAsc,
      sortArtistAsc,
    ];
    const sortArraysBuf = Buffer.alloc(trackCount * 4 * 4);
    for (let i = 0; i < 4; i++) {
      // Absolute offset of array i within the file
      const absOff = sortArraysStart + i * trackCount * 4;
      sortHeaderBuf.writeUInt32LE(absOff, i * 8);
      sortHeaderBuf.writeUInt32LE(trackCount, i * 8 + 4);
      for (let j = 0; j < trackCount; j++)
        sortArraysBuf.writeUInt32LE(
          sortArrays[i][j],
          i * trackCount * 4 + j * 4,
        );
    }

    // ── 5. Assemble file ──
    // Layout: header | records | strings | [pad] | index | sort
    const headerBuf = Buffer.alloc(HEADER_SIZE, 0);

    // Pad the strings section so the index section (read as Uint32Array
    // by the reader) starts on a 4-byte boundary. Without this padding,
    // `new Uint32Array(buffer, offset, count)` throws
    // "start offset of Uint32Array should be a multiple of 4".
    const stringsPadding = (4 - (pool.totalLen % 4)) % 4;
    const stringsBuf =
      pool.totalLen === 0
        ? Buffer.alloc(0)
        : Buffer.concat([pool.toBuffer(), Buffer.alloc(stringsPadding)]);

    // All section offsets were precomputed above (we needed sortOff
    // before writing the sort header so we could bake absolute offsets
    // into it). Reuse the precomputed values here.
    //
    // Note: stringsOff == stringsOffPrecomputed (no padding before strings).
    // indexOff == stringsOffPrecomputed + pool.totalLen + stringsPadding
    //           == stringsOffPrecomputed + stringsBuf.length (after padding)
    //           == indexOffPrecomputed + stringsPadding
    // So we need to bump indexOff/sortOff by stringsPadding.
    const stringsOff = stringsOffPrecomputed;
    const indexOff = indexOffPrecomputed + stringsPadding;
    const sortOff = sortOffPrecomputed + stringsPadding;

    // Re-patch the sort header offsets (they were computed with the
    // pre-padding sortOff; add the padding delta).
    for (let i = 0; i < 4; i++) {
      const oldOff = sortHeaderBuf.readUInt32LE(i * 8);
      sortHeaderBuf.writeUInt32LE(oldOff + stringsPadding, i * 8);
    }

    const totalSize = sortOff + sortHeaderBuf.length + sortArraysBuf.length;

    // FNV-1a of folderFingerprint string (so renderer can quickly check
    // if the manifest matches the current folder state without re-parsing
    // the whole settings._scanFingerprints blob)
    const fpHash = opts.folderFingerprint
      ? fnv1a(String(opts.folderFingerprint))
      : 0;

    let flags = 0;
    if (hasThumbhashes) flags |= FLAG_HAS_THUMBHASHES;
    flags |= FLAG_HAS_SORT_ORDERS;

    // Write header (except CRC at offset 60 and FLAG_SEALED bit at offset 10)
    headerBuf.write(MAGIC, 0, 8, "ascii");
    headerBuf.writeUInt16LE(VERSION, 8);
    headerBuf.writeUInt16LE(flags, 10); // FLAG_SEALED is OR'd in later
    writeU64LE(headerBuf, 12, Date.now());
    headerBuf.writeUInt32LE(trackCount, 20);
    headerBuf.writeUInt32LE(fpHash, 24);
    headerBuf.writeUInt32LE(recordsOff, 28);
    headerBuf.writeUInt32LE(stringsOff, 32);
    headerBuf.writeUInt32LE(indexOff, 36);
    headerBuf.writeUInt32LE(sortOff, 40);
    headerBuf.writeUInt32LE(totalSize, 44);
    // bytes 48..59 left as zero

    // ── 6. Concatenate everything ──
    const file = Buffer.concat(
      [
        headerBuf,
        recordsBuf,
        stringsBuf,
        indexBuf,
        sortHeaderBuf,
        sortArraysBuf,
      ],
      totalSize,
    );

    // ── 7. Compute header CRC, set SEALED, patch CRC ──
    // We need to set the FLAG_SEALED in the flags field BEFORE computing
    // the CRC (otherwise the reader's CRC check fails). Then write the
    // CRC over the (now-zero) slot at offset 60.
    const finalFlags = flags | FLAG_SEALED;
    file.writeUInt16LE(finalFlags, 10);
    const crc = crc32(file, 0, 60);
    file.writeUInt32LE(crc, 60);

    return file;
  }

  /**
   * Write the manifest atomically (temp file + rename).
   *
   * @param {string} filePath  Target path (e.g. .../userData/library.bin)
   * @param {Object[]} tracks
   * @param {Object} [opts]
   * @param {string} [opts.folderFingerprint]
   * @returns {Promise<{ size:number, trackCount:number, ms:number }>}
   */
  static async write(filePath, tracks, opts = {}) {
    const start = Date.now();
    const buf = ManifestWriter.build(tracks, opts);

    const tmpPath = filePath + ".tmp." + process.pid;
    await fs.promises.writeFile(tmpPath, buf);

    // rename is atomic on the same filesystem (POSIX & Windows NTFS)
    try {
      await fs.promises.rename(tmpPath, filePath);
    } catch (err) {
      // Some Windows versions fail rename if target exists — fall back to unlink+rename
      try {
        await fs.promises.unlink(filePath);
      } catch (_) {}
      await fs.promises.rename(tmpPath, filePath);
    }

    return {
      size: buf.length,
      trackCount: tracks.length,
      ms: Date.now() - start,
    };
  }

  /**
   * Synchronous version for cases where the caller is already on a
   * worker thread or explicitly wants to block (e.g. during app quit).
   */
  static writeSync(filePath, tracks, opts = {}) {
    const start = Date.now();
    const buf = ManifestWriter.build(tracks, opts);

    const tmpPath = filePath + ".tmp." + process.pid;
    fs.writeFileSync(tmpPath, buf);
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
      fs.renameSync(tmpPath, filePath);
    }

    return {
      size: buf.length,
      trackCount: tracks.length,
      ms: Date.now() - start,
    };
  }
}

// ─── Internal: 64-bit LE writer ─────────────────────────────────────
function writeU64LE(buf, offset, value) {
  // value is a JS Number (f64). We treat it as unsigned.
  // Safe for values up to 2^53 (year 2255 in ms timestamps).
  const v = Math.max(0, Math.min(value, Number.MAX_SAFE_INTEGER));
  const lo = v >>> 0;
  const hi = Math.floor(v / 0x100000000) >>> 0;
  buf.writeUInt32LE(lo, offset);
  buf.writeUInt32LE(hi, offset + 4);
}

// ─── Internal: build sort indices ───────────────────────────────────
/**
 * Returns a Uint32Array of record indices in sorted order.
 * Input is the (already id-sorted) records array; we sort indices
 * rather than the records themselves to avoid copying objects.
 */
function buildSortIndices(records, comparator) {
  const n = records.length;
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  // Array.prototype.sort on a regular array is faster than TypedArray.sort
  // for non-numeric comparators. Copy to a regular array, sort, copy back.
  const tmp = Array.from(indices);
  tmp.sort((a, b) => comparator(records[a], records[b]));
  for (let i = 0; i < n; i++) indices[i] = tmp[i];
  return indices;
}

module.exports = ManifestWriter;
