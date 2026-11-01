const { spawn } = require("child_process");
const NodeID3 = require("node-id3");
/**
 * NovaTune — Music Discovery & Download Engine [v3.0 - Universal Search]
 * Multi-Engine Aggregator:
 *   - YouTube Music InnerTube (No API key required, infinite modern catalog)
 *   - JioSaavn Search (Comprehensive Asian, Global, Bollywood catalog)
 *   - iTunes Search API (Official Apple Music / iTunes store catalog)
 *   - Deezer API (Global streaming catalog fallback)
 *   - Spotify & YouTube URL resolvers
 *
 * Audio Stream Resolution & Download:
 *   - JioSaavn 320kbps pure AAC/MP4 streams (Pure JS DES-ECB decrypt)
 *   - Clean MP4 container preservation (Zero ID3 corruption for perfect Chromium playback)
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

// ─── Pure-JS DES-ECB Decryption ───────────────────────────────────────────────
const _DES_PC1_C = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36];
const _DES_PC1_D = [63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const _DES_PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const _DES_IP  = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const _DES_FP  = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const _DES_E   = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const _DES_P   = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const _DES_SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const _DES_S = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];

function _bit(bytes, n) { n--; return (bytes[n >> 3] >> (7 - (n & 7))) & 1; }
function _pc1Half(key8, table) { return table.map(p => _bit(key8, p)); }
function _rotL28(arr, n) { return [...arr.slice(n), ...arr.slice(0, n)]; }
function _pc2(cd) { return _DES_PC2.map(p => cd[p - 1]); }
function _permBits(input, table) { return table.map(p => input[p - 1]); }
function _bufToBits(buf, len) {
  const bits = new Array(len);
  for (let i = 0; i < len; i++) bits[i] = _bit(buf, i + 1);
  return bits;
}
function _bitsToBuffer(bits) {
  const buf = Buffer.alloc(Math.ceil(bits.length / 8), 0);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) buf[i >> 3] |= (1 << (7 - (i & 7)));
  }
  return buf;
}
function _generateSubkeys(key8) {
  let C = _pc1Half(key8, _DES_PC1_C);
  let D = _pc1Half(key8, _DES_PC1_D);
  const subkeys = [];
  for (let i = 0; i < 16; i++) {
    C = _rotL28(C, _DES_SHIFTS[i]);
    D = _rotL28(D, _DES_SHIFTS[i]);
    subkeys.push(_pc2([...C, ...D]));
  }
  return subkeys;
}
function _desRound(L, R, subkey) {
  const rExp = _DES_E.map(p => R[p - 1]);
  const xored = rExp.map((b, i) => b ^ subkey[i]);
  const sOut = [];
  for (let s = 0; s < 8; s++) {
    const g = xored.slice(s * 6, s * 6 + 6);
    const row = (g[0] << 1) | g[5];
    const col = (g[1] << 3) | (g[2] << 2) | (g[3] << 1) | g[4];
    const val = _DES_S[s][row * 16 + col];
    sOut.push((val >> 3) & 1, (val >> 2) & 1, (val >> 1) & 1, val & 1);
  }
  const pOut = _DES_P.map(p => sOut[p - 1]);
  const newR = L.map((b, i) => b ^ pOut[i]);
  return [R, newR];
}
function _desBlock(block8, subkeys) {
  const bits = _bufToBits(block8, 64);
  const ip = _permBits(bits, _DES_IP);
  let L = ip.slice(0, 32);
  let R = ip.slice(32, 64);
  for (const sk of subkeys) {
    [L, R] = _desRound(L, R, sk);
  }
  const fp = _permBits([...R, ...L], _DES_FP);
  return _bitsToBuffer(fp);
}
function desEcbDecrypt(ciphertext, key8) {
  const subkeys = _generateSubkeys(key8).reverse();
  const chunks = [];
  for (let i = 0; i < ciphertext.length; i += 8) {
    chunks.push(_desBlock(ciphertext.slice(i, i + 8), subkeys));
  }
  return Buffer.concat(chunks);
}
function decryptSaavnMediaUrl(encryptedUrl) {
  try {
    const key8 = Buffer.from("38346591", "utf8");
    const decoded = Buffer.from(encryptedUrl, "base64");
    const dec = desEcbDecrypt(decoded, key8);
    const url = dec.toString("utf8").replace(/[\x00-\x1f\x7f-\x9f]+$/, "").trim();
    if (url.startsWith("http")) return url;
  } catch (err) {
    console.warn("[DownloadEngine] DES-ECB decrypt failed:", err.message);
  }
  return null;
}

// ─── Network Utilities ────────────────────────────────────────────────────────
function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Referer: "https://www.jiosaavn.com/",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchJson(res.headers.location, timeoutMs));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch (err) { reject(new Error(`JSON parse failed: ${err.message}`)); }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
  });
}

function probeStreamUrl(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === "https:" ? https : http;
      const req = client.request(
        url,
        {
          method: "HEAD",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://www.jiosaavn.com/",
          },
          timeout: timeoutMs,
        },
        (res) => resolve(res.statusCode === 200)
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    } catch (_) {
      resolve(false);
    }
  });
}

async function resolveBestStreamUrl(rawUrl, has320Flag) {
  const candidates = [];
  if (has320Flag) {
    candidates.push({
      url: rawUrl.replace(/_96\.(mp4|mp3)$/, "_320.$1"),
      quality: "320kbps",
    });
  }
  candidates.push({
    url: rawUrl.replace(/_96\.(mp4|mp3)$/, "_160.$1"),
    quality: "160kbps",
  });
  candidates.push({
    url: rawUrl,
    quality: "96kbps",
  });

  for (const candidate of candidates) {
    const isOk = await probeStreamUrl(candidate.url);
    if (isOk) return candidate;
  }
  return { url: rawUrl, quality: "auto" };
}

// ─── Multi-Source Search Providers ────────────────────────────────────────────

// 1. YouTube Music InnerTube Search (Official YouTube client API, unlimited coverage)
function callYtmEndpoint(body, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: "music.youtube.com",
      path: "/youtubei/v1/search",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://music.youtube.com",
        "Referer": "https://music.youtube.com/"
      },
      timeout: timeoutMs
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}


function scrapeWatchDuration(videoId, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!videoId) return resolve(0);
    const parsedUrl = new URL(`https://www.youtube.com/watch?v=${videoId}`);
    const req = https.get(
      parsedUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: timeoutMs,
      },
      (res) => {
        let d = "";
        res.on("data", (chunk) => {
          d += chunk;
          const m =
            d.match(/itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i) ||
            d.match(/approxDurationMs["\s:]+(\d+)/);
          if (m) {
            req.destroy();
            if (m[0].includes("approxDurationMs")) {
              return resolve(parseInt(m[1], 10));
            } else {
              const h = parseInt(m[1] || "0", 10);
              const min = parseInt(m[2] || "0", 10);
              const s = parseInt(m[3] || "0", 10);
              return resolve((h * 3600 + min * 60 + s) * 1000);
            }
          }
        });
        res.on("end", () => {
          const m =
            d.match(/itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i) ||
            d.match(/approxDurationMs["\s:]+(\d+)/);
          if (m) {
            if (m[0].includes("approxDurationMs")) {
              resolve(parseInt(m[1], 10));
            } else {
              const h = parseInt(m[1] || "0", 10);
              const min = parseInt(m[2] || "0", 10);
              const s = parseInt(m[3] || "0", 10);
              resolve((h * 3600 + min * 60 + s) * 1000);
            }
          } else {
            resolve(0);
          }
        });
      }
    );
    req.on("error", () => resolve(0));
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function searchYouTubeMusic(query, limit = 40) {
  const baseClient = {
    client: {
      clientName: "WEB_REMIX",
      clientVersion: "1.20240101.01.00",
      hl: "en",
      gl: "US"
    }
  };

  // Run both Universal (for top hit card & unreleased/leaks) and Songs Filter (for exact track durations & albums) in parallel
  const [universalJson, songsJson] = await Promise.all([
    callYtmEndpoint({ context: baseClient, query: query.trim() }),
    callYtmEndpoint({ context: baseClient, query: query.trim(), params: "EgWKAQIIAWoSEAQQBRADEAkQChAVEBAQDhAR" })
  ]);

  const tracks = [];
  const seenVideoIds = new Set();
  const nonPlayableTypes = new Set(["album", "artist", "playlist", "single", "ep", "profile", "podcast", "episode"]);

  // Detect if a string is a duration (e.g. "3:45", "1:03:22")
  function parseDurationMs(str) {
    if (!str) return 0;
    const s = str.trim();
    const m2 = s.match(/^(\d+):(\d{2})$/);
    if (m2) return (Number(m2[1]) * 60 + Number(m2[2])) * 1000;
    const m3 = s.match(/^(\d+):(\d{2}):(\d{2})$/);
    if (m3) return (Number(m3[1]) * 3600 + Number(m3[2]) * 60 + Number(m3[3])) * 1000;
    return 0;
  }

  // Detect if a string looks like a YouTube views or plays count
  function isViewsString(str) {
    return /^\d[\d.,KMB]*\s+(views?|plays?)$/i.test((str || "").trim());
  }

  function parseItem(r) {
    if (!r) return null;
    const title =
      r.title?.runs?.map((x) => x.text).join("") ||
      r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((x) => x.text).join("");
    if (!title) return null;

    const subRuns =
      r.subtitle?.runs ||
      r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
      [];

    let artist = "Unknown Artist";
    let album = "";
    let durationMs = 0;

    // Check fixedColumns first if present
    if (r.fixedColumns?.[0]) {
      const fixedText = r.fixedColumns[0].musicResponsiveListItemFixedColumnRenderer?.text?.runs?.map((x) => x.text).join("");
      const d = parseDurationMs(fixedText);
      if (d > 0) durationMs = d;
    }

    if (subRuns.length > 0) {
      const parts = [];
      let current = [];
      for (const run of subRuns) {
        if (run.text === " \u2022 " || run.text === " • ") {
          parts.push(current.join("").trim());
          current = [];
        } else {
          current.push(run.text);
        }
      }
      if (current.length > 0) parts.push(current.join("").trim());

      // If duration not yet found, check last part
      if (durationMs === 0) {
        const lastPart = parts[parts.length - 1] || "";
        const durFromLast = parseDurationMs(lastPart);
        if (durFromLast > 0) {
          durationMs = durFromLast;
          parts.pop();
        }
      }

      // Filter out any "views" or "plays" count strings
      const meaningfulParts = parts.filter((p) => !isViewsString(p));

      if (meaningfulParts.length >= 1) {
        const firstLower = meaningfulParts[0].toLowerCase();
        if (nonPlayableTypes.has(firstLower)) return null;
        if (firstLower === "song" || firstLower === "video") {
          artist = meaningfulParts[1] || "Unknown Artist";
          album = meaningfulParts[2] || "";
        } else {
          artist = meaningfulParts[0];
          if (meaningfulParts.length >= 2) {
            album = meaningfulParts[1];
          }
        }
      }
    }

    const videoId =
      r.playlistItemData?.videoId ||
      r.navigationEndpoint?.watchEndpoint?.videoId ||
      r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

    if (!videoId || videoId.length < 5) return null;

    const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const art = thumbs[thumbs.length - 1]?.url || "";
    const thumb = thumbs[0]?.url || art;

    return {
      id: `ytm_${videoId}`,
      videoId: videoId,
      source: "ytmusic",
      trackName: title,
      artistName: artist,
      albumName: album,
      releaseYear: "",
      durationMs: durationMs,
      previewUrl: "",
      artworkUrl: art,
      artworkThumbnail: thumb,
      genre: "Music",
    };
  }

  // 1. Process universal search top card (gives the exact best match first)
  const universalSections =
    universalJson?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

  for (const sec of universalSections) {
    if (sec.musicCardShelfRenderer) {
      const card = sec.musicCardShelfRenderer;
      const title = card.title?.runs?.map((x) => x.text).join("");
      const subRuns = card.subtitle?.runs || [];

      const cardParts = [];
      let cur = [];
      for (const run of subRuns) {
        if (run.text === " \u2022 " || run.text === " • ") {
          cardParts.push(cur.join("").trim());
          cur = [];
        } else cur.push(run.text);
      }
      if (cur.length > 0) cardParts.push(cur.join("").trim());

      const cardType = (cardParts[0] || "").toLowerCase();
      if (!nonPlayableTypes.has(cardType)) {
        const cardLastPart = cardParts[cardParts.length - 1] || "";
        const cardDurationMs = parseDurationMs(cardLastPart);
        const cardMeaningful = cardParts.slice(1).filter((p) => !isViewsString(p) && parseDurationMs(p) === 0);
        const artist = cardMeaningful[0] || "Unknown Artist";

        const thumbs = card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        const art = thumbs[thumbs.length - 1]?.url || "";
        const thumb = thumbs[0]?.url || art;
        const videoId =
          card.onTap?.watchEndpoint?.videoId ||
          card.buttons?.find((b) => b.buttonRenderer?.navigationEndpoint?.watchEndpoint)?.buttonRenderer
            ?.navigationEndpoint?.watchEndpoint?.videoId;

        if (title && videoId && !seenVideoIds.has(videoId)) {
          seenVideoIds.add(videoId);
          tracks.push({
            id: `ytm_${videoId}`,
            videoId: videoId,
            source: "ytmusic",
            trackName: title,
            artistName: artist,
            albumName: "",
            releaseYear: "",
            durationMs: cardDurationMs,
            previewUrl: "",
            artworkUrl: art,
            artworkThumbnail: thumb,
            genre: "Music",
          });
        }
      }

      for (const it of card.contents || []) {
        const parsed = parseItem(it.musicResponsiveListItemRenderer);
        if (parsed && !seenVideoIds.has(parsed.videoId)) {
          seenVideoIds.add(parsed.videoId);
          tracks.push(parsed);
        }
      }
    }
  }

  // 2. Process Songs-filter results (gives rich track info, official releases & accurate durations)
  const songsSections =
    songsJson?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

  for (const sec of songsSections) {
    const contents = (sec.musicShelfRenderer || sec.itemSectionRenderer)?.contents || [];
    for (const it of contents) {
      const parsed = parseItem(it.musicResponsiveListItemRenderer);
      if (parsed && !seenVideoIds.has(parsed.videoId)) {
        seenVideoIds.add(parsed.videoId);
        tracks.push(parsed);
      }
      if (tracks.length >= limit) break;
    }
    if (tracks.length >= limit) break;
  }

  // 3. Process remaining universal sections (leaks, remixes, live performances)
  for (const sec of universalSections) {
    if (sec.musicCardShelfRenderer) continue;
    const contents = (sec.musicShelfRenderer || sec.itemSectionRenderer)?.contents || [];
    for (const it of contents) {
      const parsed = parseItem(it.musicResponsiveListItemRenderer);
      if (parsed && !seenVideoIds.has(parsed.videoId)) {
        seenVideoIds.add(parsed.videoId);
        tracks.push(parsed);
      }
      if (tracks.length >= limit) break;
    }
    if (tracks.length >= limit) break;
  }

  const slice = tracks.slice(0, limit);

  // Background enrich tracks with durationMs === 0 (e.g. unreleased leaks/videos)
  const zeroDurTracks = slice.filter((t) => (!t.durationMs || t.durationMs === 0) && t.videoId);
  if (zeroDurTracks.length > 0) {
    await Promise.all(
      zeroDurTracks.map(async (t) => {
        try {
          const scraped = await scrapeWatchDuration(t.videoId, 2000);
          if (scraped > 0) t.durationMs = scraped;
        } catch (_) {}
      })
    );
  }

  return slice;
}

// 2. JioSaavn Direct Search
function searchJioSaavn(query, limit = 15) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query.trim());
    const url = `https://www.jiosaavn.com/api.php?p=1&q=${encoded}&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=${limit}&__call=search.getResults`;
    
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.jiosaavn.com/"
      },
      timeout: 8000
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const results = (json.results || []).map((r) => {
            const rawImg = r.image || r.more_info?.image || "";
            const highImg = rawImg.replace(/\d+x\d+\.jpg$/, "500x500.jpg");
            const thumbImg = rawImg.replace(/\d+x\d+\.jpg$/, "150x150.jpg");
            const dur = parseInt(r.duration || r.more_info?.duration || "0", 10) * 1000;
            return {
              id: `saavn_${r.id}`,
              source: "saavn",
              trackName: r.title || r.song || "Unknown Track",
              artistName: r.more_info?.primary_artists || r.primary_artists || r.more_info?.singers || r.singers || "Unknown Artist",
              albumName: r.more_info?.album || r.album || "",
              releaseYear: r.year || r.more_info?.year || "",
              durationMs: dur,
              previewUrl: r.more_info?.preview_url || "",
              artworkUrl: highImg || rawImg,
              artworkThumbnail: thumbImg || rawImg,
              genre: "Music"
            };
          });
          resolve(results);
        } catch (_) {
          resolve([]);
        }
      });
    }).on("error", () => resolve([])).on("timeout", function() { this.destroy(); resolve([]); });
  });
}

// 3. Apple iTunes Store Search
function searchITunesInternal(query, limit = 15) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query.trim());
    const itunesUrl = `https://itunes.apple.com/search?term=${encoded}&media=music&entity=song&limit=${limit}`;
    fetchJson(itunesUrl, 7000)
      .then((data) => {
        const results = (data?.results || []).map((item) => {
          const artwork100 = item.artworkUrl100 || "";
          const artworkHigh = artwork100 ? artwork100.replace(/100x100/g, "600x600") : "";
          return {
            id: `itunes_${item.trackId}`,
            source: "itunes",
            trackName: item.trackName || "Unknown Track",
            artistName: item.artistName || "Unknown Artist",
            albumName: item.collectionName || "",
            releaseYear: item.releaseDate ? item.releaseDate.substring(0, 4) : "",
            durationMs: item.trackTimeMillis || 0,
            previewUrl: item.previewUrl || "",
            artworkUrl: artworkHigh || artwork100,
            artworkThumbnail: artwork100,
            genre: item.primaryGenreName || "Music",
          };
        });
        resolve(results);
      })
      .catch(() => resolve([]));
  });
}

// 4. Deezer Search
function searchDeezerInternal(query, limit = 15) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query.trim());
    fetchJson(`https://api.deezer.com/search?q=${encoded}&limit=${limit}`, 6000)
      .then((data) => {
        const results = (data?.data || []).map((item) => {
          const art = item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || "";
          const thumb = item.album?.cover_small || item.album?.cover_medium || "";
          return {
            id: `deezer_${item.id}`,
            source: "deezer",
            trackName: item.title || "Unknown Track",
            artistName: item.artist?.name || "Unknown Artist",
            albumName: item.album?.title || "",
            releaseYear: "",
            durationMs: (item.duration || 0) * 1000,
            previewUrl: item.preview || "",
            artworkUrl: art,
            artworkThumbnail: thumb,
            genre: "Music",
          };
        });
        resolve(results);
      })
      .catch(() => resolve([]));
  });
}

// 5. Universal URL metadata resolver (YouTube, Spotify, Apple Music)
async function resolveUrlMetadata(inputUrl) {
  try {
    let urlStr = inputUrl.trim();

    // YouTube / YouTube Music normalization
    if (urlStr.includes("youtube.com") || urlStr.includes("youtu.be/")) {
      let cleanYtUrl = urlStr;
      if (cleanYtUrl.includes("youtu.be/")) {
        const id = cleanYtUrl.split("youtu.be/")[1].split("?")[0].split("&")[0];
        cleanYtUrl = "https://www.youtube.com/watch?v=" + id;
      } else if (cleanYtUrl.includes("music.youtube.com")) {
        cleanYtUrl = cleanYtUrl.replace("music.youtube.com", "www.youtube.com");
      }
      const data = await fetchJson("https://www.youtube.com/oembed?url=" + encodeURIComponent(cleanYtUrl) + "&format=json", 6000);
      if (data && data.title) {
        return data.title
          .replace(/\(Official\s*(Video|Audio|Music Video|Lyric Video)\)/gi, "")
          .replace(/\[Official\s*(Video|Audio|Music Video|Lyric Video)\]/gi, "")
          .replace(/\(Lyrics?\)/gi, "")
          .replace(/\[Lyrics?\]/gi, "")
          .replace(/\|.*/g, "")
          .trim();
      }
    }

    // Spotify track link normalization
    if (urlStr.includes("open.spotify.com/track/")) {
      const match = urlStr.match(/track\/([a-zA-Z0-9]+)/);
      if (match) {
        const cleanSpotifyUrl = `https://open.spotify.com/track/${match[1]}`;
        const data = await fetchJson("https://open.spotify.com/oembed?url=" + encodeURIComponent(cleanSpotifyUrl), 6000);
        if (data && data.title) return data.title.trim();
      }
    }
  } catch (err) {
    console.warn("[DownloadEngine] URL resolve failed:", err.message);
  }
  return null;
}

// ─── Main Universal Search Aggregator ─────────────────────────────────────────
async function searchITunes(query, limit = 80) {
  let effectiveQuery = query.trim();
  if (effectiveQuery.startsWith("http://") || effectiveQuery.startsWith("https://")) {
    const resolvedTitle = await resolveUrlMetadata(effectiveQuery);
    if (resolvedTitle) effectiveQuery = resolvedTitle;
  }

  // Execute providers: YouTube Music gets primary high priority (35 items), Saavn, iTunes & Deezer get secondary
  const [ytmResults, saavnResults, itunesResults, deezerResults] = await Promise.all([
    searchYouTubeMusic(effectiveQuery, 40),
    searchJioSaavn(effectiveQuery, 15),
    searchITunesInternal(effectiveQuery, 20),
    searchDeezerInternal(effectiveQuery, 15),
  ]);

  const results = [];
  const seenSignatures = new Set();

  const addTrack = (track) => {
    if (!track) return;
    const cleanTitle = (track.trackName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanArtist = (track.artistName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const sig = `${cleanTitle}__${cleanArtist}`;
    if (!seenSignatures.has(sig) && cleanTitle.length > 0) {
      seenSignatures.add(sig);
      results.push(track);
    }
  };

  // Give top priority to YouTube Music hits first (so rare/leaked/unreleased songs are immediately front and center)
  for (const t of ytmResults) addTrack(t);

  // Then add other providers for variety
  const maxLen = Math.max(saavnResults.length, itunesResults.length, deezerResults.length);
  for (let i = 0; i < maxLen; i++) {
    if (itunesResults[i]) addTrack(itunesResults[i]);
    if (deezerResults[i]) addTrack(deezerResults[i]);
    if (saavnResults[i]) addTrack(saavnResults[i]);
  }

  return results.slice(0, limit);
}

// ─── Stream Resolution & Match Scoring ────────────────────────────────────────
function scoreMatch(result, trackName, artistName) {
  const title = (result.title || result.song || "").toLowerCase();
  const artists = (result.more_info?.music || result.more_info?.singers || result.primary_artists || result.singers || "").toLowerCase();
  const tName = trackName.toLowerCase();
  const aName = artistName.toLowerCase();

  let score = 0;
  let hasTitleMatch = false;

  if (title === tName) { score += 50; hasTitleMatch = true; }
  else if (title.startsWith(tName + " (") || title.startsWith(tName + " [")) { score += 35; hasTitleMatch = true; }
  else if (title.startsWith(tName)) { score += 25; hasTitleMatch = true; }
  else if (title.includes(tName)) { score += 15; hasTitleMatch = true; }

  const artistWords = aName.split(/[\s,]+/).filter((w) => w.length > 2);
  let artistMatched = false;
  for (const word of artistWords) {
    if (artists.includes(word)) { score += 15; artistMatched = true; }
  }

  // CRITICAL: If neither title nor artist matched at all, do NOT award points!
  if (!hasTitleMatch && !artistMatched) return 0;

  const penaltyWords = [
    "karaoke", "tribute", "originally performed",
    "dubstep", "dnb", "drum and bass", "garage", "techno", "house mix"
  ];
  for (const p of penaltyWords) {
    if (title.includes(p)) { score -= 40; break; }
  }

  if (hasTitleMatch && (result.more_info?.["320kbps"] === "true" || result["320kbps"] === "true")) {
    score += 5;
  }

  return score;
}

async function resolveSaavnStream(trackName, artistName) {
  const cleanTrack = trackName.replace(/\(.*?\)|\[.*?\]/g, "").trim();
  const queries = [
    `${trackName} ${artistName}`.trim(),
    `${cleanTrack} ${artistName}`.trim(),
    cleanTrack,
    trackName.trim(),
  ];

  const uniqueQueries = [...new Set(queries.filter(Boolean))];

  for (const q of uniqueQueries) {
    const encodedQuery = encodeURIComponent(q);
    const searchUrl =
      `https://www.jiosaavn.com/api.php?p=1&q=${encodedQuery}` +
      `&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=12&__call=search.getResults`;

    try {
      const data = await fetchJson(searchUrl, 10000);
      const results = data?.results;
      if (!results || !results.length) continue;

      const scored = results
        .map((r) => ({ r, score: scoreMatch(r, trackName, artistName) }))
        .sort((a, b) => b.score - a.score);

      for (const { r, score } of scored) {
        const encryptedUrl = r.more_info?.encrypted_media_url || r.encrypted_media_url;
        if (!encryptedUrl) continue;

        const rawDecrypted = decryptSaavnMediaUrl(encryptedUrl);
        if (!rawDecrypted || !rawDecrypted.startsWith("http")) continue;

        const has320 = r.more_info?.["320kbps"] === "true" || r["320kbps"] === "true";
        const best = await resolveBestStreamUrl(rawDecrypted, has320);

        const imageRaw = r.more_info?.image || r.image || "";
        const image = imageRaw.replace(/\d+x\d+\.jpg$/, "500x500.jpg");

        console.log(
          `[DownloadEngine] Matched "${r.title || r.song}" (score=${score}, quality=${best.quality}) → ${best.url.substring(0, 60)}...`
        );

        return {
          streamUrl: best.url,
          quality: best.quality,
          title: r.title || r.song || trackName,
          artist: r.more_info?.music || r.primary_artists || artistName,
          album: r.more_info?.album || r.album || "",
          image,
        };
      }
    } catch (err) {
      console.warn("[DownloadEngine] JioSaavn query error:", err.message);
    }
  }

  console.warn("[DownloadEngine] JioSaavn: No usable stream URL found for", trackName, artistName);
  return null;
}

// ─── Downloader with MP4 Structure Protection ─────────────────────────────────
function downloadFileWithProgress(streamUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(streamUrl);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const req = client.get(
      streamUrl,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://www.jiosaavn.com/",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(downloadFileWithProgress(res.headers.location, destPath, onProgress));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Stream HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let downloadedBytes = 0;

        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const tempPath = `${destPath}.part`;
        const fileStream = fs.createWriteStream(tempPath, { highWaterMark: 64 * 1024 });

        res.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && onProgress) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            onProgress({ downloadedBytes, totalBytes, percent });
          }
        });

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tempPath, destPath);
              resolve(destPath);
            } catch (renameErr) { reject(renameErr); }
          });
        });

        fileStream.on("error", (err) => {
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
          reject(err);
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Download stream timed out")); });
  });
}

// ─── Download & Store Orchestration ───────────────────────────────────────────
function getYtDlpPath() {
  const localBin = path.join(__dirname, "../bin/yt-dlp.exe");
  if (fs.existsSync(localBin)) return localBin;
  try {
    const { app } = require("electron");
    if (app) {
      const userBin = path.join(app.getPath("userData"), "bin/yt-dlp.exe");
      if (fs.existsSync(userBin)) return userBin;
    }
  } catch (_) {}
  return "yt-dlp";
}

function downloadWithYtDlp(urlOrQuery, destBase, onProgress) {
  return new Promise((resolve, reject) => {
    const ytDlpBinary = getYtDlpPath();
    const args = [
      urlOrQuery,
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--embed-thumbnail",
      "--add-metadata",
      "-o", `${destBase}.%(ext)s`,
      "--no-playlist",
      "--newline"
    ];

    let finalFile = null;
    let proc = null;
    try {
      proc = spawn(ytDlpBinary, args, { windowsHide: true });
    } catch (err) {
      return reject(err);
    }

    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const text = line.trim();
        const pMatch = text.match(/\[download\]\s+([0-9.]+)%/);
        if (pMatch && onProgress) {
          const pct = Math.min(95, Math.round(parseFloat(pMatch[1])));
          onProgress({ status: "downloading", percent: 10 + Math.round((pct * 80) / 100), message: `Downloading… ${pct}%` });
        }
        if (text.includes("[ExtractAudio] Destination:") || text.includes("[download] Destination:")) {
          const m = text.match(/Destination:\s*(.*)$/);
          if (m && m[1]) finalFile = m[1].trim();
        }
      }
    });

    proc.stderr.on("data", () => {});

    proc.on("close", (code) => {
      if (code === 0) {
        const expectedMp3 = `${destBase}.mp3`;
        if (fs.existsSync(expectedMp3)) return resolve(expectedMp3);
        if (finalFile && fs.existsSync(finalFile)) return resolve(finalFile);
        const dir = path.dirname(destBase);
        const baseName = path.basename(destBase);
        const files = fs.readdirSync(dir);
        const matched = files.find(f => f.startsWith(baseName) && (f.endsWith(".mp3") || f.endsWith(".m4a")));
        if (matched) return resolve(path.join(dir, matched));
        resolve(expectedMp3);
      } else {
        reject(new Error(`yt-dlp process exited with code ${code}`));
      }
    });

    proc.on("error", reject);
  });
}

// ─── Post-download metadata injection ─────────────────────────────────────────
// After yt-dlp embeds YouTube metadata (often wrong: uploader name as artist,
// video title as track name), overwrite with the rich trackInfo the user clicked.
function injectTrackInfoTags(filePath, trackInfo) {
  try {
    if (!filePath.endsWith(".mp3")) return; // Only ID3 on MP3s
    const cleanTags = {};

    // Title: trackInfo always wins — yt-dlp uses the YouTube video title
    if (trackInfo.trackName && trackInfo.trackName.trim())
      cleanTags.title = trackInfo.trackName.trim();

    // Artist: trackInfo always wins — yt-dlp uses the uploader channel name
    if (trackInfo.artistName && trackInfo.artistName !== "Unknown Artist" && trackInfo.artistName.trim())
      cleanTags.artist = trackInfo.artistName.trim();

    // Album artist: same as artist if not separately specified
    if (cleanTags.artist)
      cleanTags.performerInfo = cleanTags.artist;

    // Album: only if we have a real name (not empty/unknown)
    if (trackInfo.albumName && trackInfo.albumName.trim() && trackInfo.albumName !== "Unknown Album")
      cleanTags.album = trackInfo.albumName.trim();

    // Year: only if plausible
    const yr = Number(trackInfo.releaseYear);
    if (yr > 1900 && yr <= new Date().getFullYear() + 1)
      cleanTags.year = String(yr);

    // Genre: skip the generic "Music" placeholder
    if (trackInfo.genre && trackInfo.genre !== "Music" && trackInfo.genre.trim())
      cleanTags.genre = trackInfo.genre.trim();

    if (Object.keys(cleanTags).length > 0) {
      // NodeID3.update() preserves existing APIC (embedded thumbnail) frames
      const result = NodeID3.update(cleanTags, filePath);
      if (result === true) {
        console.log(`[DownloadEngine] Tags injected for "${trackInfo.trackName}" →`, Object.keys(cleanTags).join(", "));
      } else {
        console.warn("[DownloadEngine] NodeID3.update returned:", result);
      }
    }
  } catch (tagErr) {
    console.warn("[DownloadEngine] Failed to inject track tags:", tagErr.message);
  }
}

async function downloadAndTagTrack(trackInfo, targetFolder, onProgress) {
  onProgress({ status: "resolving", percent: 5, message: "Resolving audio stream…" });

  const sanitize = (name) => name.replace(/[<>:"/\\|?*]/g, "").trim();
  const safeArtist = sanitize(trackInfo.artistName || "Unknown Artist");
  const safeTitle = sanitize(trackInfo.trackName || "Unknown Track");
  const destBase = path.join(targetFolder, `${safeArtist} - ${safeTitle}`);

  if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });

  // Priority 1: Direct YouTube Music download if videoId is known
  const videoId = trackInfo.videoId || (trackInfo.id && trackInfo.id.startsWith("ytm_") ? trackInfo.id.replace("ytm_", "") : null);
  if (videoId && videoId.length >= 5) {
    try {
      onProgress({ status: "downloading", percent: 10, message: "Downloading high quality audio via yt-dlp…" });
      const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const downloadedPath = await downloadWithYtDlp(targetUrl, destBase, onProgress);
      // Overwrite yt-dlp's auto-tags with rich metadata from the search card
      injectTrackInfoTags(downloadedPath, trackInfo);
      onProgress({ status: "done", percent: 100, message: "Done!", filePath: downloadedPath });
      return downloadedPath;
    } catch (ytdlpErr) {
      console.warn("[DownloadEngine] Direct yt-dlp videoId failed, falling back:", ytdlpErr.message);
    }
  }

  // Priority 2: High accuracy yt-dlp query search (for Spotify, iTunes, Deezer items)
  try {
    const searchQuery = `ytsearch1:${trackInfo.artistName} - ${trackInfo.trackName} official audio`;
    onProgress({ status: "downloading", percent: 10, message: "Searching and downloading via yt-dlp…" });
    const downloadedPath = await downloadWithYtDlp(searchQuery, destBase, onProgress);
    // Overwrite yt-dlp's auto-tags with rich metadata from the search card
    injectTrackInfoTags(downloadedPath, trackInfo);
    onProgress({ status: "done", percent: 100, message: "Done!", filePath: downloadedPath });
    return downloadedPath;
  } catch (ytdlpSearchErr) {
    console.warn("[DownloadEngine] ytsearch1 failed, checking Saavn fallback:", ytdlpSearchErr.message);
  }

  // Priority 3: JioSaavn fallback (strictly checked with scoreMatch) — M4A, no ID3 injection needed
  const resolved = await resolveSaavnStream(trackInfo.trackName, trackInfo.artistName);
  if (resolved && resolved.streamUrl) {
    const destPath = `${destBase}.m4a`;
    onProgress({ status: "downloading", percent: 15, message: `Downloading (${resolved.quality})…` });
    await downloadFileWithProgress(resolved.streamUrl, destPath, (prog) => {
      const scaledPercent = 15 + Math.round((prog.percent * 80) / 100);
      onProgress({
        status: "downloading",
        percent: scaledPercent,
        downloadedBytes: prog.downloadedBytes,
        totalBytes: prog.totalBytes,
        message: `Downloading… ${prog.percent}%`,
      });
    });
    onProgress({ status: "done", percent: 100, message: "Done!", filePath: destPath });
    return destPath;
  }

  throw new Error("Could not find an authentic audio stream for this track.");
}

module.exports = { searchITunes, resolveSaavnStream, downloadAndTagTrack, getYtDlpPath };
