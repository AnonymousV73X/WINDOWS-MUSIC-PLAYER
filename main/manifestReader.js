/**
 * NovaTune — Binary Manifest Reader  (pure JS, zero deps)
 * ─────────────────────────────────────────────────────────────────────────
 * PURPOSE
 *   On startup, read ONE file instead of JSON.parse-ing N SQLite rows.
 *   This module takes an ArrayBuffer produced by main/manifest.js and
 *   exposes the same surface the renderer used to get from
 *   `library:get-page` + per-track JSON.parse — but with:
 *
 *     • Zero JSON.parse calls on the hot path
 *     • Lazy per-track decode (only decode what the viewport needs)
 *     • O(1) lookup by id  (records sorted by id at write time)
 *     • O(1) lookup by filePath (open-addressing hash table)
 *     • Pre-computed sort orders (title / dateAdded / album / artist)
 *       — the renderer skips re-sorting 1127 tracks on every launch
 *
 * FORMAT (see manifestWriter.js for the writer side)
 *   All multi-byte integers are LITTLE-ENDIAN (matches V8 / x86 native).
 *
 *   HEADER (64 bytes)
 *     0   magic[8]            "NOVA-MFT"
 *     8   version    u16      currently 1
 *     10  flags      u16      bit0=thumbhashes, bit1=sortOrders, bit2=sealed
 *     12  createdAt  u64      Date.now() at write time
 *     20  trackCount u32
 *     24  fpHash     u32      FNV-1a hash of folderFingerprint string
 *     28  recordsOff u32      offset to records section
 *     32  stringsOff u32      offset to string pool
 *     36  indexOff   u32      offset to filePath hash table
 *     40  sortOff    u32      offset to sort section
 *     44  totalSize  u32      total file size (sanity check)
 *     48  reserved    [12 bytes]
 *     60  crc32      u32      CRC32 of bytes 0..60
 *
 *   RECORDS (128 bytes each, trackCount records, sorted by id)
 *     0   id[16]               16-byte ASCII track id (already hex from sha256)
 *     16  filePath   off:u32 len:u32
 *     24  fileName   off:u32 len:u32
 *     32  title      off:u32 len:u32
 *     40  artist     off:u32 len:u32
 *     48  album      off:u32 len:u32
 *     56  albumArtist off:u32 len:u32
 *     64  genre      off:u32 len:u32
 *     72  thumbHash  off:u32 len:u16   (off=0 → no thumbhash)
 *     78  year        u16
 *     80  trackNumber u16
 *     82  discNumber  u16
 *     84  duration    f32       (seconds; f32 has ~7 sig digits → ms precision up to ~17 min)
 *     88  bitrate     u32
 *     92  sampleRate  u32
 *     96  channels    u8
 *     97  format      u8        enum: 1=MP3 2=FLAC 3=WAV 4=OGG 5=M4A 6=AAC 7=OPUS 8=WMA 9=APE 10=WV 11=TTA 12=MPC 0=unknown
 *     98  hasCoverArt u8
 *     99  flags       u8        bit0=corrupt (skip), bits1-7 reserved
 *    100  fileSize    u64
 *    108  dateAdded   u64
 *    116  dateMod     u64
 *    124  reserved    [4 bytes]
 *
 *   STRING POOL
 *     Raw concatenated UTF-8 bytes. Records reference by (offset,length).
 *     Deduped at write time so "Unknown Artist" / "Unknown Album" cost
 *     one copy across the whole library.
 *
 *   FILEPATH HASH TABLE
 *     Open-addressing table, slotCount = nextPow2(trackCount * 2).
 *     Each slot is u32 (4 bytes):
 *       0xFFFFFFFF = empty
 *       otherwise   = record index (0..trackCount-1)
 *     Hash = FNV-1a of filePath (lowercased, forward-slashed).
 *     Lookup walks slots with linear probing until empty or match.
 *
 *   SORT SECTION
 *     Header (32 bytes): 4 × (offset u32, count u32) for the 4 sort orders.
 *     Then 4 arrays of u32 record indices, each trackCount entries:
 *       sortTitleAsc      — localeCompare(title), case-insensitive
 *       sortDateAddedDesc — dateAdded desc, tie-break title
 *       sortAlbumAsc      — album, then discNumber, then trackNumber
 *       sortArtistAsc     — artist, then album, then trackNumber
 *
 * WHY FIXED 128-BYTE RECORDS?
 *   - O(1) random access: track[i] is at recordsOff + i * 128.
 *   - Cache-friendly: the CPU prefetcher loves fixed strides.
 *   - No length-prefix parsing needed.
 *   - Room for future fields in the 4-byte reserved tail.
 *
 * USAGE
 *   const buf = fs.promises.readFile('library.bin');
 *   const reader = new ManifestReader(buf.buffer);
 *   if (!reader.valid) { fallbackToSQLite(); }
 *   const first500 = reader.getTracksRange(0, 500);          // sort-agnostic
 *   const first500ByTitle = reader.getTracksRange(0, 500, 'sortTitleAsc');
 *   const t = reader.findById('a1b2c3d4e5f67890');
 */

"use strict";

// ─── Format constants ────────────────────────────────────────────────
const MAGIC = "NOVA-MFT"; // 8 bytes, no null terminator
const VERSION = 1;
const HEADER_SIZE = 64;
const RECORD_SIZE = 128;
const HASH_EMPTY = 0xffffffff;

const FLAG_HAS_THUMBHASHES = 0x0001;
const FLAG_HAS_SORT_ORDERS = 0x0002;
const FLAG_SEALED = 0x0004; // writer finished cleanly

const FORMAT_ENUM = {
  UNKNOWN: 0,
  MP3: 1,
  FLAC: 2,
  WAV: 3,
  OGG: 4,
  M4A: 5,
  AAC: 6,
  OPUS: 7,
  WMA: 8,
  APE: 9,
  WV: 10,
  TTA: 11,
  MPC: 12,
};
const FORMAT_ENUM_REVERSE = {};
for (const [k, v] of Object.entries(FORMAT_ENUM))
  FORMAT_ENUM_REVERSE[v] = k;

const SORT_ORDERS = [
  "sortTitleAsc",
  "sortDateAddedDesc",
  "sortAlbumAsc",
  "sortArtistAsc",
];

// ─── CRC32 (table-based, zero deps) ──────────────────────────────────
const _CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++)
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, byteOffset, byteLength) {
  let c = 0xffffffff;
  const end = byteOffset + byteLength;
  for (let i = byteOffset; i < end; i++)
    c = _CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─── FNV-1a 32-bit hash (used for filePath index) ────────────────────
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Normalize a Windows/Mac path so "C:\Foo\Bar.mp3" and "c:/foo/bar.mp3"
// hash to the same slot.
function normalizePath(p) {
  if (!p) return "";
  return p.replace(/\\/g, "/").toLowerCase();
}

// ─── DataView helpers (little-endian) ────────────────────────────────
const _dv = (buf) =>
  buf instanceof ArrayBuffer
    ? new DataView(buf)
    : buf instanceof Uint8Array
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf); // Buffer / TypedArray fallback

function readU16(dv, off) {
  return dv.getUint16(off, true);
}
function readU32(dv, off) {
  return dv.getUint32(off, true);
}
function readU64(dv, off) {
  // BigInt then to Number — safe for dates up to year 2106 (u32 ms) or 2255 (u64 s)
  // We store ms timestamps, so u64 → Number is safe up to 8.6e15 ms = year 2243.
  const lo = dv.getUint32(off, true);
  const hi = dv.getUint32(off + 4, true);
  return hi * 0x100000000 + lo;
}
function readF32(dv, off) {
  return dv.getFloat32(off, true);
}
function readU8(dv, off) {
  return dv.getUint8(off);
}

class ManifestReader {
  /**
   * @param {ArrayBuffer|Uint8Array|Buffer} buf
   */
  constructor(buf) {
    this._buf = buf;
    this._dv = _dv(buf);
    this._bytes =
      buf instanceof Uint8Array
        ? buf
        : buf instanceof ArrayBuffer
          ? new Uint8Array(buf)
          : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    this.valid = false;
    this.error = null;
    this._sortCache = new Map(); // name → Uint32Array
    this._decodeCache = new Map(); // recordIdx → track object (LRU-bounded)
    this._decodeCacheMax = 256; // hot tracks: currentTrack + visible viewport
    try {
      this._parseHeader();
      this.valid = true;
    } catch (err) {
      this.error = err.message || String(err);
    }
  }

  _parseHeader() {
    const dv = this._dv;
    if (this._bytes.byteLength < HEADER_SIZE)
      throw new Error("manifest: file too small");

    // Magic
    let magic = "";
    for (let i = 0; i < 8; i++)
      magic += String.fromCharCode(this._bytes[i]);
    if (magic !== MAGIC) throw new Error(`manifest: bad magic '${magic}'`);

    this.version = readU16(dv, 8);
    if (this.version !== VERSION)
      throw new Error(`manifest: unsupported version ${this.version}`);

    this.flags = readU16(dv, 10);
    this.createdAt = readU64(dv, 12);
    this.trackCount = readU32(dv, 20);
    this.fpHash = readU32(dv, 24);
    this.recordsOff = readU32(dv, 28);
    this.stringsOff = readU32(dv, 32);
    this.indexOff = readU32(dv, 36);
    this.sortOff = readU32(dv, 40);
    this.totalSize = readU32(dv, 44);

    if (this.totalSize !== this._bytes.byteLength)
      throw new Error(
        `manifest: size mismatch (header says ${this.totalSize}, file is ${this._bytes.byteLength})`,
      );

    // Header CRC
    const expected = readU32(dv, 60);
    const actual = crc32(this._bytes, 0, 60);
    if (expected !== actual)
      throw new Error(`manifest: header CRC mismatch (got ${actual}, expected ${expected})`);

    if (!(this.flags & FLAG_SEALED))
      throw new Error("manifest: not sealed (write was incomplete)");
  }

  // ─── String pool ────────────────────────────────────────────────
  _readString(off, len) {
    if (len === 0) return "";
    // Node Buffer.utf8Slice is the fastest UTF-8 decoder in V8.
    // In the renderer (no Buffer), fall back to TextDecoder.
    if (typeof Buffer !== "undefined" && this._bytes instanceof Buffer) {
      return this._bytes.toString("utf8", off, off + len);
    }
    if (!this._td) this._td = new TextDecoder("utf-8");
    return this._td.decode(this._bytes.subarray(off, off + len));
  }

  _readId(recordOff) {
    // Track IDs are 16 ASCII hex chars; read directly from bytes.
    let s = "";
    for (let i = 0; i < 16; i++)
      s += String.fromCharCode(this._bytes[recordOff + i]);
    return s;
  }

  // ─── Public API ─────────────────────────────────────────────────
  get headerInfo() {
    return {
      version: this.version,
      flags: this.flags,
      createdAt: this.createdAt,
      trackCount: this.trackCount,
      fpHash: this.fpHash,
      hasThumbhashes: !!(this.flags & FLAG_HAS_THUMBHASHES),
      hasSortOrders: !!(this.flags & FLAG_HAS_SORT_ORDERS),
    };
  }

  /**
   * Decode one record into a track object (same shape as the old
   * SQLite JSON rows — drop-in for the renderer).
   * @param {number} recordIdx  0..trackCount-1
   * @returns {Object|null}
   */
  getTrackAt(recordIdx) {
    if (recordIdx < 0 || recordIdx >= this.trackCount) return null;

    // Hot-path cache: currentTrack + visible viewport are decoded often.
    const cached = this._decodeCache.get(recordIdx);
    if (cached) return cached;

    const off = this.recordsOff + recordIdx * RECORD_SIZE;
    const dv = this._dv;
    const bytes = this._bytes;

    const id = this._readId(off);
    const filePath = this._readString(
      readU32(dv, off + 16),
      readU32(dv, off + 20),
    );
    const fileName = this._readString(
      readU32(dv, off + 24),
      readU32(dv, off + 28),
    );
    const title = this._readString(
      readU32(dv, off + 32),
      readU32(dv, off + 36),
    );
    const artist = this._readString(
      readU32(dv, off + 40),
      readU32(dv, off + 44),
    );
    const album = this._readString(
      readU32(dv, off + 48),
      readU32(dv, off + 52),
    );
    const albumArtist = this._readString(
      readU32(dv, off + 56),
      readU32(dv, off + 60),
    );
    const genre = this._readString(
      readU32(dv, off + 64),
      readU32(dv, off + 68),
    );
    const thumbHashOff = readU32(dv, off + 72);
    const thumbHashLen = readU16(dv, off + 76);
    const thumbHash =
      thumbHashOff === 0
        ? null
        : this._readString(thumbHashOff, thumbHashLen);

    const track = {
      id,
      filePath,
      fileName,
      title,
      artist,
      album,
      albumArtist,
      genre,
      year: readU16(dv, off + 78),
      trackNumber: readU16(dv, off + 80),
      discNumber: readU16(dv, off + 82),
      duration: readF32(dv, off + 84),
      bitrate: readU32(dv, off + 88),
      sampleRate: readU32(dv, off + 92),
      channels: readU8(dv, off + 96),
      format: FORMAT_ENUM_REVERSE[readU8(dv, off + 97)] || "UNKNOWN",
      _hasCoverArt: readU8(dv, off + 98) === 1,
      _thumbHash: thumbHash,
      fileSize: readU64(dv, off + 100),
      dateAdded: readU64(dv, off + 108),
      dateModified: readU64(dv, off + 116),
    };

    // Bound the decode cache so it doesn't grow unbounded as the user scrolls.
    if (this._decodeCache.size >= this._decodeCacheMax) {
      // Evict oldest inserted (Map preserves insertion order)
      const firstKey = this._decodeCache.keys().next().value;
      this._decodeCache.delete(firstKey);
    }
    this._decodeCache.set(recordIdx, track);
    return track;
  }

  /**
   * Decode a range of records. Use this to render the visible viewport.
   * @param {number} start
   * @param {number} count
   * @param {string} [sortOrder]  one of SORT_ORDERS (default: physical order)
   * @returns {Object[]}
   */
  getTracksRange(start, count, sortOrder) {
    if (start < 0) start = 0;
    if (start >= this.trackCount) return [];
    if (count <= 0) return [];
    if (start + count > this.trackCount) count = this.trackCount - start;

    const out = new Array(count);
    if (sortOrder && SORT_ORDERS.includes(sortOrder)) {
      const order = this._getSortArray(sortOrder);
      for (let i = 0; i < count; i++)
        out[i] = this.getTrackAt(order[start + i]);
    } else {
      for (let i = 0; i < count; i++)
        out[i] = this.getTrackAt(start + i);
    }
    return out;
  }

  /**
   * Decode ALL tracks. Use sparingly — defeats the lazy-decode purpose.
   * Mainly for compatibility with code paths that expect a flat array.
   * @param {string} [sortOrder]
   * @returns {Object[]}
   */
  getAllTracks(sortOrder) {
    return this.getTracksRange(0, this.trackCount, sortOrder);
  }

  /**
   * O(log n) lookup by id — records are sorted by id at write time.
   * @param {string} id
   * @returns {Object|null}
   */
  findById(id) {
    if (!id || id.length !== 16) return null;
    let lo = 0;
    let hi = this.trackCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const midOff = this.recordsOff + mid * RECORD_SIZE;
      let midId = "";
      for (let i = 0; i < 16; i++)
        midId += String.fromCharCode(this._bytes[midOff + i]);
      if (midId === id) return this.getTrackAt(mid);
      if (midId < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  /**
   * O(1) amortized lookup by filePath via the open-addressing hash table.
   * @param {string} filePath
   * @returns {Object|null}
   */
  findByFilePath(filePath) {
    if (!filePath) return null;
    const key = normalizePath(filePath);
    const h = fnv1a(key);
    const slotCount = this._hashSlotCount();
    if (slotCount === 0) return null;
    let slot = h & (slotCount - 1);
    const dv = this._dv;
    for (let probe = 0; probe < slotCount; probe++) {
      const slotOff = this.indexOff + slot * 4;
      const recordIdx = readU32(dv, slotOff);
      if (recordIdx === HASH_EMPTY) return null;
      // Compare key against the record's filePath
      const recOff = this.recordsOff + recordIdx * RECORD_SIZE;
      const fpOff = readU32(dv, recOff + 16);
      const fpLen = readU32(dv, recOff + 20);
      const candidate = normalizePath(this._readString(fpOff, fpLen));
      if (candidate === key) return this.getTrackAt(recordIdx);
      slot = (slot + 1) & (slotCount - 1); // linear probe
    }
    return null;
  }

  _hashSlotCount() {
    if (!this.indexOff) return 0;
    // Sort section comes right after hash table in the canonical layout,
    // so slotCount = (sortOff - indexOff) / 4. But if sort orders are
    // absent (no FLAG_HAS_SORT_ORDERS), totalSize - indexOff is the bound.
    if (this.sortOff) return Math.floor((this.sortOff - this.indexOff) / 4);
    return Math.floor((this.totalSize - this.indexOff) / 4);
  }

  /**
   * Get a pre-computed sort order as a Uint32Array of record indices.
   * Returns null if sort orders aren't present in this manifest.
   */
  _getSortArray(name) {
    if (!(this.flags & FLAG_HAS_SORT_ORDERS)) return null;
    const cached = this._sortCache.get(name);
    if (cached) return cached;

    // Sort section header is 32 bytes: 4 × (offset u32, count u32)
    const idx = SORT_ORDERS.indexOf(name);
    if (idx < 0) return null;
    const arrOff = readU32(this._dv, this.sortOff + idx * 8);
    const arrCount = readU32(this._dv, this.sortOff + idx * 8 + 4);
    if (arrCount === 0 || arrOff === 0) return null;

    // Wrap the existing ArrayBuffer — zero-copy.
    const view = new Uint32Array(
      this._bytes.buffer,
      this._bytes.byteOffset + arrOff,
      arrCount,
    );
    this._sortCache.set(name, view);
    return view;
  }

  /**
   * Returns a sorted range — same as getTracksRange but uses a named
   * sort order. If the manifest doesn't have sort orders, falls back
   * to physical order (caller should re-sort if needed).
   */
  getSortedRange(name, start, count) {
    return this.getTracksRange(start, count, name);
  }

  /**
   * Returns the full sort order as a Uint32Array (zero-copy view).
   * Useful when the renderer wants to do its own slicing.
   */
  getSortOrder(name) {
    return this._getSortArray(name);
  }

  /**
   * Returns the list of sort order names present in this manifest.
   */
  getAvailableSortOrders() {
    if (!(this.flags & FLAG_HAS_SORT_ORDERS)) return [];
    return SORT_ORDERS.filter((n) => this._getSortArray(n) !== null);
  }

  /**
   * Drop the decode cache — call after the manifest is invalidated
   * (e.g. background scan completed and the renderer fetched a new
   * ArrayBuffer).
   */
  invalidateCache() {
    this._decodeCache.clear();
    this._sortCache.clear();
  }
}

// ─── Exports ────────────────────────────────────────────────────────
ManifestReader.MAGIC = MAGIC;
ManifestReader.VERSION = VERSION;
ManifestReader.HEADER_SIZE = HEADER_SIZE;
ManifestReader.RECORD_SIZE = RECORD_SIZE;
ManifestReader.HASH_EMPTY = HASH_EMPTY;
ManifestReader.FLAG_HAS_THUMBHASHES = FLAG_HAS_THUMBHASHES;
ManifestReader.FLAG_HAS_SORT_ORDERS = FLAG_HAS_SORT_ORDERS;
ManifestReader.FLAG_SEALED = FLAG_SEALED;
ManifestReader.FORMAT_ENUM = FORMAT_ENUM;
ManifestReader.SORT_ORDERS = SORT_ORDERS;
ManifestReader.crc32 = crc32;
ManifestReader.fnv1a = fnv1a;
ManifestReader.normalizePath = normalizePath;

module.exports = ManifestReader;
