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
 *   - Clean MP4 container preservation (Zero ID3 corruption for perfect Chromium playback)
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

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
        const art = thumbs[thumbs.length - 1]?.url || "";
        const thumb = thumbs[0]?.url || art;
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
            ? artwork100.replace(/100x100/g, "600x600")
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
          const art =
            item.album?.cover_xl ||
            item.album?.cover_big ||
            item.album?.cover_medium ||
            "";
          const thumb =
            item.album?.cover_small || item.album?.cover_medium || "";
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
    const url =
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

    function fetchWithRedirects(currentUrl, hops = 0) {
      if (hops > 5)
        return reject(new Error("Too many redirects downloading yt-dlp"));
      const parsed = new URL(currentUrl);
      const client = parsed.protocol === "https:" ? https : http;

      const req = client.get(
        currentUrl,
        {
          headers: { "User-Agent": "Mozilla/5.0 NovaTune Downloader" },
        },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const nextUrl = new URL(res.headers.location, currentUrl).href;
            return fetchWithRedirects(nextUrl, hops + 1);
          }
          if (res.statusCode !== 200) {
            return reject(
              new Error(`Failed to download yt-dlp: HTTP ${res.statusCode}`),
            );
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
              } catch (err) {
                reject(err);
              }
            });
          });

          fileStream.on("error", (err) => {
            try {
              if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
            } catch (_) {}
            reject(err);
          });
        },
      );

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
    onProgress({
      status: "installing",
      percent: 0,
      message: "Setting up downloader components (one-time)…",
    });
  }

  console.log(
    "[DownloadEngine] yt-dlp binary missing! Auto-installing to:",
    targetPath,
  );
  await downloadYtDlpBinary(targetPath, (prog) => {
    if (onProgress) {
      onProgress({
        status: "installing",
        percent: Math.round(prog.percent * 0.9),
        message: `Setting up downloader components… ${prog.percent}%`,
      });
    }
  });

  return targetPath;
}

async function downloadWithYtDlp(urlOrQuery, destBase, onProgress, trackId) {
  const ytDlpBinary = await ensureYtDlpAvailable(onProgress);

  return new Promise((resolve, reject) => {
    const args = [
      urlOrQuery,
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--add-metadata",
      "--concurrent-fragments",
      "4",
      "-o",
      `${destBase}.%(ext)s`,
      "--no-playlist",
      "--newline",
    ];

    let finalFile = null;
    let proc = null;
    let errorOutput = "";

    try {
      proc = spawn(ytDlpBinary, args, { windowsHide: true });
      if (trackId) registerDownload(trackId, proc, destBase);
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
          onProgress({
            status: "downloading",
            percent: 10 + Math.round((pct * 80) / 100),
            message: `Downloading… ${pct}%`,
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
        const matched = files.find(
          (f) =>
            f.startsWith(baseName) &&
            (f.endsWith(".mp3") || f.endsWith(".m4a")),
        );
        if (matched) return resolve(path.join(dir, matched));
        resolve(expectedMp3);
      } else {
        const cleanErr =
          errorOutput.trim() || `Process exited with code ${code}`;
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
    if (!filePath.endsWith(".mp3")) return;
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

async function downloadAndTagTrack(
  trackInfo,
  targetFolder,
  onProgress,
  trackId,
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

  const artPromise = fetchArtworkBuffer(trackInfo.artworkUrl);

  // Strategy 1: Direct YouTube video download if videoId is present
  const videoId =
    trackInfo.videoId ||
    (trackInfo.id && trackInfo.id.startsWith("ytm_")
      ? trackInfo.id.replace("ytm_", "")
      : null);
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
      console.warn(
        "[DownloadEngine] Direct videoId failed, trying ytsearch1 with yt-dlp:",
        ytdlpErr.message,
      );
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

// ─── Active download registry (trackId → spawned yt-dlp process) ──────────────
const _activeDownloads = new Map(); // trackId → { proc, destBase }

function registerDownload(trackId, proc, destBase) {
  _activeDownloads.set(trackId, { proc, destBase });
  proc.on("close", () => _activeDownloads.delete(trackId));
  proc.on("error", () => _activeDownloads.delete(trackId));
}

function cancelDownload(trackId) {
  const entry = _activeDownloads.get(trackId);
  if (!entry) return false;
  const { proc, destBase } = entry;
  try {
    proc.kill("SIGKILL");
  } catch (_) {}
  _activeDownloads.delete(trackId);
  // Clean up partial files left by yt-dlp
  if (destBase) {
    [
      destBase + ".mp3.part",
      destBase + ".m4a.part",
      destBase + ".webm.part",
    ].forEach((f) => {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (_) {}
    });
  }
  return true;
}

module.exports = {
  searchITunes,
  downloadAndTagTrack,
  getYtDlpPath,
  ensureYtDlpAvailable,
  cancelDownload,
};
