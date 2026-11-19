const { spawn } = require("child_process");
const NodeID3 = require("node-id3");
const TagLib = require("node-taglib-sharp");
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
 *   - Clean MP4 container preservation (Zero ID3 corruption for perfect Chromium playback)
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 24,
  keepAliveMsecs: 15000,
});
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Network Utilities ────────────────────────────────────────────────────────
function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Referer: "https://www.jiosaavn.com/",
        },
        timeout: timeoutMs,
        agent: parsedUrl.protocol === "https:" ? HTTPS_AGENT : undefined,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return resolve(fetchJson(res.headers.location, timeoutMs));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`JSON parse failed: ${err.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
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
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://www.jiosaavn.com/",
          },
          timeout: timeoutMs,
        },
        (res) => resolve(res.statusCode === 200),
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    } catch (_) {
      resolve(false);
    }
  });
}

// ─── Multi-Source Search Providers ────────────────────────────────────────────

// 1. YouTube Music InnerTube Search (Official YouTube client API, unlimited coverage)
function callYtmEndpoint(body, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "music.youtube.com",
        path: "/youtubei/v1/search",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Origin: "https://music.youtube.com",
          Referer: "https://music.youtube.com/",
        },
        timeout: timeoutMs,
        agent: HTTPS_AGENT,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (_) {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
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
            d.match(
              /itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i,
            ) || d.match(/approxDurationMs["\s:]+(\d+)/);
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
            d.match(
              /itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i,
            ) || d.match(/approxDurationMs["\s:]+(\d+)/);
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
      },
    );
    req.on("error", () => resolve(0));
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
  });
}

function _ytArt(u, n) {
  return u && /googleusercontent\.com|ggpht\.com/.test(u)
    ? u.replace(/=(?:w\d+-h\d+|s\d+)[^?#]*$/, `=w${n}-h${n}-l90-rj`)
    : u;
}

async function searchYouTubeMusic(query, limit = 40) {
  const baseClient = {
    client: {
      clientName: "WEB_REMIX",
      clientVersion: "1.20240101.01.00",
      hl: "en",
      gl: "US",
    },
  };

  // Run both Universal (for top hit card & unreleased/leaks) and Songs Filter (for exact track durations & albums) in parallel
  const [universalJson, songsJson] = await Promise.all([
    callYtmEndpoint({ context: baseClient, query: query.trim() }),
    callYtmEndpoint({
      context: baseClient,
      query: query.trim(),
      params: "EgWKAQIIAWoSEAQQBRADEAkQChAVEBAQDhAR",
    }),
  ]);

  const tracks = [];
  const seenVideoIds = new Set();
  const nonPlayableTypes = new Set([
    "album",
    "artist",
    "playlist",
    "single",
    "ep",
    "profile",
    "podcast",
    "episode",
  ]);

  // Detect if a string is a duration (e.g. "3:45", "1:03:22")
  function parseDurationMs(str) {
    if (!str) return 0;
    const s = str.trim();
    const m2 = s.match(/^(\d+):(\d{2})$/);
    if (m2) return (Number(m2[1]) * 60 + Number(m2[2])) * 1000;
    const m3 = s.match(/^(\d+):(\d{2}):(\d{2})$/);
    if (m3)
      return (Number(m3[1]) * 3600 + Number(m3[2]) * 60 + Number(m3[3])) * 1000;
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
      r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
        ?.map((x) => x.text)
        .join("");
    if (!title) return null;

    const subRuns =
      r.subtitle?.runs ||
      r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text
        ?.runs ||
      [];

    let artist = "Unknown Artist";
    let album = "";
    let durationMs = 0;

    // Check fixedColumns first if present
    if (r.fixedColumns?.[0]) {
      const fixedText =
        r.fixedColumns[0].musicResponsiveListItemFixedColumnRenderer?.text?.runs
          ?.map((x) => x.text)
          .join("");
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
      r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
        ?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

    if (!videoId || videoId.length < 5) return null;

    const thumbs =
      r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const raw = thumbs[thumbs.length - 1]?.url || "";
    const art = _ytArt(raw, 600);
    const thumb = _ytArt(thumbs[0]?.url || raw, 256);

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
    universalJson?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents || [];

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
        const cardMeaningful = cardParts
          .slice(1)
          .filter((p) => !isViewsString(p) && parseDurationMs(p) === 0);
        const artist = cardMeaningful[0] || "Unknown Artist";

        const thumbs =
          card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        const raw = thumbs[thumbs.length - 1]?.url || "";
        const art = _ytArt(raw, 600);
        const thumb = _ytArt(thumbs[0]?.url || raw, 256);
        const videoId =
          card.onTap?.watchEndpoint?.videoId ||
          card.buttons?.find(
            (b) => b.buttonRenderer?.navigationEndpoint?.watchEndpoint,
          )?.buttonRenderer?.navigationEndpoint?.watchEndpoint?.videoId;

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
    songsJson?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents || [];

  for (const sec of songsSections) {
    const contents =
      (sec.musicShelfRenderer || sec.itemSectionRenderer)?.contents || [];
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
    const contents =
      (sec.musicShelfRenderer || sec.itemSectionRenderer)?.contents || [];
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

    https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Referer: "https://www.jiosaavn.com/",
          },
          timeout: 8000,
          agent: HTTPS_AGENT,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              const results = (json.results || []).map((r) => {
                const rawImg = r.image || r.more_info?.image || "";
                const highImg = rawImg.replace(/\d+x\d+\.jpg$/, "500x500.jpg");
                const thumbImg = rawImg.replace(/\d+x\d+\.jpg$/, "150x150.jpg");
                const dur =
                  parseInt(r.duration || r.more_info?.duration || "0", 10) *
                  1000;
                return {
                  id: `saavn_${r.id}`,
                  source: "saavn",
                  trackName: r.title || r.song || "Unknown Track",
                  artistName:
                    r.more_info?.primary_artists ||
                    r.primary_artists ||
                    r.more_info?.singers ||
                    r.singers ||
                    "Unknown Artist",
                  albumName: r.more_info?.album || r.album || "",
                  releaseYear: r.year || r.more_info?.year || "",
                  durationMs: dur,
                  previewUrl: r.more_info?.preview_url || "",
                  artworkUrl: highImg || rawImg,
                  artworkThumbnail: thumbImg || rawImg,
                  genre: "Music",
                };
              });
              resolve(results);
            } catch (_) {
              resolve([]);
            }
          });
        },
      )
      .on("error", () => resolve([]))
      .on("timeout", function () {
        this.destroy();
        resolve([]);
      });
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
          const artworkHigh = artwork100
            ? artwork100.replace(/100x100/g, "1200x1200")
            : "";
          return {
            id: `itunes_${item.trackId}`,
            source: "itunes",
            trackName: item.trackName || "Unknown Track",
            artistName: item.artistName || "Unknown Artist",
            albumName: item.collectionName || "",
            releaseYear: item.releaseDate
              ? item.releaseDate.substring(0, 4)
              : "",
            durationMs: item.trackTimeMillis || 0,
            previewUrl: item.previewUrl || "",
            artworkUrl: artworkHigh || artwork100,
            artworkThumbnail: artwork100
              ? artwork100.replace(/100x100/g, "300x300")
              : "",
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
          const art =
            item.album?.cover_xl ||
            item.album?.cover_big ||
            item.album?.cover_medium ||
            "";
          const thumb =
            item.album?.cover_medium || item.album?.cover_small || "";
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
      const data = await fetchJson(
        "https://www.youtube.com/oembed?url=" +
          encodeURIComponent(cleanYtUrl) +
          "&format=json",
        6000,
      );
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
        const data = await fetchJson(
          "https://open.spotify.com/oembed?url=" +
            encodeURIComponent(cleanSpotifyUrl),
          6000,
        );
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
  (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function _titleCore(title) {
  return _norm(
    (title || "")
      .replace(/[\(\[]\s*(feat|ft|featuring|with|prod)\b[^\)\]]*[\)\]]/gi, "")
      .replace(/\s[-–]\s*(feat|ft|featuring)\.?\s.*$/i, ""),
  ).replace(/\s/g, "");
}

const _FLAG_RE =
  /\b(remix|live|acoustic|instrumental|karaoke|cover|slowed|sped|reverb|nightcore|8d|demo|tribute|lofi|cappella)\b/g;
function _flags(title, album) {
  const found = new Set(_norm(title + " " + album).match(_FLAG_RE) || []);
  return [...found].sort().join(",");
}

function _artistTokens(name) {
  return (name || "")
    .replace(/\s-\s*topic$/i, "")
    .split(/,|&|;|\/|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b/i)
    .map(_norm)
    .filter((x) => x && x !== "unknown artist");
}

function _dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const k = a.substr(i, 2);
    bg.set(k, (bg.get(k) || 0) + 1);
  }
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

function _info(t) {
  return {
    core: _titleCore(t.trackName),
    flags: _flags(t.trackName || "", t.albumName || ""),
    artists: _artistTokens(t.artistName),
  };
}

function _sameSong(g, info, dur) {
  if (g.info.flags !== info.flags) return false;
  if (!g.info.core || !info.core) return false;
  const ao = g.info.artists.some((x) =>
    info.artists.some(
      (y) =>
        x === y ||
        (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))),
    ),
  );
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
  const title = _norm(t.trackName),
    artist = _norm(t.artistName),
    album = _norm(t.albumName);
  const hayWords = (title + " " + artist + " " + album).split(" ");
  let s = 0;
  if (title && title === qn) s += 50;
  else if (title.length >= 3 && qn.includes(title)) s += 30;
  else if (qn && title.includes(qn)) s += 28;
  if (qWords.length) {
    let hit = 0;
    for (const w of qWords)
      if (hayWords.some((h) => h === w || (w.length >= 3 && h.startsWith(w))))
        hit++;
    s += 40 * (hit / qWords.length);
  }
  if (qn === `${artist} ${title}` || qn === `${title} ${artist}`) s += 20;
  if (artist.split(" ").some((w) => w.length > 2 && qWords.includes(w)))
    s += 10;

  if (t.source === "ytmusic" && t.albumName) s += 6;
  if (
    /\bofficial (audio|music video|video)\b/.test(title) ||
    /\stopic$/.test(artist)
  )
    s += 5;
  if (t.source === "itunes" || t.source === "deezer") s += 4;
  s += Math.min(srcCount - 1, 2) * 4;

  const tx = title + " " + album;
  for (const [word, re] of _PENALTIES) {
    if (
      re.test(tx) &&
      !(word === "karaoke" ? /\b(karaoke|tribute)\b/.test(qn) : re.test(qn))
    )
      s -= 30;
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
    if (!g) {
      groups.push({ primary: t, info, sources: new Set([t.source]) });
      continue;
    }
    g.sources.add(t.source);
    if (!g.primary.durationMs && t.durationMs)
      g.primary.durationMs = t.durationMs;
    if (!g.primary.videoId && t.videoId) g.primary.videoId = t.videoId;
  }
  const qn = _norm(query);
  const qWords = qn.split(" ").filter(Boolean);
  return groups
    .map((g, i) => ({
      t: g.primary,
      sc: _score(g.primary, qn, qWords, g.sources.size, i),
    }))
    .sort((a, b) => b.sc - a.sc)
    .map((x) => x.t);
}

// ─── Main Universal Search Aggregator ─────────────────────────────────────────
const SEARCH_CACHE = new Map();
const SEARCH_CACHE_TTL = 7 * 60 * 1000;
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchITunes(query, limit = 80, onUpdate) {
  let effectiveQuery = query.trim();
  if (
    effectiveQuery.startsWith("http://") ||
    effectiveQuery.startsWith("https://")
  ) {
    const resolvedTitle = await resolveUrlMetadata(effectiveQuery);
    if (resolvedTitle) effectiveQuery = resolvedTitle;
  }

  prewarmDownloader();
  const key = effectiveQuery.toLowerCase();
  const hit = SEARCH_CACHE.get(key);
  if (hit && Date.now() - hit.t < SEARCH_CACHE_TTL)
    return hit.results.slice(0, limit);

  const buckets = { ytm: [], itunes: [], deezer: [], saavn: [] };
  const scraped = new Map();
  let done = false;

  const build = () => {
    const others = [];
    const maxLen = Math.max(
      buckets.itunes.length,
      buckets.deezer.length,
      buckets.saavn.length,
    );
    for (let i = 0; i < maxLen; i++) {
      if (buckets.itunes[i]) others.push(buckets.itunes[i]);
      if (buckets.deezer[i]) others.push(buckets.deezer[i]);
      if (buckets.saavn[i]) others.push(buckets.saavn[i]);
    }
    const ordered = [...buckets.ytm, ...others];
    for (const t of ordered) {
      if (t.videoId && !t.durationMs && scraped.has(t.videoId))
        t.durationMs = scraped.get(t.videoId);
    }
    return rankAndMerge(ordered, effectiveQuery).slice(0, limit);
  };

  const emit = () => {
    const r = build();
    if (done) {
      SEARCH_CACHE.set(key, { t: Date.now(), results: r });
      if (SEARCH_CACHE.size > 60)
        SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value);
    }
    if (onUpdate) {
      try {
        onUpdate(r);
      } catch (_) {}
    }
    return r;
  };

  const run = (fn, name) =>
    fn()
      .catch(() => [])
      .then((res) => {
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

  // Wait up to 6s for all providers including YTM to ensure videoId is populated
  await Promise.race([all, _sleep(6000)]);

  done = true;
  const final = emit();
  final
    .filter((t) => t.videoId)
    .slice(0, 8)
    .forEach((t, i) => setTimeout(() => prefetchStream(t.videoId), i * 150));

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
              if (!timer)
                timer = setTimeout(() => {
                  timer = null;
                  emit();
                }, 400);
            }
          } catch (_) {}
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (scraped.size) emit();
    })();
  }

  return final;
}

// ─── Download & Store Orchestration ───────────────────────────────────────────
function _managedDir() {
  try {
    const { app } = require("electron");
    if (app) return path.join(app.getPath("userData"), "bin");
  } catch (_) {}
  return path.join(__dirname, "../bin");
}

function getYtDlpPath() {
  const managed = path.join(_managedDir(), "yt-dlp.exe");
  if (fs.existsSync(managed)) return managed;

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

// ─── Resilience Layer ─────────────────────────────────────────────────────────
class DownloadError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "DownloadError";
    this.code = code;
    this.detail = detail || "";
  }
}

const _ERR_RULES = [
  [
    "DEPENDENCY",
    /Failed to launch downloader|Failed to install|failed self-check|checksum mismatch|not a valid executable|not a valid Win32|EFTYPE|ffmpeg|ffprobe|Postprocessing/i,
    "Audio components couldn't be set up automatically. Check your internet connection and antivirus, then try again.",
  ],
  [
    "DISK_FULL",
    /ENOSPC|no space left|disk full/i,
    "Not enough free disk space to save this track. Free some space and try again.",
  ],
  [
    "PERMISSION",
    /EACCES|EPERM|EBUSY|permission denied|access is denied/i,
    "NovaTune can't write to the download folder (locked or blocked by antivirus). Try again.",
  ],
  [
    "RATE_LIMIT",
    /HTTP Error 429|Too Many Requests|rate.?limit/i,
    "The source is rate-limiting requests. Wait a minute and try again.",
  ],
  [
    "UNAVAILABLE",
    /Video unavailable|Private video|members-only|not available in your country|blocked it|copyright|age.restricted|confirm your age|removed by the uploader|account associated.*terminated/i,
    "This track isn't available for download from its source.",
  ],
  [
    "BLOCKED",
    /Sign in to confirm|not a bot|HTTP Error 40[13]/i,
    "The source is blocking requests right now. Components were refreshed — try again shortly.",
  ],
  [
    "NETWORK",
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|timed out|timeout|stalled|getaddrinfo|socket hang up|Unable to download|Connection|HTTP Error 5\d\d/i,
    "Network problem while downloading. Check your connection and try again.",
  ],
];

function classifyError(err) {
  if (err instanceof DownloadError) return err;
  if (err && err.cancelled) return err;
  const msg = String((err && err.message) || err || "");
  const rule = _ERR_RULES.find(([, re]) => re.test(msg));
  return new DownloadError(
    rule ? rule[0] : "UNKNOWN",
    rule ? rule[2] : "Download failed. Please try again in a moment.",
    msg,
  );
}

function _isOnline() {
  return Promise.race([
    require("dns")
      .promises.lookup("www.youtube.com")
      .then(() => true)
      .catch(() => false),
    _sleep(3000).then(() => false),
  ]);
}

async function _finalizeError(err) {
  if (err && err.cancelled) return err;
  let e = classifyError(err);
  if (e.code === "UNKNOWN" || e.code === "DEPENDENCY") {
    if (!(await _isOnline()))
      e = new DownloadError(
        "NETWORK",
        "No internet connection. Check your network and try again.",
        e.detail,
      );
  }
  console.warn(`[DownloadEngine] ${e.code}: ${e.detail || e.message}`);
  return e;
}

async function _retry(fn, { tries = 3, baseMs = 800, ctx, shouldRetry } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (ctx && ctx.cancelled)
      throw Object.assign(new Error("Download cancelled"), { cancelled: true });
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (e.cancelled || (shouldRetry && !shouldRetry(e))) throw e;
      if (i < tries - 1) await _sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

function _killTree(proc) {
  try {
    if (process.platform === "win32" && proc.pid)
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else proc.kill("SIGKILL");
  } catch (_) {
    try {
      proc.kill("SIGKILL");
    } catch (__) {}
  }
}

function _assertDisk(dir) {
  try {
    const s = fs.statfsSync(dir);
    if (s.bavail * s.bsize < 100 * 1024 * 1024) {
      const e = new Error("ENOSPC: no space left on device");
      e.code = "ENOSPC";
      throw e;
    }
  } catch (e) {
    if (e.code === "ENOSPC") throw e;
  }
}

function _ensureWritableDir(dir) {
  const cands = [dir];
  try {
    const { app } = require("electron");
    if (app) cands.push(path.join(app.getPath("userData"), "Downloads"));
  } catch (_) {}
  cands.push(path.join(require("os").tmpdir(), "NovaTune Downloads"));
  let lastErr;
  for (const d of cands) {
    try {
      fs.mkdirSync(d, { recursive: true });
      const probe = path.join(d, `.nt_probe_${process.pid}`);
      fs.writeFileSync(probe, "x");
      fs.unlinkSync(probe);
      _assertDisk(d);
      return d;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("EACCES: no writable download folder");
}

// Generic hardened downloader: redirects, idle-timeout, truncation check, atomic rename
function _fetchToFile(
  url,
  dest,
  { gunzip = false, onProgress, idleMs = 30000, hops = 0 } = {},
) {
  return new Promise((resolve, reject) => {
    if (hops > 7) return reject(new Error("Too many redirects"));
    const tmp = `${dest}.${process.pid}.tmp`;
    const cleanup = () => {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {}
    };
    const req = https.get(
      url,
      { headers: { "User-Agent": "NovaTune Downloader" } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          return resolve(
            _fetchToFile(new URL(res.headers.location, url).href, dest, {
              gunzip,
              onProgress,
              idleMs,
              hops: hops + 1,
            }),
          );
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
        } catch (e) {
          res.resume();
          return reject(e);
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let got = 0;
        res.on("data", (c) => {
          got += c.length;
          if (total && onProgress)
            onProgress(Math.min(100, Math.round((got / total) * 100)));
        });
        const chain = [
          res,
          ...(gunzip ? [zlib.createGunzip()] : []),
          fs.createWriteStream(tmp),
        ];
        require("stream").pipeline(...chain, (err) => {
          if (!err && !gunzip && total && got < total)
            err = new Error("truncated download");
          if (err) {
            cleanup();
            return reject(err);
          }
          try {
            try {
              fs.unlinkSync(dest);
            } catch (_) {}
            fs.renameSync(tmp, dest);
            resolve(dest);
          } catch (e) {
            cleanup();
            reject(e);
          }
        });
      },
    );
    req.on("error", (e) => {
      cleanup();
      reject(e);
    });
    req.setTimeout(idleMs, () => req.destroy(new Error("timeout")));
  });
}

function _isValidExe(file, minSize = 1000000) {
  try {
    if (fs.statSync(file).size < minSize) return false;
    const fd = fs.openSync(file, "r");
    const b = Buffer.alloc(2);
    fs.readSync(fd, b, 0, 2, 0);
    fs.closeSync(fd);
    return b[0] === 0x4d && b[1] === 0x5a;
  } catch (_) {
    return false;
  }
}

// Returns output string on success, "timeout" if merely slow (AV first-scan), null on failure
function _runOk(bin, args, timeout = 30000) {
  return new Promise((res) => {
    try {
      require("child_process").execFile(
        bin,
        args,
        { windowsHide: true, timeout },
        (err, out) => {
          if (err) return res(err.killed ? "timeout" : null);
          res(String(out || "").trim() || "ok");
        },
      );
    } catch (_) {
      res(null);
    }
  });
}

function _sha256(file) {
  return new Promise((resolve, reject) => {
    const h = require("crypto").createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

function _wingetLink(exe) {
  const p = path.join(
    process.env.LOCALAPPDATA || "",
    "Microsoft",
    "WinGet",
    "Links",
    exe,
  );
  return process.platform === "win32" && fs.existsSync(p) ? p : null;
}

// Last-resort: let Windows Package Manager install the dependency
function _wingetInstall(id, exe) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null);
    const existing = _wingetLink(exe);
    if (existing) return resolve(existing);
    let p;
    try {
      p = spawn(
        "winget",
        [
          "install",
          "--id",
          id,
          "-e",
          "--silent",
          "--accept-source-agreements",
          "--accept-package-agreements",
        ],
        { windowsHide: true, stdio: "ignore" },
      );
    } catch (_) {
      return resolve(null);
    }
    const t = setTimeout(() => {
      try {
        p.kill();
      } catch (_) {}
    }, 300000);
    const done = () => {
      clearTimeout(t);
      resolve(_wingetLink(exe));
    };
    p.on("close", done);
    p.on("error", done);
  });
}

// ─── yt-dlp: locate, verify, self-heal, install ──────────────────────────────
const _YTDLP_URLS = [
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  "https://ghproxy.net/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  "https://gh-proxy.com/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
];

async function _officialYtDlpSha() {
  const tmp = path.join(require("os").tmpdir(), `nt_sums_${process.pid}.txt`);
  try {
    await _fetchToFile(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS",
      tmp,
      { idleMs: 8000 },
    );
    const m = fs
      .readFileSync(tmp, "utf8")
      .match(/^([a-f0-9]{64})\s+\*?yt-dlp\.exe\s*$/im);
    return m ? m[1].toLowerCase() : null;
  } catch (_) {
    return null;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
  }
}

let _ytInstallP = null;
let _ytFailAt = 0;
let _ytFailErr = null;
let _ytOk = null;
let _ytForce = false;

function installYtDlp(onProgress) {
  if (_ytInstallP) return _ytInstallP;
  if (_ytFailErr && Date.now() - _ytFailAt < 60000)
    return Promise.reject(_ytFailErr);
  _ytInstallP = (async () => {
    const target = path.join(_managedDir(), "yt-dlp.exe");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const sha = await _officialYtDlpSha();
    let lastErr = null;
    for (const url of _YTDLP_URLS) {
      try {
        await _retry(
          () =>
            _fetchToFile(url, target, {
              onProgress: (p) =>
                onProgress &&
                onProgress({
                  status: "installing",
                  percent: Math.round(p * 0.9),
                  message: `Setting up downloader components… ${p}%`,
                }),
            }),
          { tries: 2 },
        );
        if (!_isValidExe(target))
          throw new Error("downloaded yt-dlp is not a valid executable");
        if (sha && (await _sha256(target)) !== sha)
          throw new Error("yt-dlp checksum mismatch");
        if (!(await _runOk(target, ["--version"], 45000)))
          throw new Error("yt-dlp failed self-check (blocked by antivirus?)");
        return target;
      } catch (e) {
        lastErr = e;
        console.warn(
          `[DownloadEngine] yt-dlp source failed (${url}):`,
          e.message,
        );
        try {
          fs.unlinkSync(target);
        } catch (_) {}
      }
    }
    const w = await _wingetInstall("yt-dlp.yt-dlp", "yt-dlp.exe");
    if (w && (await _runOk(w, ["--version"], 45000))) return w;
    throw new Error(
      `Failed to install yt-dlp: ${lastErr ? lastErr.message : "no source reachable"}`,
    );
  })()
    .catch((e) => {
      _ytFailAt = Date.now();
      _ytFailErr = e;
      throw e;
    })
    .finally(() => {
      _ytInstallP = null;
    });
  return _ytInstallP;
}

/**
 * Returns a verified, runnable yt-dlp path. Seeds a writable managed copy,
 * purges corrupt/quarantined binaries, falls back to PATH, then downloads
 * (checksum-verified, multi-mirror) and finally winget.
 */
async function ensureYtDlpAvailable(onProgress) {
  if (_ytForce) {
    _ytForce = false;
    _ytOk = null;
    return (_ytOk = await installYtDlp(onProgress));
  }
  if (_ytOk && (_ytOk === "yt-dlp" || fs.existsSync(_ytOk))) return _ytOk;
  _ytOk = null;

  const managed = path.join(_managedDir(), "yt-dlp.exe");
  try {
    if (!fs.existsSync(managed)) {
      const src = getYtDlpPath();
      if (src !== "yt-dlp" && fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(managed), { recursive: true });
        fs.copyFileSync(src, managed);
      }
    }
  } catch (_) {}

  const cand = getYtDlpPath();
  if (cand !== "yt-dlp" && fs.existsSync(cand)) {
    if (_isValidExe(cand) && (await _runOk(cand, ["--version"], 45000)))
      return (_ytOk = cand);
    try {
      fs.unlinkSync(managed);
    } catch (_) {}
  }
  if (await _runOk("yt-dlp", ["--version"], 10000)) return (_ytOk = "yt-dlp");
  const wl = _wingetLink("yt-dlp.exe");
  if (wl && (await _runOk(wl, ["--version"], 45000))) return (_ytOk = wl);

  if (onProgress)
    onProgress({
      status: "installing",
      percent: 0,
      message: "Setting up downloader components (one-time)…",
    });
  return (_ytOk = await installYtDlp(onProgress));
}

async function ensureDependencies(onProgress) {
  const [ytdlp, ffmpeg] = await Promise.all([
    ensureYtDlpAvailable(onProgress).catch(() => null),
    ensureFfmpeg(onProgress).catch(() => null),
  ]);
  let deno = null;
  try {
    deno = (await _ver("deno")) ? "system" : await ensureDeno();
  } catch (_) {}
  return { ok: !!ytdlp, ytdlp, ffmpeg, deno };
}

function _ver(bin) {
  return new Promise((res) => {
    try {
      require("child_process").execFile(
        bin,
        ["--version"],
        { windowsHide: true, timeout: 4000 },
        (err, out) => res(err ? null : String(out).trim()),
      );
    } catch (_) {
      res(null);
    }
  });
}

function _downloadFile(url, dest, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error("Too many redirects"));
    https
      .get(
        url,
        { headers: { "User-Agent": "NovaTune Downloader" }, timeout: 30000 },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            return resolve(
              _downloadFile(
                new URL(res.headers.location, url).href,
                dest,
                hops + 1,
              ),
            );
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const tmp = `${dest}.tmp`;
          const ws = fs.createWriteStream(tmp);
          res.pipe(ws);
          ws.on("finish", () =>
            ws.close(() => {
              try {
                if (fs.existsSync(dest)) fs.unlinkSync(dest);
                fs.renameSync(tmp, dest);
                resolve(dest);
              } catch (e) {
                reject(e);
              }
            }),
          );
          ws.on("error", reject);
        },
      )
      .on("error", reject)
      .on("timeout", function () {
        this.destroy(new Error("timeout"));
      });
  });
}

// One-time silent install of Deno (yt-dlp's recommended JS runtime) into userData/bin
async function ensureDeno() {
  if (process.platform !== "win32") return null;
  const dir = _managedDir();
  const exe = path.join(dir, "deno.exe");
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(dir, { recursive: true });
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const zip = path.join(dir, "deno.zip");
  await _downloadFile(
    `https://github.com/denoland/deno/releases/latest/download/deno-${arch}-pc-windows-msvc.zip`,
    zip,
  );
  await new Promise((resolve) => {
    const p = spawn("tar", ["-xf", zip, "-C", dir], {
      windowsHide: true,
      stdio: "ignore",
    });
    p.on("close", resolve);
    p.on("error", resolve);
  });
  try {
    fs.unlinkSync(zip);
  } catch (_) {}
  return fs.existsSync(exe) ? exe : null;
}

function getFfmpegPath() {
  const managed = path.join(_managedDir(), "ffmpeg.exe");
  if (fs.existsSync(managed)) return managed;

  if (process.resourcesPath) {
    const resourcesBin = path.join(process.resourcesPath, "bin", "ffmpeg.exe");
    if (fs.existsSync(resourcesBin)) return resourcesBin;
  }

  const devBin = path.join(__dirname, "../bin/ffmpeg.exe");
  if (fs.existsSync(devBin)) return devBin;

  try {
    const { app } = require("electron");
    if (app) {
      const userBin = path.join(app.getPath("userData"), "bin", "ffmpeg.exe");
      if (fs.existsSync(userBin)) return userBin;
    }
  } catch (_) {}

  return "ffmpeg";
}

const _FFMPEG_SOURCES = [
  {
    url: "https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-win32-x64.gz",
    gz: true,
  },
  {
    url: "https://ghproxy.net/https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-win32-x64.gz",
    gz: true,
  },
  {
    url: "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
    zip: true,
  },
];

async function _unzipPick(zip, wanted, destDir) {
  const tmp = path.join(destDir, "_unzip");
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    await new Promise((r) => {
      const p = spawn("tar", ["-xf", zip, "-C", tmp], {
        windowsHide: true,
        stdio: "ignore",
      });
      p.on("close", r);
      p.on("error", r);
    });
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (wanted.includes(e.name.toLowerCase()))
          fs.copyFileSync(f, path.join(destDir, e.name.toLowerCase()));
      }
    };
    walk(tmp);
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.unlinkSync(zip);
    } catch (_) {}
  }
}

let _ffmpegP = null;
let _ffOk = null;
let _ffFailAt = 0;
async function ensureFfmpeg(onProgress) {
  if (_ffOk && (_ffOk === "ffmpeg" || fs.existsSync(_ffOk))) return _ffOk;
  _ffOk = null;

  const managed = path.join(_managedDir(), "ffmpeg.exe");
  const cur = getFfmpegPath();
  if (cur !== "ffmpeg" && fs.existsSync(cur)) {
    if (_isValidExe(cur, 5000000) && (await _runOk(cur, ["-version"], 45000)))
      return (_ffOk = cur);
    try {
      fs.unlinkSync(managed);
    } catch (_) {}
  }
  if (await _runOk("ffmpeg", ["-version"], 10000)) return (_ffOk = "ffmpeg");
  const wl = _wingetLink("ffmpeg.exe");
  if (wl && (await _runOk(wl, ["-version"], 45000))) return (_ffOk = wl);

  if (_ffmpegP) return _ffmpegP;
  if (_ffFailAt && Date.now() - _ffFailAt < 300000) return null;

  _ffmpegP = (async () => {
    const dir = _managedDir();
    fs.mkdirSync(dir, { recursive: true });
    if (onProgress)
      onProgress({
        status: "installing",
        percent: 5,
        message: "Setting up audio conversion engine (one-time)…",
      });
    for (const src of _FFMPEG_SOURCES) {
      try {
        if (src.zip) {
          const z = path.join(dir, "ffmpeg.zip");
          await _retry(() => _fetchToFile(src.url, z, { idleMs: 45000 }), {
            tries: 2,
          });
          await _unzipPick(z, ["ffmpeg.exe", "ffprobe.exe"], dir);
        } else {
          await _retry(
            () =>
              _fetchToFile(src.url, managed, { gunzip: true, idleMs: 45000 }),
            { tries: 2 },
          );
        }
        if (
          _isValidExe(managed, 5000000) &&
          (await _runOk(managed, ["-version"], 45000))
        )
          return (_ffOk = managed);
      } catch (e) {
        console.warn(
          `[DownloadEngine] ffmpeg source failed (${src.url}):`,
          e.message,
        );
      }
      try {
        fs.unlinkSync(managed);
      } catch (_) {}
    }
    const w = await _wingetInstall("Gyan.FFmpeg", "ffmpeg.exe");
    if (w && (await _runOk(w, ["-version"], 45000))) return (_ffOk = w);
    _ffFailAt = Date.now();
    return null;
  })()
    .catch(() => {
      _ffFailAt = Date.now();
      return null;
    })
    .finally(() => {
      _ffmpegP = null;
    });
  return _ffmpegP;
}

let _jsRtP = null;
function _jsRuntimeArgs() {
  if (_jsRtP) return _jsRtP;
  _jsRtP = (async () => {
    const managed = path.join(_managedDir(), "deno.exe");
    if (fs.existsSync(managed)) return ["--js-runtimes", `deno:${managed}`];
    if (await _ver("deno")) return [];
    const nv = await _ver("node");
    return nv && parseInt(nv.replace(/^v/, ""), 10) >= 20
      ? ["--js-runtimes", "node"]
      : [];
  })();
  return _jsRtP;
}

// Self-update yt-dlp (managed copy only), at most once per 24h unless forced
let _updP = null;
function updateYtDlp(force = false) {
  if (_updP) return _updP;
  _updP = (async () => {
    try {
      const bin = await ensureYtDlpAvailable();
      if (bin === "yt-dlp" || path.dirname(bin) !== _managedDir()) return;
      const stamp = path.join(_managedDir(), "ytdlp-update.stamp");
      let last = 0;
      try {
        last = Number(fs.readFileSync(stamp, "utf8")) || 0;
      } catch (_) {}
      if (!force && Date.now() - last < 24 * 3600 * 1000) return;
      await new Promise((resolve) => {
        const p = spawn(bin, ["-U"], { windowsHide: true, stdio: "ignore" });
        const t = setTimeout(() => {
          try {
            p.kill();
          } catch (_) {}
          resolve();
        }, 90000);
        p.on("close", () => (clearTimeout(t), resolve()));
        p.on("error", () => (clearTimeout(t), resolve()));
      });
      try {
        fs.writeFileSync(stamp, String(Date.now()));
      } catch (_) {}
    } catch (_) {
    } finally {
      _updP = null;
    }
  })();
  return _updP;
}

let _warmed = false;
let _denoP = null;
function prewarmDownloader() {
  if (_warmed) return;
  _warmed = true;
  const p = (async () => {
    if (await _ver("deno")) return;
    const exe = await ensureDeno().catch(() => null);
    if (exe) _jsRtP = null;
  })();
  _denoP = p;
  p.finally(() => {
    if (_denoP === p) _denoP = null;
  });
  ensureFfmpeg().catch(() => {});
  updateYtDlp()
    .then(() => ensureYtDlpAvailable())
    .then((bin) => {
      const w = spawn(bin, ["--version"], {
        windowsHide: true,
        stdio: "ignore",
      });
      w.on("error", () => {});
    })
    .catch(() => {
      _warmed = false;
    });
}

async function _downloadWithYtDlpOnce(
  urlOrQuery,
  destBase,
  onProgress,
  trackId,
  ctx,
  fmt = "m4a",
  allowNoConversion = false,
) {
  const ytDlpBinary = await ensureYtDlpAvailable(onProgress);
  let ffmpegBinary = await ensureFfmpeg(onProgress).catch(() => null);
  // _updP (yt-dlp self-update) intentionally not awaited — don't block user downloads
  if (_denoP) {
    if (onProgress)
      onProgress({
        status: "installing",
        percent: 3,
        message: "Setting up downloader components (one-time)…",
      });
    await Promise.race([_denoP, _sleep(6000)]);
  }
  const rtArgs = await _jsRuntimeArgs();
  const ffmpegArgs =
    ffmpegBinary && ffmpegBinary !== "ffmpeg"
      ? ["--ffmpeg-location", ffmpegBinary]
      : [];

  return new Promise((resolve, reject) => {
    const audioFormatArgs = allowNoConversion
      ? ["-f", "140/bestaudio[ext=m4a]/bestaudio/best"]
      : fmt === "m4a"
        ? [
            "-f",
            "140/bestaudio[ext=m4a]/bestaudio",
            "-x",
            "--audio-format",
            "m4a",
            "--audio-quality",
            "0",
          ]
        : [
            "-f",
            "bestaudio",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "320K",
            "--postprocessor-args",
            "ExtractAudio:-threads 0 -compression_level 7",
          ];

    const args = [
      urlOrQuery,
      ...rtArgs,
      ...ffmpegArgs,
      "--extractor-args",
      "youtube:player_skip=configs",
      ...audioFormatArgs,
      "--no-warnings",
      "--socket-timeout",
      "20",
      "--retries",
      "5",
      "--fragment-retries",
      "5",
      "-o",
      `${destBase}.%(ext)s`,
      "--no-playlist",
      "--newline",
    ];

    let finalFile = null;
    let proc = null;
    let errorOutput = "";

    if (ctx && ctx.cancelled) {
      const e = new Error("Download cancelled");
      e.cancelled = true;
      return reject(e);
    }

    try {
      proc = spawn(ytDlpBinary, args, { windowsHide: true });
      var _tSpawn = Date.now();
      var _loggedFirst = false;
      if (ctx) {
        ctx.proc = proc;
        ctx.destBase = destBase;
      }
    } catch (err) {
      err.depFailure = "ytdlp";
      return reject(err);
    }
    let _lastAct = Date.now();
    let _stalled = false;
    const _wd = setInterval(() => {
      if (Date.now() - _lastAct > 90000) {
        _stalled = true;
        _killTree(proc);
      }
    }, 10000);

    proc.stdout.on("data", (data) => {
      _lastAct = Date.now();
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const text = line.trim();
        if (text.includes("[youtube] Extracting URL")) {
          onProgress &&
            onProgress({
              status: "resolving",
              percent: 10,
              message: "Connecting to YouTube Music…",
            });
        } else if (text.includes("Downloading player")) {
          onProgress &&
            onProgress({
              status: "resolving",
              percent: 25,
              message: "Resolving audio cipher…",
            });
        } else if (text.includes("Solving JS challenges")) {
          onProgress &&
            onProgress({
              status: "resolving",
              percent: 42,
              message: "Unlocking audio stream…",
            });
        } else if (
          text.includes("Downloading 1 format") ||
          (text.includes("[download] Destination:") && !_loggedFirst)
        ) {
          onProgress &&
            onProgress({
              status: "downloading",
              percent: 55,
              message: "Stream ready, downloading audio…",
            });
        }

        const pMatch = text.match(/\[download\]\s+([0-9.]+)%/);
        if (pMatch && !_loggedFirst) {
          _loggedFirst = true;
          console.log(
            `[DownloadEngine] yt-dlp first byte after ${Date.now() - _tSpawn}ms`,
          );
        }
        if (pMatch && onProgress) {
          const rawPct = parseFloat(pMatch[1]);
          const scaledPct = Math.min(95, 55 + Math.round((rawPct * 40) / 100));
          onProgress({
            status: "downloading",
            percent: scaledPct,
            message: `Downloading audio… ${Math.round(rawPct)}%`,
          });
        }

        if (text.includes("[FixupM4a]") || text.includes("[ExtractAudio]")) {
          onProgress &&
            onProgress({
              status: "processing",
              percent: 96,
              message: "Finalizing audio container…",
            });
        }
        if (
          text.includes("[ExtractAudio] Destination:") ||
          text.includes("[download] Destination:")
        ) {
          const m = text.match(/Destination:\s*(.*)$/);
          if (m && m[1]) finalFile = m[1].trim();
        }
      }
    });

    proc.stderr.on("data", (data) => {
      _lastAct = Date.now();
      errorOutput += data.toString();
    });

    proc.on("close", (code) => {
      clearInterval(_wd);
      if (_stalled && !(ctx && ctx.cancelled))
        return reject(new Error("Download stalled: timed out"));
      if (ctx && ctx.cancelled) {
        setTimeout(() => _cleanupPartials(destBase), 600);
        const e = new Error("Download cancelled");
        e.cancelled = true;
        return reject(e);
      }
      if (code === 0) {
        const expectedMp3 = `${destBase}.${fmt}`;
        if (fs.existsSync(expectedMp3)) return resolve(expectedMp3);
        if (finalFile && fs.existsSync(finalFile)) return resolve(finalFile);
        const dir = path.dirname(destBase);
        const baseName = path.basename(destBase);
        try {
          const files = fs.readdirSync(dir);
          const matched = files.find(
            (f) =>
              f.startsWith(baseName) &&
              (f.endsWith(".mp3") ||
                f.endsWith(".m4a") ||
                f.endsWith(".opus") ||
                f.endsWith(".webm") ||
                f.endsWith(".aac")),
          );
          if (matched) return resolve(path.join(dir, matched));
        } catch (_) {}
        resolve(expectedMp3);
      } else {
        const cleanErr =
          errorOutput.trim() || `Process exited with code ${code}`;
        reject(new Error(`Download failed: ${cleanErr}`));
      }
    });

    proc.on("error", (err) => {
      clearInterval(_wd);
      const e = new Error(`Failed to launch downloader: ${err.message}`);
      e.depFailure = "ytdlp";
      reject(e);
    });
  });
}

async function downloadWithYtDlp(
  urlOrQuery,
  destBase,
  onProgress,
  trackId,
  ctx,
  fmt = "m4a",
) {
  const used = new Set();
  let noConv = false;
  let net = 0;
  let lastErr = null;
  const say = (message, percent = 10, status = "installing") =>
    onProgress && onProgress({ status, percent, message });

  for (let i = 0; i < 8; i++) {
    try {
      return await _downloadWithYtDlpOnce(
        urlOrQuery,
        destBase,
        onProgress,
        trackId,
        ctx,
        fmt,
        noConv,
      );
    } catch (err) {
      lastErr = err;
      if (err.cancelled || (ctx && ctx.cancelled)) throw err;
      const msg = String(err.message || "");

      // yt-dlp itself broken / blocked / corrupt → force a clean reinstall
      if (
        (err.depFailure === "ytdlp" || /Failed to install yt-dlp/.test(msg)) &&
        !used.has("ytdlp")
      ) {
        used.add("ytdlp");
        say("Repairing downloader components…");
        _ytForce = true;
        continue;
      }

      // ffmpeg missing/broken → heal, else fall back to raw stream capture
      if (
        !noConv &&
        /ffmpeg|ffprobe|Postprocessing|Conversion failed/i.test(msg)
      ) {
        if (!used.has("ffmpeg")) {
          used.add("ffmpeg");
          say("Configuring audio converter…", 15);
          _ffOk = null;
          _ffFailAt = 0;
          const f = await ensureFfmpeg(onProgress).catch(() => null);
          if (f) continue;
        }
        noConv = true;
        continue;
      }

      // Extractor drift (nsig/sign-in/etc.) → update yt-dlp + JS runtime
      if (
        !used.has("update") &&
        /HTTP Error 40[13]|Sign in|nsig|Unable to extract|Requested format is not available|player response|signature|cipher|challenge/i.test(
          msg,
        )
      ) {
        used.add("update");
        say("Updating downloader components…", 5);
        await updateYtDlp(true);
        await ensureDeno().catch(() => null);
        _jsRtP = null;
        continue;
      }

      // Transient network trouble → short backoff retry
      if (
        net < 2 &&
        /timed out|timeout|stalled|ECONNRESET|ETIMEDOUT|Unable to download|HTTP Error 5\d\d|Temporary failure|Connection/i.test(
          msg,
        )
      ) {
        net++;
        say("Connection hiccup, retrying…", 8, "resolving");
        await _sleep(1500 * net);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

// ─── Keyless alternate source (Piped) when yt-dlp is unusable ─────────────────
const _PIPED_FALLBACK = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
];

async function _pipedInstances() {
  try {
    const list = await fetchJson("https://piped-instances.kavin.rocks/", 4000);
    const urls = (Array.isArray(list) ? list : [])
      .map((i) => i && i.api_url)
      .filter((u) => /^https:\/\//.test(u || ""));
    return [...new Set([...urls.slice(0, 6), ..._PIPED_FALLBACK])];
  } catch (_) {
    return _PIPED_FALLBACK;
  }
}

async function _pipedResolve(videoId) {
  for (const base of await _pipedInstances()) {
    const j = await fetchJson(`${base}/streams/${videoId}`, 6000).catch(
      () => null,
    );
    const a = (j?.audioStreams || [])
      .filter(
        (s) =>
          s.url &&
          /audio\/mp4/.test(s.mimeType || "") &&
          Number(s.contentLength) > 0,
      )
      .sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0))[0];
    if (a)
      return {
        url: a.url,
        size: Number(a.contentLength),
        durSec: Number(j.duration) || 0,
        ua: UA_DESKTOP,
      };
  }
  return null;
}

async function _pipedFallback(videoId, destBase, fmt, onProgress, ctx) {
  onProgress({
    status: "resolving",
    percent: 12,
    message: "Trying alternate source…",
  });
  const r = await _pipedResolve(videoId);
  if (!r) throw new Error("alternate source unavailable");
  const out = `${destBase}.m4a`;
  try {
    await _rangeGet(r.url, 0, Math.min(32767, r.size - 1), 0, 4000, r.ua);
    await _fastDownload(r.url, r.size, out, onProgress, ctx, r.ua);
    if (!_validateAudio(out, r.durSec)) throw new Error("invalid audio");
  } catch (e) {
    try {
      fs.unlinkSync(out);
    } catch (_) {}
    throw e;
  }
  if (fmt === "mp3") {
    const ff = await ensureFfmpeg().catch(() => null);
    if (ff) {
      const mp3 = `${destBase}.mp3`;
      const ok = await _runOk(
        ff,
        ["-y", "-i", out, "-vn", "-b:a", "320k", mp3],
        180000,
      );
      if (ok && fs.existsSync(mp3)) {
        try {
          fs.unlinkSync(out);
        } catch (_) {}
        return mp3;
      }
      try {
        fs.unlinkSync(mp3);
      } catch (_) {}
    }
  }
  return out;
}

// ─── Fast path: direct InnerTube stream + parallel ranged download (no yt-dlp) ─
const _FAST_CLIENT = {
  clientName: "ANDROID_VR",
  clientVersion: "1.60.19",
  deviceMake: "Oculus",
  deviceModel: "Quest 3",
  osName: "Android",
  osVersion: "12L",
  androidSdkVersion: 32,
  hl: "en",
  gl: "US",
};
const _FAST_UA =
  "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
const _FAST_IOS = {
  clientName: "IOS",
  clientVersion: "20.10.4",
  deviceMake: "Apple",
  deviceModel: "iPhone16,2",
  osName: "iPhone",
  osVersion: "18.3.2.22D82",
  hl: "en",
  gl: "US",
};
const _FAST_IOS_UA =
  "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
const _FAST_CLIENTS = [
  { ctx: _FAST_CLIENT, ua: _FAST_UA, id: "28" },
  { ctx: _FAST_IOS, ua: _FAST_IOS_UA, id: "5" },
];
const _STREAM_CACHE = new Map(); // videoId -> { t, p }
let _fastFails = 0;

function _postJson(url, body, headers, timeoutMs) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
        timeout: timeoutMs,
        agent: HTTPS_AGENT,
      },
      (res) => {
        let d = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch (_) {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.write(data);
    req.end();
  });
}

async function _resolveWithClient(c, videoId) {
  const j = await _postJson(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      context: { client: c.ctx },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    },
    {
      "User-Agent": c.ua,
      "X-YouTube-Client-Name": c.id,
      "X-YouTube-Client-Version": c.ctx.clientVersion,
      Origin: "https://www.youtube.com",
    },
    4000,
  );
  const fmts = j?.streamingData?.adaptiveFormats || [];
  const a = fmts
    .filter(
      (f) =>
        f.url &&
        /^audio\/mp4/.test(f.mimeType || "") &&
        Number(f.contentLength) > 0,
    )
    .sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0))[0];
  if (!a) return null;
  return {
    url: a.url,
    size: Number(a.contentLength),
    bitrate: a.bitrate || 0,
    durSec: Number(j.videoDetails?.lengthSeconds) || 0,
    ua: c.ua,
  };
}

// Race all clients; first HQ result wins. Cached ~90min so prefetched clicks are instant.
function _fastResolveAudio(videoId) {
  const hit = _STREAM_CACHE.get(videoId);
  if (hit && Date.now() - hit.t < 90 * 60 * 1000) return hit.p;
  const p = new Promise((resolve) => {
    let left = _FAST_CLIENTS.length;
    for (const c of _FAST_CLIENTS) {
      _resolveWithClient(c, videoId)
        .catch(() => null)
        .then((r) => {
          if (r && r.bitrate >= 100000) resolve(r);
          if (--left === 0) resolve(null);
        });
    }
  });
  _STREAM_CACHE.set(videoId, { t: Date.now(), p });
  if (_STREAM_CACHE.size > 60)
    _STREAM_CACHE.delete(_STREAM_CACHE.keys().next().value);
  p.then((r) => {
    if (!r && _STREAM_CACHE.get(videoId)?.p === p)
      _STREAM_CACHE.delete(videoId);
  });
  return p;
}

function prefetchStream(videoId) {
  if (!videoId || videoId.length < 5) return;
  _fastResolveAudio(videoId).catch(() => {});
}

function _rangeGet(
  url,
  start,
  end,
  attempt = 0,
  timeoutMs = 10000,
  ua = _FAST_UA,
) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": ua,
          Range: `bytes=${start}-${end}`,
        },
        timeout: timeoutMs,
        agent: HTTPS_AGENT,
      },
      (res) => {
        if (res.statusCode !== 206 && res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const b = Buffer.concat(chunks);
          b.length === end - start + 1
            ? resolve(b)
            : reject(new Error("short chunk"));
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  }).catch((e) => {
    if (attempt < 2)
      return _rangeGet(url, start, end, attempt + 1, timeoutMs, ua);
    throw e;
  });
}

async function _fastDownload(url, size, dest, onProgress, ctx, ua) {
  const fd = fs.openSync(dest, "w");
  try {
    const CH = 2 * 1024 * 1024;
    let next = 0;
    let got = 0;
    let err = null;
    const worker = async () => {
      while (!err) {
        if (ctx && ctx.cancelled) {
          err = Object.assign(new Error("Download cancelled"), {
            cancelled: true,
          });
          return;
        }
        const start = next;
        if (start >= size) return;
        next += CH;
        const end = Math.min(start + CH, size) - 1;
        try {
          const buf = await _rangeGet(url, start, end, 0, 10000, ua);
          fs.writeSync(fd, buf, 0, buf.length, start);
          got += buf.length;
          if (onProgress) {
            const pct = Math.round((got / size) * 100);
            onProgress({
              status: "downloading",
              percent: 10 + Math.round((pct * 80) / 100),
              message: `Downloading… ${pct}%`,
            });
          }
        } catch (e) {
          err = e;
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (err) throw err;
    if (got !== size) throw new Error("size mismatch");
  } finally {
    fs.closeSync(fd);
  }
}

function _validateAudio(file, expectedSec) {
  try {
    const f = TagLib.File.createFromPath(file);
    try {
      const ms = f.properties?.durationMilliseconds || 0;
      return (
        ms > 1000 && (!expectedSec || Math.abs(ms / 1000 - expectedSec) < 5)
      );
    } finally {
      f.dispose();
    }
  } catch (_) {
    return false;
  }
}

function fetchArtworkBuffer(url, timeoutMs = 6000, hops = 0) {
  return new Promise((resolve) => {
    if (!url || hops > 3) return resolve(null);
    try {
      const u = new URL(url);
      const isHttps = u.protocol === "https:";
      const req = (isHttps ? https : http).get(
        url,
        {
          headers: {
            "User-Agent": UA_DESKTOP,
            Accept: "image/jpeg,image/png,image/*",
          },
          agent: isHttps ? HTTPS_AGENT : undefined,
          timeout: timeoutMs,
        },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            return resolve(
              fetchArtworkBuffer(
                new URL(res.headers.location, url).href,
                timeoutMs,
                hops + 1,
              ),
            );
          }
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const b = Buffer.concat(chunks);
            resolve(b.length > 1000 ? b : null);
          });
          res.on("error", () => resolve(null));
        },
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function _artCandidates(url) {
  if (!url) return [];
  const out = [];
  if (/googleusercontent\.com|ggpht\.com/.test(url))
    out.push(url.replace(/=(?:w\d+-h\d+|s\d+)[^?#]*$/, "=w1200-h1200-l100-rj"));
  else if (/mzstatic\.com/.test(url))
    out.push(url.replace(/\d+x\d+(bb)?\.(jpg|png)/i, "1200x1200bb.jpg"));
  out.push(url);
  return [...new Set(out)];
}

async function fetchBestArtwork(url) {
  for (const u of _artCandidates(url)) {
    const b = await fetchArtworkBuffer(u, 8000);
    if (b) return b;
  }
  return null;
}

function _tagWithTagLib(filePath, info, artBuf) {
  try {
    const f = TagLib.File.createFromPath(filePath);
    try {
      const t = f.tag;
      const artist =
        info.artistName && info.artistName !== "Unknown Artist"
          ? info.artistName.trim()
          : "";
      if (info.trackName && info.trackName.trim())
        t.title = info.trackName.trim();
      if (artist) {
        t.performers = [artist];
        t.albumArtists = [artist];
      }
      if (
        info.albumName &&
        info.albumName.trim() &&
        info.albumName !== "Unknown Album"
      )
        t.album = info.albumName.trim();
      const yr = Number(info.releaseYear);
      if (yr > 1900 && yr <= new Date().getFullYear() + 1) t.year = yr;
      if (info.genre && info.genre !== "Music" && info.genre.trim())
        t.genres = [info.genre.trim()];
      const img = _artImage(artBuf);
      if (img) {
        const pic = TagLib.Picture.fromData(
          TagLib.ByteVector.fromByteArray(artBuf),
        );
        pic.mimeType = img.mime;
        pic.type = TagLib.PictureType.FrontCover;
        t.pictures = [pic];
      }
      f.save();
    } finally {
      f.dispose();
    }
  } catch (e) {
    console.warn("[DownloadEngine] TagLib tagging failed:", e.message);
  }
}

function _artImage(buf) {
  if (!buf) return null;
  let mime = null;
  if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
  else if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    mime = "image/png";
  return mime
    ? {
        mime,
        type: { id: 3, name: "front cover" },
        description: "Cover",
        imageBuffer: buf,
      }
    : null;
}

// ─── Post-download metadata injection ─────────────────────────────────────────
function injectTrackInfoTags(filePath, trackInfo, artBuf) {
  try {
    if (!/\.mp3$/i.test(filePath))
      return _tagWithTagLib(filePath, trackInfo, artBuf);
    const cleanTags = {};

    if (trackInfo.trackName && trackInfo.trackName.trim())
      cleanTags.title = trackInfo.trackName.trim();

    if (
      trackInfo.artistName &&
      trackInfo.artistName !== "Unknown Artist" &&
      trackInfo.artistName.trim()
    )
      cleanTags.artist = trackInfo.artistName.trim();

    if (cleanTags.artist) cleanTags.performerInfo = cleanTags.artist;

    if (
      trackInfo.albumName &&
      trackInfo.albumName.trim() &&
      trackInfo.albumName !== "Unknown Album"
    )
      cleanTags.album = trackInfo.albumName.trim();

    const yr = Number(trackInfo.releaseYear);
    if (yr > 1900 && yr <= new Date().getFullYear() + 1)
      cleanTags.year = String(yr);

    if (
      trackInfo.genre &&
      trackInfo.genre !== "Music" &&
      trackInfo.genre.trim()
    )
      cleanTags.genre = trackInfo.genre.trim();

    const img = _artImage(artBuf);
    if (img) cleanTags.image = img;

    if (Object.keys(cleanTags).length > 0) {
      const result = NodeID3.update(cleanTags, filePath);
      if (result === true) {
        console.log(
          `[DownloadEngine] Tags injected for "${trackInfo.trackName}" →`,
          Object.keys(cleanTags).join(", "),
        );
      } else {
        console.warn("[DownloadEngine] NodeID3.update returned:", result);
      }
    }
  } catch (tagErr) {
    console.warn(
      "[DownloadEngine] Failed to inject track tags:",
      tagErr.message,
    );
  }
}

// ─── Concurrency Limiter & OS Temp Staging (Zero HDD Bottleneck) ─────────────
const os = require("os");
const MAX_CONCURRENT_DOWNLOADS = 2;
let _activeCount = 0;
const _waitQueue = [];

function _acquireSlot(trackId) {
  if (_activeCount < MAX_CONCURRENT_DOWNLOADS) {
    _activeCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    _waitQueue.push({ trackId, resolve });
  });
}

function _releaseSlot() {
  _activeCount--;
  if (_waitQueue.length > 0 && _activeCount < MAX_CONCURRENT_DOWNLOADS) {
    _activeCount++;
    const item = _waitQueue.shift();
    if (item && item.resolve) item.resolve();
  }
}

function _moveFileSafe(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code === "EXDEV") {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}
async function downloadAndTagTrack(
  trackInfo,
  targetFolder,
  onProgress,
  trackId,
  fmt = "m4a",
) {
  if (onProgress && _activeCount >= MAX_CONCURRENT_DOWNLOADS) {
    onProgress({
      status: "queued",
      percent: 2,
      message: "Queued (in download queue)...",
    });
  }
  const ctx = { cancelled: false, proc: null, destBase: null };
  if (trackId) _downloads.set(trackId, ctx);
  await _acquireSlot(trackId);
  if (ctx.cancelled) {
    _releaseSlot();
    throw Object.assign(new Error("Download cancelled while queued"), {
      cancelled: true,
    });
  }
  try {
    return await _downloadAndTagTrackInner(
      trackInfo,
      targetFolder,
      onProgress,
      trackId,
      ctx,
      fmt,
    );
  } finally {
    _releaseSlot();
    if (trackId && _downloads.get(trackId) === ctx) _downloads.delete(trackId);
  }
}

async function _downloadAndTagTrackInner(
  trackInfo,
  targetFolder,
  onProgress,
  trackId,
  ctx,
  fmt = "m4a",
) {
  try {
    const dir = _ensureWritableDir(targetFolder);
    return await _downloadCore(trackInfo, dir, onProgress, trackId, ctx, fmt);
  } catch (err) {
    throw await _finalizeError(err);
  }
}

async function _downloadCore(
  trackInfo,
  targetFolder,
  onProgress,
  trackId,
  ctx,
  fmt = "m4a",
) {
  onProgress({
    status: "resolving",
    percent: 5,
    message: "Resolving audio with yt-dlp…",
  });

  const sanitize = (name) => name.replace(/[<>:"/\\|?*]/g, "").trim();
  const safeArtist = sanitize(trackInfo.artistName || "Unknown Artist");
  const safeTitle = sanitize(trackInfo.trackName || "Unknown Track");
  const destBase = path.join(targetFolder, `${safeArtist} - ${safeTitle}`);

  if (!fs.existsSync(targetFolder))
    fs.mkdirSync(targetFolder, { recursive: true });

  const artPromise = fetchBestArtwork(trackInfo.artworkUrl);

  // Strategy 1: Direct YouTube video download if videoId is present
  const videoId =
    trackInfo.videoId ||
    trackInfo.ytmVideoId ||
    (trackInfo.id && trackInfo.id.startsWith("ytm_")
      ? trackInfo.id.replace("ytm_", "")
      : null);
  if (videoId && videoId.length >= 5 && fmt === "m4a" && _fastFails < 5) {
    const out = `${destBase}.m4a`;
    const t0 = Date.now();
    try {
      ctx.destBase = destBase;
      const r = await _fastResolveAudio(videoId);
      console.log(
        `[DownloadEngine] fast resolve ${Date.now() - t0}ms`,
        r ? `${r.bitrate}bps` : "none",
      );
      if (!r || r.bitrate < 100000) throw new Error("no hq direct stream");
      // Probe first: if the URL stalls/403s, bail to yt-dlp in ~3s instead of retrying chunks
      await _rangeGet(r.url, 0, Math.min(32767, r.size - 1), 0, 1500, r.ua);
      await _fastDownload(r.url, r.size, out, onProgress, ctx, r.ua);
      if (!_validateAudio(out, r.durSec)) throw new Error("invalid audio");
      injectTrackInfoTags(out, trackInfo, await artPromise);
      _fastFails = 0;
      console.log(`[DownloadEngine] fast path OK in ${Date.now() - t0}ms`);
      onProgress({
        status: "done",
        percent: 100,
        message: "Done!",
        filePath: out,
      });
      return out;
    } catch (fastErr) {
      try {
        if (fs.existsSync(out)) fs.unlinkSync(out);
      } catch (_) {}
      if (fastErr.cancelled || ctx.cancelled) throw fastErr;
      _fastFails++;
      console.warn(
        "[DownloadEngine] fast path failed, using yt-dlp:",
        fastErr.message,
      );
    }
  }
  if (videoId && videoId.length >= 5) {
    try {
      onProgress({
        status: "downloading",
        percent: 10,
        message: "Downloading audio via yt-dlp…",
      });
      const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const downloadedPath = await downloadWithYtDlp(
        targetUrl,
        destBase,
        onProgress,
        trackId,
        ctx,
        fmt,
      );
      injectTrackInfoTags(downloadedPath, trackInfo, await artPromise);
      onProgress({
        status: "done",
        percent: 100,
        message: "Done!",
        filePath: downloadedPath,
      });
      return downloadedPath;
    } catch (ytdlpErr) {
      if (ytdlpErr.cancelled || ctx.cancelled) throw ytdlpErr;
      console.warn(
        "[DownloadEngine] Direct videoId failed, trying ytsearch1 with yt-dlp:",
        ytdlpErr.message,
      );
    }
  }

  // Strategy 1.5: Resolve videoId via exact ranked search matching before falling back to ytsearch
  let effectiveVideoId = videoId;
  if (!effectiveVideoId) {
    try {
      const q = [trackInfo.artistName, trackInfo.trackName]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (q) {
        onProgress({
          status: "resolving",
          percent: 8,
          message: "Finding best stream match…",
        });
        const found = await searchYouTubeMusic(q, 5).catch(() => []);
        if (found && found.length > 0) {
          const matched = rankAndMerge(found, q);
          if (matched && matched.length > 0 && matched[0].videoId) {
            effectiveVideoId = matched[0].videoId;
          }
        }
      }
    } catch (_) {}
  }

  if (
    effectiveVideoId &&
    effectiveVideoId.length >= 5 &&
    effectiveVideoId !== videoId
  ) {
    try {
      const targetUrl = `https://www.youtube.com/watch?v=${effectiveVideoId}`;
      const downloadedPath = await downloadWithYtDlp(
        targetUrl,
        destBase,
        onProgress,
        trackId,
        ctx,
        fmt,
      );
      injectTrackInfoTags(downloadedPath, trackInfo, await artPromise);
      onProgress({
        status: "done",
        percent: 100,
        message: "Done!",
        filePath: downloadedPath,
      });
      return downloadedPath;
    } catch (err) {
      if (err.cancelled || ctx.cancelled) throw err;
    }
  }

  // Strategy 1.8: keyless alternate source (no yt-dlp/ffmpeg needed)
  if (effectiveVideoId && effectiveVideoId.length >= 5) {
    try {
      const alt = await _pipedFallback(
        effectiveVideoId,
        destBase,
        fmt,
        onProgress,
        ctx,
      );
      injectTrackInfoTags(alt, trackInfo, await artPromise);
      onProgress({
        status: "done",
        percent: 100,
        message: "Done!",
        filePath: alt,
      });
      return alt;
    } catch (altErr) {
      if (altErr.cancelled || ctx.cancelled) throw altErr;
      console.warn("[DownloadEngine] alternate source failed:", altErr.message);
    }
  }

  // Strategy 2: Accurate search query with yt-dlp
  const searchQuery = `ytsearch1:${trackInfo.artistName} - ${trackInfo.trackName} audio`;
  onProgress({
    status: "downloading",
    percent: 10,
    message: "Searching and downloading via yt-dlp…",
  });
  const downloadedPath = await downloadWithYtDlp(
    searchQuery,
    destBase,
    onProgress,
    trackId,
    ctx,
    fmt,
  );
  injectTrackInfoTags(downloadedPath, trackInfo, await artPromise);
  onProgress({
    status: "done",
    percent: 100,
    message: "Done!",
    filePath: downloadedPath,
  });
  return downloadedPath;
}

// ─── Active download registry (trackId → per-attempt context) ─────────────────
const _downloads = new Map(); // trackId → { cancelled, proc, destBase }

function _cleanupPartials(destBase) {
  try {
    const dir = path.dirname(destBase);
    const base = path.basename(destBase);
    for (const f of fs.readdirSync(dir)) {
      if (
        f.startsWith(base) &&
        /\.(part|ytdl|temp|webm|m4a|opus)$|\.f\d+\.\w+$|\.part-Frag\d+$/i.test(
          f,
        )
      ) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch (_) {}
      }
    }
  } catch (_) {}
}

function cancelDownload(trackId) {
  const qIdx = _waitQueue.findIndex((item) => item.trackId === trackId);
  if (qIdx !== -1) {
    const [removed] = _waitQueue.splice(qIdx, 1);
    if (removed && removed.resolve) removed.resolve();
  }
  const ctx = _downloads.get(trackId);
  if (!ctx) return false;
  ctx.cancelled = true;
  const { proc, destBase } = ctx;
  if (proc) {
    try {
      if (process.platform === "win32" && proc.pid) {
        // Kill yt-dlp AND its ffmpeg children
        spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        proc.kill("SIGKILL");
      }
    } catch (_) {
      try {
        proc.kill("SIGKILL");
      } catch (__) {}
    }
    if (destBase) setTimeout(() => _cleanupPartials(destBase), 800);
  }
  return true;
}

module.exports = {
  searchITunes,
  downloadAndTagTrack,
  getYtDlpPath,
  ensureYtDlpAvailable,
  prewarmDownloader,
  ensureDependencies,
  ensureFfmpeg,
  classifyError,
  DownloadError,
  prefetchStream,
  cancelDownload,
};
