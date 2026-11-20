/**
 * NovaTune — Cover Art Engine
 * Strict, verifiable cover art handling:
 *   - validateImage(): real decode + size/aspect/flatness checks (rejects SVG/HTML/blank placeholders)
 *   - findLocalCover(): only art that provably belongs to the song (stem sidecars, exact-name images,
 *     and — only when the caller says the folder is an album — folder art)
 *   - searchOnlineCover(): iTunes / Deezer / YT Music with artist+title+duration matching
 * Pure Node (+ lazy sharp). No electron imports, safe inside worker threads.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const AUDIO_EXTS = new Set([
  ".mp3",
  ".flac",
  ".wav",
  ".ogg",
  ".m4a",
  ".aac",
  ".wma",
  ".opus",
  ".ape",
  ".wv",
  ".tta",
  ".mpc",
]);
const FOLDER_ART_NAMES = new Set([
  "cover",
  "folder",
  "front",
  "album",
  "albumart",
  "artwork",
]);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Sniffing / validation ───────────────────────────────────────
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45
  )
    return "image/webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  return null;
}

function _textLike(buf) {
  const head = buf.slice(0, 512).toString("latin1").toLowerCase();
  return (
    head.includes("<svg") ||
    head.includes("<?xml") ||
    head.includes("<html") ||
    head.includes("<!doctype")
  );
}

const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

// Lenient by default (low-res / dark real thumbnails are fine); strict:true for online/new art
async function validateImage(buf, { minSide = 48, strict = false } = {}) {
  if (!buf || buf.length < 400) return { valid: false, reason: "too_small" };
  if (_textLike(buf)) return { valid: false, reason: "svg_or_text" };
  const mime = sniff(buf);
  if (!mime) return { valid: false, reason: "not_image" };
  let sharp;
  try {
    sharp = require("sharp");
  } catch (_) {
    return { valid: true, mime, hash: md5(buf), reason: "no_decoder" };
  }
  try {
    const m = await sharp(buf, { failOn: "error" }).metadata();
    if (!m.width || !m.height) return { valid: false, reason: "undecodable" };
    if (Math.min(m.width, m.height) < minSide)
      return { valid: false, reason: "too_small_dims" };
    const ratio = m.width / m.height;
    const [lo, hi] = strict ? [0.7, 1.4] : [0.45, 2.3];
    if (ratio > hi || ratio < lo) return { valid: false, reason: "bad_aspect" };
    const st = await sharp(buf, { failOn: "error" })
      .resize(64, 64, { fit: "fill" })
      .removeAlpha()
      .stats();
    const avgStdev =
      st.channels.reduce((a, c) => a + c.stdev, 0) / st.channels.length;
    if (avgStdev < (strict ? 8 : 1.5))
      return { valid: false, reason: "flat_placeholder" };
    return {
      valid: true,
      mime,
      width: m.width,
      height: m.height,
      hash: md5(buf),
    };
  } catch (e) {
    return { valid: false, reason: "undecodable" };
  }
}

// Sync, header-only check (worker threads / scan time). Deep check happens in validateImage().
function quickCheckFile(file) {
  try {
    const st = fs.statSync(file);
    if (st.size < 400) return false;
    const fd = fs.openSync(file, "r");
    const b = Buffer.alloc(512);
    const n = fs.readSync(fd, b, 0, 512, 0);
    fs.closeSync(fd);
    const head = b.slice(0, n);
    return !!sniff(head) && !_textLike(head);
  } catch (_) {
    return false;
  }
}

// Filters/sorts music-metadata pictures so [0] is always a usable, best-choice image
function usablePictures(result) {
  const pics = result && result.common && result.common.picture;
  if (!Array.isArray(pics) || !pics.length) return false;
  const front = (p) => (/front/i.test(String(p.type || "")) ? 1 : 0);
  const good = pics
    .filter(
      (p) =>
        p &&
        p.data &&
        p.data.length >= 400 &&
        sniff(p.data) &&
        !_textLike(p.data),
    )
    .sort((a, b) => front(b) - front(a) || b.data.length - a.data.length);
  result.common.picture = good;
  return good.length > 0;
}

// ─── Strict local search ─────────────────────────────────────────
function _listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
}

function _audioCount(files) {
  let n = 0;
  for (const f of files) if (AUDIO_EXTS.has(path.extname(f).toLowerCase())) n++;
  return n;
}

/**
 * Ordered candidates that can legitimately belong to this song.
 * allowFolderArt: caller decided the folder is a single-album folder.
 */
function localCandidates(filePath, { allowFolderArt = false } = {}) {
  const dir = path.dirname(filePath);
  const stem = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const files = _listDir(dir);
  const out = [];
  const isImg = (f) => IMG_EXTS.has(path.extname(f).toLowerCase());

  for (const f of files) {
    const l = f.toLowerCase();
    if (isImg(f) && l.startsWith(`${stem}.novaart.`))
      out.push({ path: path.join(dir, f), kind: "sidecar" });
  }
  for (const f of files) {
    const l = f.toLowerCase();
    if (
      isImg(f) &&
      !l.includes(".novaart.") &&
      path.basename(l, path.extname(l)) === stem
    )
      out.push({ path: path.join(dir, f), kind: "exact" });
  }
  if (allowFolderArt) {
    const folderArt = (list, base) => {
      const found = [];
      for (const f of list) {
        if (!isImg(f) || f.toLowerCase().includes(".novaart.")) continue;
        const n = path.basename(f, path.extname(f)).toLowerCase();
        if (FOLDER_ART_NAMES.has(n))
          found.push({ path: path.join(base, f), kind: "folder", pri: 1 });
        else if (n.startsWith("albumart") && !n.includes("small"))
          found.push({
            path: path.join(base, f),
            kind: "folder",
            pri: n.includes("large") ? 0 : 2,
          });
      }
      return found.sort((a, b) => a.pri - b.pri);
    };
    out.push(...folderArt(files, dir));
    // CD1/CD2 style subfolders: art lives one level up, parent holds no audio itself
    if (/^(cd|disc|disk)\s*\d+$/i.test(path.basename(dir))) {
      const parent = path.dirname(dir);
      const pf = _listDir(parent);
      if (_audioCount(pf) === 0) out.push(...folderArt(pf, parent));
    }
  }
  return out;
}

// Sync scan-time finder: header-sniffed only, conservative about folder art
function findLocalCoverSync(filePath) {
  try {
    const dir = path.dirname(filePath);
    const files = _listDir(dir);
    const allowFolder = _audioCount(files) <= 40;
    for (const c of localCandidates(filePath, {
      allowFolderArt: allowFolder,
    })) {
      if (quickCheckFile(c.path)) return c.path;
    }
  } catch (_) {}
  return null;
}

async function findLocalCover(
  filePath,
  { allowFolderArt = false, excludeHashes } = {},
) {
  for (const c of localCandidates(filePath, { allowFolderArt })) {
    let buf;
    try {
      buf = fs.readFileSync(c.path);
    } catch (_) {
      continue;
    }
    const v = await validateImage(buf);
    if (!v.valid) continue;
    if (excludeHashes && excludeHashes.has(v.hash)) continue;
    return { path: c.path, kind: c.kind, buf, ...v };
  }
  return null;
}

// ─── Text normalisation / matching ───────────────────────────────
const _norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function _titleCore(t) {
  return _norm(
    String(t || "")
      .replace(/[\(\[]\s*(feat|ft|featuring|with|prod)\b[^\)\]]*[\)\]]/gi, "")
      .replace(/\s[-–]\s*(feat|ft|featuring)\.?\s.*$/i, ""),
  ).replace(/\s/g, "");
}

const _FLAG_RE =
  /\b(remix|live|acoustic|instrumental|karaoke|cover|slowed|sped|reverb|nightcore|8d|demo|tribute|lofi|cappella)\b/g;
const _flags = (s) =>
  [...new Set(_norm(s).match(_FLAG_RE) || [])].sort().join(",");

function _artistTokens(name) {
  return String(name || "")
    .replace(/\s-\s*topic$/i, "")
    .split(/,|&|;|\/|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b/i)
    .map(_norm)
    .filter((x) => x && x !== "unknown artist");
}

function _dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = new Map();
  for (let i = 0; i < a.length - 1; i++)
    bg.set(a.substr(i, 2), (bg.get(a.substr(i, 2)) || 0) + 1);
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const k = b.substr(i, 2);
    const c = bg.get(k) || 0;
    if (c > 0) {
      bg.set(k, c - 1);
      hit++;
    }
  }
  return (2 * hit) / (a.length + b.length - 2);
}

function _cleanTitle(t) {
  return String(t || "")
    .replace(
      /\((?:official|lyrics?|audio|video|music video|visualizer|hd|hq|4k|explicit)[^)]*\)/gi,
      "",
    )
    .replace(
      /\[(?:official|lyrics?|audio|video|visualizer|hd|hq|4k|explicit)[^\]]*\]/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function deriveQuery(track) {
  const stem = track.filePath
    ? path.basename(track.filePath, path.extname(track.filePath))
    : "";
  let title = _cleanTitle(track.title || stem);
  let artist = Array.isArray(track.artist)
    ? track.artist.join(", ")
    : String(track.artist || "");
  const split = title.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
  if (!artist || /^unknown artist$/i.test(artist)) {
    if (split) {
      artist = split[1];
      title = split[2];
    } else artist = "";
  } else if (
    split &&
    _norm(split[1]) &&
    _artistTokens(artist).some((a) => _norm(split[1]).includes(a))
  ) {
    title = split[2];
  }
  const album = /^unknown album$/i.test(String(track.album || ""))
    ? ""
    : String(track.album || "");
  return {
    artist: artist.trim(),
    title: title.trim(),
    album: album.trim(),
    durationMs: (Number(track.duration) || 0) * 1000,
  };
}

function scoreCandidate(q, c) {
  const qt = _titleCore(q.title);
  const ct = _titleCore(c.title);
  if (!qt || !ct) return 0;
  if (
    _flags(q.title + " " + q.album) !== _flags(c.title + " " + (c.album || ""))
  )
    return 0;
  const qa = _artistTokens(q.artist);
  const ca = _artistTokens(c.artist);
  const artistOverlap = qa.some((x) =>
    ca.some(
      (y) =>
        x === y ||
        (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))),
    ),
  );
  if (qa.length && !artistOverlap) return 0;

  const ts = qt === ct ? 1 : _dice(qt, ct);
  const durOk =
    q.durationMs && c.durationMs
      ? Math.abs(q.durationMs - c.durationMs) <= 8000
      : null;
  if (q.durationMs && c.durationMs && !durOk) return 0;

  if (ts >= 0.82) {
    if (!qa.length && (ts < 0.97 || durOk !== true)) return 0; // no artist info → need exact title + matching duration
    return ts * 0.6 + (qa.length ? 0.25 : 0.1) + (durOk ? 0.15 : 0.05);
  }
  // Title mismatch: accept only an exact album + artist match (art is album-specific)
  const qal = _norm(q.album);
  if (
    qal &&
    qa.length &&
    artistOverlap &&
    c.album &&
    _dice(qal, _norm(c.album)) >= 0.92
  )
    return 0.7;
  return 0;
}

// ─── Network ─────────────────────────────────────────────────────
function fetchBuf(
  url,
  { timeout = 9000, maxBytes = 15 * 1024 * 1024, hops = 0 } = {},
) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error("Too many redirects"));
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(e);
    }
    if (u.protocol !== "https:") return reject(new Error("https only"));
    const req = https.get(
      url,
      { headers: { "User-Agent": UA, Accept: "*/*" }, timeout },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          return resolve(
            fetchBuf(new URL(res.headers.location, url).href, {
              timeout,
              maxBytes,
              hops: hops + 1,
            }),
          );
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > maxBytes) return req.destroy(new Error("too large"));
          chunks.push(c);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

const fetchJson = async (url, opts) =>
  JSON.parse((await fetchBuf(url, opts)).toString("utf8"));

// ─── Online providers → candidates { artist, title, album, durationMs, artUrls[] } ─
async function _itunes(q) {
  const term = [q.artist, q.title].filter(Boolean).join(" ");
  const j = await fetchJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=15`,
    { timeout: 7000 },
  );
  return (j.results || []).map((r) => {
    const a = r.artworkUrl100 || "";
    return {
      artist: r.artistName,
      title: r.trackName,
      album: r.collectionName,
      durationMs: r.trackTimeMillis || 0,
      artUrls: a
        ? [
            a.replace(/100x100(bb)?/, "1200x1200bb"),
            a.replace(/100x100(bb)?/, "600x600bb"),
            a.replace(/100x100(bb)?/, "300x300bb"),
          ]
        : [],
    };
  });
}

async function _deezer(q) {
  const term = [q.artist, q.title].filter(Boolean).join(" ");
  const j = await fetchJson(
    `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=15`,
    { timeout: 7000 },
  );
  return (j.data || []).map((r) => ({
    artist: r.artist && r.artist.name,
    title: r.title,
    album: r.album && r.album.title,
    durationMs: (r.duration || 0) * 1000,
    artUrls: [r.album && r.album.cover_xl, r.album && r.album.cover_big].filter(
      Boolean,
    ),
  }));
}

async function _ytm(q) {
  let DE;
  try {
    DE = require("./downloadEngine");
  } catch (_) {
    return [];
  }
  if (typeof DE.searchYouTubeMusic !== "function") return [];
  const res = await DE.searchYouTubeMusic(
    [q.artist, q.title].filter(Boolean).join(" "),
    10,
  );
  return res
    .filter((r) => r.albumName) // songs only; bare videos carry letterboxed video thumbnails
    .map((r) => ({
      artist: r.artistName,
      title: r.trackName,
      album: r.albumName,
      durationMs: r.durationMs || 0,
      artUrls: [r.artworkUrl, r.artworkThumbnail].filter(Boolean),
    }));
}

// ─── Last resort: YouTube / YouTube Music thumbnails (only after real cover art providers miss) ───
function _parseDur(str) {
  const m = String(str || "")
    .trim()
    .split(":")
    .map(Number);
  if (!m.length || m.some((x) => !Number.isFinite(x))) return 0;
  return m.reduce((a, x) => a * 60 + x, 0) * 1000;
}

function _post(url, bodyObj, { timeout = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(bodyObj));
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          "Content-Length": data.length,
        },
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end(data);
  });
}

async function _ytWebSearch(q) {
  const j = await _post(
    "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
    {
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
          hl: "en",
          gl: "US",
        },
      },
      query: [q.artist, q.title].filter(Boolean).join(" "),
    },
  );
  const out = [];
  const sections =
    j?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || [];
  for (const sec of sections)
    for (const it of sec.itemSectionRenderer?.contents || []) {
      const v = it.videoRenderer;
      if (!v || !v.videoId) continue;
      out.push({
        videoId: v.videoId,
        title: (v.title?.runs || []).map((r) => r.text).join(""),
        channel: v.ownerText?.runs?.[0]?.text || "",
        durationMs: _parseDur(v.lengthText?.simpleText),
      });
    }
  return out.slice(0, 15);
}

// Video titles look like "Artist - Title (Official Video)": match by containment, not equality
function scoreVideo(q, v) {
  const strip = (t) =>
    _norm(
      String(t || "").replace(
        /[\(\[]\s*(feat|ft|featuring|with|prod)\b[^\)\]]*[\)\]]/gi,
        "",
      ),
    );
  const qw = strip(q.title);
  const vw = strip(_cleanTitle(v.title));
  if (!qw || qw.replace(/\s/g, "").length < 3 || !` ${vw} `.includes(` ${qw} `))
    return 0; // whole-word containment
  const vt = vw.replace(/\s/g, "");
  if (_flags(q.title + " " + q.album) !== _flags(v.title)) return 0;
  const qa = _artistTokens(q.artist);
  const hay = vt + _norm(v.channel || "").replace(/\s/g, "");
  const hasArtist = qa.some((a) => hay.includes(a.replace(/\s/g, "")));
  if (qa.length && !hasArtist) return 0;
  let dur = 0.05;
  if (q.durationMs && v.durationMs) {
    const d = v.durationMs - q.durationMs;
    if (d < -6000 || d > 45000) return 0;
    dur = Math.abs(d) <= 4000 ? 0.15 : 0.05;
  } else if (!qa.length) return 0; // nothing but a title to go on
  return 0.7 + (hasArtist ? 0.15 : 0) + dur;
}

// Video frames are 16:9 with possible black bars → trim bars, centre-crop to a square
async function _toSquareJpeg(buf) {
  const sharp = require("sharp");
  let b = buf;
  try {
    b = await sharp(buf).trim({ threshold: 18 }).toBuffer();
  } catch (_) {}
  const m = await sharp(b).metadata();
  const side = Math.min(m.width, m.height);
  if (side < 200) throw new Error("too small");
  const out = Math.min(side, 800);
  return sharp(b)
    .extract({
      left: Math.floor((m.width - side) / 2),
      top: Math.floor((m.height - side) / 2),
      width: side,
      height: side,
    })
    .resize(out, out)
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function _youtubeFallback(q, excludeHashes) {
  let DE = null;
  try {
    DE = require("./downloadEngine");
  } catch (_) {}
  const term = [q.artist, q.title].filter(Boolean).join(" ");
  const [ytm, web] = await Promise.allSettled([
    DE && DE.searchYouTubeMusic
      ? DE.searchYouTubeMusic(term, 15)
      : Promise.resolve([]),
    _ytWebSearch(q),
  ]);
  const cands = [];
  if (ytm.status === "fulfilled")
    for (const r of ytm.value || [])
      cands.push({
        videoId: r.videoId,
        title: r.trackName,
        artist: r.artistName,
        album: r.albumName,
        channel: r.artistName,
        durationMs: r.durationMs,
        squareUrl: /googleusercontent|ggpht/.test(r.artworkUrl || "")
          ? r.artworkUrl
          : null,
        provider: "youtube-music",
      });
  if (web.status === "fulfilled")
    for (const r of web.value)
      cands.push({ ...r, artist: r.channel, provider: "youtube" });

  const seen = new Set();
  const scored = cands
    .map((c) => ({
      c,
      s: Math.max(c.album ? scoreCandidate(q, c) : 0, scoreVideo(q, c)),
    }))
    .filter((x) => x.s >= 0.8 && x.c.videoId)
    .sort(
      (a, b) => b.s - a.s || (b.c.squareUrl ? 1 : 0) - (a.c.squareUrl ? 1 : 0),
    )
    .filter((x) => (seen.has(x.c.videoId) ? false : seen.add(x.c.videoId)))
    .slice(0, 6);

  for (const { c, s } of scored) {
    const urls = [];
    if (c.squareUrl) urls.push({ url: c.squareUrl, crop: false });
    for (const n of ["maxresdefault", "sddefault", "hqdefault"])
      urls.push({
        url: `https://i.ytimg.com/vi/${c.videoId}/${n}.jpg`,
        crop: true,
      });
    for (const { url, crop } of urls) {
      try {
        let buf = await fetchBuf(url, { timeout: 9000 });
        if (crop) buf = await _toSquareJpeg(buf);
        const v = await validateImage(buf, { minSide: 200, strict: true });
        if (!v.valid || (excludeHashes && excludeHashes.has(v.hash))) continue;
        return {
          buf,
          ...v,
          url,
          score: s,
          provider: c.provider,
          matched: {
            artist: c.artist || c.channel,
            title: c.title,
            album: c.album,
          },
        };
      } catch (_) {}
    }
  }
  return null;
}

// Art that came from the exact search card the user picked: trusted by provenance.
// Only checks it is a real image; squares up 16:9 video frames instead of rejecting them.
async function normalizeArtBuffer(buf) {
  let v = await validateImage(buf, { minSide: 100 });
  if (!v.valid) return null;
  const sharp = require("sharp");
  const m = await sharp(buf).metadata();
  const ratio = m.width / m.height;
  if (ratio < 0.9 || ratio > 1.1) {
    try {
      buf = await _toSquareJpeg(buf);
      v = await validateImage(buf, { minSide: 100 });
      if (!v.valid) return null;
    } catch (_) {
      return null;
    }
  }
  return { buf, ...v };
}

async function fetchSourceArt(url) {
  if (!url) return null;
  const urls = [url];
  const yt = String(url).match(/i\.ytimg\.com\/vi(?:_webp)?\/([\w-]{6,})\//);
  if (yt)
    for (const n of ["maxresdefault", "sddefault", "hqdefault"])
      urls.push(`https://i.ytimg.com/vi/${yt[1]}/${n}.jpg`);
  if (/googleusercontent\.com|ggpht\.com/.test(url))
    urls.unshift(
      url.replace(/=(?:w\d+-h\d+|s\d+)[^?#]*$/, "=w800-h800-l90-rj"),
    );
  for (const u of urls) {
    try {
      const r = await normalizeArtBuffer(await fetchBuf(u, { timeout: 9000 }));
      if (r) return r;
    } catch (_) {}
  }
  return null;
}

const _onlineCache = new Map(); // key → { t, p }
const ONLINE_TTL = 10 * 60 * 1000;

async function _searchOnlineOnce(q, excludeHashes) {
  const providers = [_itunes, _deezer, _ytm];
  const settled = await Promise.race([
    Promise.allSettled(providers.map((p) => p(q))),
    new Promise((r) => setTimeout(() => r([]), 12000)),
  ]);
  const cands = [];
  for (const s of settled) if (s.status === "fulfilled") cands.push(...s.value);
  const scored = cands
    .map((c) => ({ c, s: scoreCandidate(q, c) }))
    .filter((x) => x.s >= 0.72 && x.c.artUrls.length)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
  for (const { c, s } of scored) {
    for (const url of c.artUrls) {
      try {
        const buf = await fetchBuf(url, { timeout: 9000 });
        const v = await validateImage(buf, { minSide: 200, strict: true });
        if (!v.valid) continue;
        if (excludeHashes && excludeHashes.has(v.hash)) continue;
        return {
          buf,
          ...v,
          url,
          score: s,
          matched: { artist: c.artist, title: c.title, album: c.album },
        };
      } catch (_) {}
    }
  }
  // Nothing from the cover-art catalogues → most relevant YouTube / YouTube Music thumbnail
  return _youtubeFallback(q, excludeHashes).catch(() => null);
}

/** Finds a cover that is verifiably the right one for this track, or null. */
function searchOnlineCover(track, { excludeHashes } = {}) {
  const q = deriveQuery(track);
  if (!q.title) return Promise.resolve(null);
  const key = `${_norm(q.artist)}|${_norm(q.title)}|${_norm(q.album)}|${Math.round(q.durationMs / 4000)}`;
  const hit = _onlineCache.get(key);
  const usable = (r) => r && !(excludeHashes && excludeHashes.has(r.hash));
  if (hit && Date.now() - hit.t < ONLINE_TTL) {
    return hit.p.then((r) =>
      r === null || usable(r) ? r : _searchOnlineOnce(q, excludeHashes),
    );
  }
  const p = _searchOnlineOnce(q, excludeHashes).catch(() => null);
  _onlineCache.set(key, { t: Date.now(), p });
  if (_onlineCache.size > 200)
    _onlineCache.delete(_onlineCache.keys().next().value);
  return p;
}

const extForMime = (m) =>
  ({
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
  })[m] || ".jpg";

module.exports = {
  sniff,
  md5,
  validateImage,
  quickCheckFile,
  usablePictures,
  localCandidates,
  findLocalCover,
  findLocalCoverSync,
  deriveQuery,
  scoreCandidate,
  scoreVideo,
  normalizeArtBuffer,
  fetchSourceArt,
  _toSquareJpeg,
  searchOnlineCover,
  fetchBuf,
  extForMime,
  FOLDER_ART_NAMES,
  IMG_EXTS,
  norm: _norm,
};
