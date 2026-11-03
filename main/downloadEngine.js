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

const HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 24, keepAliveMsecs: 15000 });
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
        agent: parsedUrl.protocol === "https:" ? HTTPS_AGENT : undefined,
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
      timeout: timeoutMs,
      agent: HTTPS_AGENT
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
        agent: HTTPS_AGENT,
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
      timeout: 8000,
      agent: HTTPS_AGENT
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

// ─── Normalisation / Merge / Relevance ────────────────────────────────────────
const _norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

function _titleCore(title) {
  return _norm(
    (title || "")
      .replace(/[\(\[]\s*(feat|ft|featuring|with|prod)\b[^\)\]]*[\)\]]/gi, "")
      .replace(/\s[-–]\s*(feat|ft|featuring)\.?\s.*$/i, "")
  ).replace(/\s/g, "");
}

const _FLAG_RE = /\b(remix|live|acoustic|instrumental|karaoke|cover|slowed|sped|reverb|nightcore|8d|demo|tribute|lofi|cappella)\b/g;
function _flags(title, album) {
  const found = new Set((_norm(title + " " + album).match(_FLAG_RE)) || []);
  return [...found].sort().join(",");
}

function _artistTokens(name) {
  return (name || "")
    .replace(/\s-\s*topic$/i, "")
    .split(/,|&|;|\/|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b/i)
    .map(_norm).filter((x) => x && x !== "unknown artist");
}

function _dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = new Map();
  for (let i = 0; i < a.length - 1; i++) { const k = a.substr(i, 2); bg.set(k, (bg.get(k) || 0) + 1); }
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const k = b.substr(i, 2); const c = bg.get(k) || 0;
    if (c > 0) { bg.set(k, c - 1); hit++; }
  }
  return (2 * hit) / (a.length + b.length - 2);
}

function _info(t) {
  return { core: _titleCore(t.trackName), flags: _flags(t.trackName || "", t.albumName || ""), artists: _artistTokens(t.artistName) };
}

function _sameSong(g, info, dur) {
  if (g.info.flags !== info.flags) return false;
  if (!g.info.core || !info.core) return false;
  const ao = g.info.artists.some((x) => info.artists.some((y) => x === y || (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)))));
  if (!ao) return false;
  const gd = g.primary.durationMs || 0;
  if (gd && dur && Math.abs(gd - dur) > 4000) return false;
  if (g.info.core === info.core) return true;
  return g.info.core.length >= 4 && _dice(g.info.core, info.core) >= 0.9;
}

const _PENALTIES = [
  ["karaoke", /\b(karaoke|originally performed|tribute)\b/],
  ["live", /\blive\b/],
  ["cover", /\bcover\b/],
  ["remix", /\bremix\b/],
  ["instrumental", /\binstrumental\b/],
  ["slowed", /\b(slowed|sped up|reverb|nightcore|8d)\b/],
];

function _score(t, qn, qWords, srcCount, idx) {
  const title = _norm(t.trackName), artist = _norm(t.artistName), album = _norm(t.albumName);
  const hayWords = (title + " " + artist + " " + album).split(" ");
  let s = 0;
  if (title && title === qn) s += 50;
  else if (title.length >= 3 && qn.includes(title)) s += 30;
  else if (qn && title.includes(qn)) s += 28;
  if (qWords.length) {
    let hit = 0;
    for (const w of qWords) if (hayWords.some((h) => h === w || (w.length >= 3 && h.startsWith(w)))) hit++;
    s += 40 * (hit / qWords.length);
  }
  if (qn === `${artist} ${title}` || qn === `${title} ${artist}`) s += 20;
  if (artist.split(" ").some((w) => w.length > 2 && qWords.includes(w))) s += 10;

  if (t.source === "ytmusic" && t.albumName) s += 6;
  if (/\bofficial (audio|music video|video)\b/.test(title) || /\stopic$/.test(artist)) s += 5;
  if (t.source === "itunes" || t.source === "deezer") s += 4;
  s += Math.min(srcCount - 1, 2) * 4;

  const tx = title + " " + album;
  for (const [word, re] of _PENALTIES) {
    if (re.test(tx) && !(word === "karaoke" ? /\b(karaoke|tribute)\b/.test(qn) : re.test(qn))) s -= 30;
  }

  const d = t.durationMs || 0;
  if (d > 0) {
    if (d >= 60000 && d <= 600000) s += 3;
    else if (d > 900000) s -= 8;
  }
  return s - idx * 0.05;
}

function rankAndMerge(tracks, query) {
  const groups = [];
  for (const t of tracks) {
    if (!t || !_norm(t.trackName)) continue;
    const info = _info(t);
    const g = groups.find((x) => _sameSong(x, info, t.durationMs || 0));
    if (!g) { groups.push({ primary: t, info, sources: new Set([t.source]) }); continue; }
    g.sources.add(t.source);
    if (!g.primary.durationMs && t.durationMs) g.primary.durationMs = t.durationMs;
    if (!g.primary.videoId && t.videoId) g.primary.videoId = t.videoId;
  }
  const qn = _norm(query);
  const qWords = qn.split(" ").filter(Boolean);
  return groups
    .map((g, i) => ({ t: g.primary, sc: _score(g.primary, qn, qWords, g.sources.size, i) }))
    .sort((a, b) => b.sc - a.sc)
    .map((x) => x.t);
}

// ─── Main Universal Search Aggregator ─────────────────────────────────────────
const SEARCH_CACHE = new Map();
const SEARCH_CACHE_TTL = 7 * 60 * 1000;
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchITunes(query, limit = 80, onUpdate) {
  let effectiveQuery = query.trim();
  if (effectiveQuery.startsWith("http://") || effectiveQuery.startsWith("https://")) {
    const resolvedTitle = await resolveUrlMetadata(effectiveQuery);
    if (resolvedTitle) effectiveQuery = resolvedTitle;
  }

  const key = effectiveQuery.toLowerCase();
  const hit = SEARCH_CACHE.get(key);
  if (hit && Date.now() - hit.t < SEARCH_CACHE_TTL) return hit.results.slice(0, limit);

  const buckets = { ytm: [], itunes: [], deezer: [], saavn: [] };
  const scraped = new Map();
  let done = false;

  const build = () => {
    const others = [];
    const maxLen = Math.max(buckets.itunes.length, buckets.deezer.length, buckets.saavn.length);
    for (let i = 0; i < maxLen; i++) {
      if (buckets.itunes[i]) others.push(buckets.itunes[i]);
      if (buckets.deezer[i]) others.push(buckets.deezer[i]);
      if (buckets.saavn[i]) others.push(buckets.saavn[i]);
    }
    const ordered = [...buckets.ytm, ...others];
    for (const t of ordered) {
      if (t.videoId && !t.durationMs && scraped.has(t.videoId)) t.durationMs = scraped.get(t.videoId);
    }
    return rankAndMerge(ordered, effectiveQuery).slice(0, limit);
  };

  const emit = () => {
    const r = build();
    if (done) {
      SEARCH_CACHE.set(key, { t: Date.now(), results: r });
      if (SEARCH_CACHE.size > 60) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value);
    }
    if (onUpdate) { try { onUpdate(r); } catch (_) {} }
    return r;
  };

  const run = (fn, name) =>
    fn().catch(() => []).then((res) => {
      buckets[name] = Array.isArray(res) ? res : [];
      if (buckets[name].length) emit();
    });

  const all = Promise.all([
    run(() => searchYouTubeMusic(effectiveQuery, 40), "ytm"),
    run(() => searchJioSaavn(effectiveQuery, 15), "saavn"),
    run(() => searchITunesInternal(effectiveQuery, 20), "itunes"),
    run(() => searchDeezerInternal(effectiveQuery, 15), "deezer"),
  ]);
  const hasAny = () => Object.values(buckets).some((b) => b.length);

  await Promise.race([all, _sleep(3000)]);
  if (!hasAny()) await Promise.race([all, _sleep(5000)]);

  done = true;
  const final = emit();

  // Fill missing durations afterwards (non-blocking)
  const need = final.filter((t) => t.videoId && !t.durationMs).slice(0, 24);
  if (need.length) {
    (async () => {
      let timer = null;
      const queue = [...need];
      const worker = async () => {
        while (queue.length) {
          const t = queue.shift();
          try {
            const ms = await scrapeWatchDuration(t.videoId, 2500);
            if (ms > 0) {
              scraped.set(t.videoId, ms);
              if (!timer) timer = setTimeout(() => { timer = null; emit(); }, 400);
            }
          } catch (_) {}
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (timer) { clearTimeout(timer); timer = null; }
      if (scraped.size) emit();
    })();
  }

  return final;
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
  // 1. Packaged app: electron-builder puts extraResources next to the exe
  //    at <install>/resources/bin/yt-dlp.exe (process.resourcesPath)
  if (process.resourcesPath) {
    const resourcesBin = path.join(process.resourcesPath, "bin", "yt-dlp.exe");
    if (fs.existsSync(resourcesBin)) return resourcesBin;
  }

  // 2. Dev mode (npm start): binary lives in <repo>/bin/yt-dlp.exe
  //    __dirname is main/ so we go up one level
  const devBin = path.join(__dirname, "../bin/yt-dlp.exe");
  if (fs.existsSync(devBin)) return devBin;

  // 3. User-data fallback (auto-downloaded at runtime if missing from both)
  try {
    const { app } = require("electron");
    if (app) {
      const userBin = path.join(app.getPath("userData"), "bin", "yt-dlp.exe");
      if (fs.existsSync(userBin)) return userBin;
    }
  } catch (_) {}

  // 4. PATH lookup
  return "yt-dlp";
}

/**
 * Downloads yt-dlp binary from GitHub release if not found locally.
 * Guarantees that any released app has a fully functioning engine even on clean machines.
 */
function downloadYtDlpBinary(targetPath, onProgress) {
  return new Promise((resolve, reject) => {
    const url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

    function fetchWithRedirects(currentUrl, hops = 0) {
      if (hops > 5) return reject(new Error("Too many redirects downloading yt-dlp"));
      const parsed = new URL(currentUrl);
      const client = parsed.protocol === "https:" ? https : http;

      const req = client.get(currentUrl, {
        headers: { "User-Agent": "Mozilla/5.0 NovaTune Downloader" }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, currentUrl).href;
          return fetchWithRedirects(nextUrl, hops + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download yt-dlp: HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const tmpFile = `${targetPath}.tmp`;
        const fileStream = fs.createWriteStream(tmpFile);

        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (totalBytes > 0 && onProgress) {
            const pct = Math.round((downloaded / totalBytes) * 100);
            onProgress({ percent: pct, downloaded, total: totalBytes });
          }
        });

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
              fs.renameSync(tmpFile, targetPath);
              resolve(targetPath);
            } catch (err) { reject(err); }
          });
        });

        fileStream.on("error", (err) => {
          try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
          reject(err);
        });
      });

      req.on("error", reject);
      req.setTimeout(60000, () => {
        req.destroy();
        reject(new Error("yt-dlp download timed out"));
      });
    }

    fetchWithRedirects(url);
  });
}

/**
 * Ensures yt-dlp.exe exists and is executable.
 * If completely missing from resources and local bin, downloads it to userData/bin/yt-dlp.exe.
 */
async function ensureYtDlpAvailable(onProgress) {
  const currentPath = getYtDlpPath();
  if (currentPath !== "yt-dlp" && fs.existsSync(currentPath)) {
    return currentPath;
  }

  // If "yt-dlp" is on system PATH, verify it works
  if (currentPath === "yt-dlp") {
    try {
      const { execSync } = require("child_process");
      execSync("yt-dlp --version", { stdio: "ignore", windowsHide: true });
      return "yt-dlp";
    } catch (_) {}
  }

  // Not found anywhere! Automatically download to userData/bin/yt-dlp.exe
  let targetPath = null;
  try {
    const { app } = require("electron");
    if (app) {
      targetPath = path.join(app.getPath("userData"), "bin", "yt-dlp.exe");
    }
  } catch (_) {}

  if (!targetPath) {
    targetPath = path.join(__dirname, "../bin/yt-dlp.exe");
  }

  if (onProgress) {
    onProgress({ status: "installing", percent: 0, message: "Setting up downloader components (one-time)…" });
  }

  console.log("[DownloadEngine] yt-dlp binary missing! Auto-installing to:", targetPath);
  await downloadYtDlpBinary(targetPath, (prog) => {
    if (onProgress) {
      onProgress({
        status: "installing",
        percent: Math.round(prog.percent * 0.9),
        message: `Setting up downloader components… ${prog.percent}%`
      });
    }
  });

  return targetPath;
}

async function downloadWithYtDlp(urlOrQuery, destBase, onProgress) {
  const ytDlpBinary = await ensureYtDlpAvailable(onProgress);

  return new Promise((resolve, reject) => {
    const args = [
      urlOrQuery,
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--add-metadata",
      "--concurrent-fragments", "4",
      "-o", `${destBase}.%(ext)s`,
      "--no-playlist",
      "--newline"
    ];

    let finalFile = null;
    let proc = null;
    let errorOutput = "";

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

    proc.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

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
        const cleanErr = errorOutput.trim() || `Process exited with code ${code}`;
        reject(new Error(`Download failed: ${cleanErr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to launch downloader: ${err.message}`));
    });
  });
}

function fetchArtworkBuffer(url, timeoutMs = 6000, hops = 0) {
  return new Promise((resolve) => {
    if (!url || hops > 3) return resolve(null);
    try {
      const u = new URL(url);
      const isHttps = u.protocol === "https:";
      const req = (isHttps ? https : http).get(
        url,
        { headers: { "User-Agent": UA_DESKTOP, Accept: "image/jpeg,image/png,image/*" }, agent: isHttps ? HTTPS_AGENT : undefined, timeout: timeoutMs },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return resolve(fetchArtworkBuffer(new URL(res.headers.location, url).href, timeoutMs, hops + 1));
          }
          if (res.statusCode !== 200) { res.resume(); return resolve(null); }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => { const b = Buffer.concat(chunks); resolve(b.length > 1000 ? b : null); });
          res.on("error", () => resolve(null));
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
    } catch (_) { resolve(null); }
  });
}

function _artImage(buf) {
  if (!buf) return null;
  let mime = null;
  if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
  else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) mime = "image/png";
  return mime ? { mime, type: { id: 3, name: "front cover" }, description: "Cover", imageBuffer: buf } : null;
}

// ─── Post-download metadata injection ─────────────────────────────────────────
function injectTrackInfoTags(filePath, trackInfo, artBuf) {
  try {
    if (!filePath.endsWith(".mp3")) return;
    const cleanTags = {};

    if (trackInfo.trackName && trackInfo.trackName.trim())
      cleanTags.title = trackInfo.trackName.trim();

    if (trackInfo.artistName && trackInfo.artistName !== "Unknown Artist" && trackInfo.artistName.trim())
      cleanTags.artist = trackInfo.artistName.trim();

    if (cleanTags.artist)
      cleanTags.performerInfo = cleanTags.artist;

    if (trackInfo.albumName && trackInfo.albumName.trim() && trackInfo.albumName !== "Unknown Album")
      cleanTags.album = trackInfo.albumName.trim();

    const yr = Number(trackInfo.releaseYear);
    if (yr > 1900 && yr <= new Date().getFullYear() + 1)
      cleanTags.year = String(yr);

    if (trackInfo.genre && trackInfo.genre !== "Music" && trackInfo.genre.trim())
      cleanTags.genre = trackInfo.genre.trim();

    const img = _artImage(artBuf);
    if (img) cleanTags.image = img;

    if (Object.keys(cleanTags).length > 0) {
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
  onProgress({ status: "resolving", percent: 5, message: "Resolving audio with yt-dlp…" });

  const sanitize = (name) => name.replace(/[<>:"/\\|?*]/g, "").trim();
  const safeArtist = sanitize(trackInfo.artistName || "Unknown Artist");
  const safeTitle = sanitize(trackInfo.trackName || "Unknown Track");
  const destBase = path.join(targetFolder, `${safeArtist} - ${safeTitle}`);

  if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });

  const artPromise = fetchArtworkBuffer(trackInfo.artworkUrl);

  // Strategy 1: Direct YouTube video download if videoId is present
  const videoId = trackInfo.videoId || (trackInfo.id && trackInfo.id.startsWith("ytm_") ? trackInfo.id.replace("ytm_", "") : null);
  if (videoId && videoId.length >= 5) {
    try {
      onProgress({ status: "downloading", percent: 10, message: "Downloading audio via yt-dlp…" });
      const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const downloadedPath = await downloadWithYtDlp(targetUrl, destBase, onProgress);
      injectTrackInfoTags(downloadedPath, trackInfo, await artPromise);
      onProgress({ status: "done", percent: 100, message: "Done!", filePath: downloadedPath });
      return downloadedPath;
    } catch (ytdlpErr) {
      console.warn("[DownloadEngine] Direct videoId failed, trying ytsearch1 with yt-dlp:", ytdlpErr.message);
    }
  }

  // Strategy 2: Accurate search query with yt-dlp
  const searchQuery = `ytsearch1:${trackInfo.artistName} - ${trackInfo.trackName} audio`;
  onProgress({ status: "downloading", percent: 10, message: "Searching and downloading via yt-dlp…" });
  const downloadedPath = await downloadWithYtDlp(searchQuery, destBase, onProgress);
  injectTrackInfoTags(downloadedPath, trackInfo, await artPromise);
  onProgress({ status: "done", percent: 100, message: "Done!", filePath: downloadedPath });
  return downloadedPath;
}

module.exports = { searchITunes, downloadAndTagTrack, getYtDlpPath, ensureYtDlpAvailable };
