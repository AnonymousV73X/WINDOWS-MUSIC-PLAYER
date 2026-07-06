# NovaTune — Patch v2.5 (5 Targeted Fixes)

Based on the v2.4 log analysis. Five surgical fixes — no architectural changes.

## What was wrong (from v2.4 log)

| Issue | Impact | Root cause |
|-------|--------|------------|
| `auto is not defined` error | Next-track preload broken — every track transition has full HDD seek latency | `preload = auto` missing quotes (should be `"auto"`) |
| Fingerprint check STILL ran | 30-60s stat-walk on every launch | `_combinedFingerprint` only set during `library:scan`, never during startup manifest build |
| `thumbnail-atlas` took 48s | Built ALL 1127 bitmaps on every launch | No visibility filter — built entire library |
| `playlist-covers` took 39s | Re-preloaded all playlist covers every launch | Not cacheable |
| `_exhaustiveCoverArtAudit` fired 4× | Redundant work after bg-queue + tab navigations | No debounce — each tab switch triggered it |

## What v2.5 fixes

### Fix 1: `auto` typo → instant track transitions

**File**: `renderer/renderer.js` line 9809

```diff
- window._nextTrackAudio.preload = auto;
+ window._nextTrackAudio.preload = "auto";
```

**Impact**: The predictive next-track preload (fires at 80% playback) was throwing `ReferenceError: auto is not defined` on every `timeupdate` event. This silently broke the preload — every track transition had full HDD seek latency. Now the preload works: by the time a track ends, the next track's audio data is already buffered in `window._nextTrackAudio`.

### Fix 2: Persist `_combinedFingerprint` after startup manifest build

**File**: `main/ipc.js`

After building the manifest on startup (the `setImmediate` block), we now ALSO compute folder fingerprints in the background and persist them to `settings.json`:

```js
// After manifest build succeeds:
const fps = {};
for (const folder of scanFolders) {
  fps[folder] = await _computeFolderFingerprint([folder]);
}
const combined = Object.keys(fps).sort()
  .map(k => `${k}=${fps[k]}`).join("|");
freshSettings._scanFingerprints = fps;
freshSettings._combinedFingerprint = combined;
writeJSON(SETTINGS_FILE, freshSettings);
```

**Impact**: On the FIRST launch after applying v2.5, the manifest builds + fingerprints compute (30-60s in background, user is already playing music). On EVERY subsequent launch, the renderer's fast-path triggers:

```
[Startup] Manifest exists with saved fingerprint — skipping fingerprint check (fast path).
```

No more 30-60s stat-walk. The fingerprint check is eliminated entirely on stable libraries.

### Fix 3: `thumbnail-atlas` + `playlist-covers` now cacheable

**File**: `renderer/renderer.js` (bg-queue task definitions)

```diff
  const tasks = [
-   { name: "thumbnail-atlas",  fn: buildThumbnailAtlas,     cacheable: false, ... },
+   { name: "thumbnail-atlas",  fn: buildThumbnailAtlas,     cacheable: true,  ... },
    { name: "cover-art-audit",  fn: _exhaustiveCoverArtAudit, cacheable: true,  ... },
    ...
-   { name: "playlist-covers",  fn: _preloadPlaylistCovers,  cacheable: false, ... },
+   { name: "playlist-covers",  fn: _preloadPlaylistCovers,  cacheable: true,  ... },
  ];
```

**Impact**: Both tasks now skip for 7 days after a successful run. Combined with Fix 5 (lazy atlas), this eliminates the two biggest background costs:

| Task | v2.4 time | v2.5 first launch | v2.5 day 2-7 |
|------|-----------|-------------------|--------------|
| thumbnail-atlas | 47.9s | ~1-2s (lazy) | **0ms** (cached) |
| playlist-covers | 38.8s | 38.8s | **0ms** (cached) |

### Fix 4: Debounce `_exhaustiveCoverArtAudit`

**File**: `renderer/renderer.js`

Added a 2-second debounce wrapper `_exhaustiveCoverArtAuditDebounced()`. Updated the two navigation callers (albums tab + artists tab) to use it:

```js
let _exhaustiveAuditDebounceTimer = null;
let _exhaustiveAuditPending = false;

function _exhaustiveCoverArtAuditDebounced() {
  if (_exhaustiveAuditPending) return;
  _exhaustiveAuditPending = true;
  if (_exhaustiveAuditDebounceTimer) clearTimeout(_exhaustiveAuditDebounceTimer);
  _exhaustiveAuditDebounceTimer = setTimeout(() => {
    _exhaustiveAuditPending = false;
    _exhaustiveAuditDebounceTimer = null;
    _exhaustiveCoverArtAudit().catch(() => {});
  }, 2000);
}
```

**Impact**: The log showed 4 rapid calls to `_exhaustiveCoverArtAudit` after the bg-queue finished. Each call did the "collect groups needing art" scan even though the `_exhaustiveSearchRunning` flag prevented concurrent execution. Now all calls within 2 seconds collapse into one. The bg-queue still calls the non-debounced version directly (it doesn't need debouncing — it's already staggered).

### Fix 5: Lazy thumbnail atlas (only visible tracks)

**File**: `renderer/renderer.js` (`buildThumbnailAtlas` function)

**Before**: Built ALL 1127 track thumbnails → 48 seconds
**After**: Builds ONLY for visible tracks (virtual list viewport ~50 tracks) + 100-track fallback for non-virtual views → ~1-2 seconds

```js
async function buildThumbnailAtlas() {
  const visibleTrackIds = new Set();
  if (virtualList.activeSlots) {
    for (const [trackId, slot] of virtualList.activeSlots) {
      if (trackId) visibleTrackIds.add(trackId);
    }
  }
  // Fallback: first 100 tracks for non-virtual views (albums/artists/home)
  if (visibleTrackIds.size === 0) {
    for (const t of state.tracks.slice(0, 100)) {
      if (t._thumb || t.coverArt || t._hasCoverArt) visibleTrackIds.add(t.id);
    }
  }
  _atlasBuildQueue = state.tracks.filter(
    (t) => visibleTrackIds.has(t.id) && /* ... */
  );
  // ... rest unchanged
}
```

**Impact**: Initial atlas build drops from ~48s to ~1-2s. As the user scrolls, the virtual list's `_populateSlot` hook triggers individual atlas entries on demand (this already existed). The user never sees a missing thumbnail because the visible tracks are built first.

## Expected performance comparison

### v2.4 (your last log)
| Phase | Time |
|-------|------|
| Manifest build | 2907ms |
| Fingerprint check | ~30-60s (ran despite fast-path) |
| bg-queue: thumbnail-atlas | 47.9s |
| bg-queue: cover-art-audit | 306ms |
| bg-queue: missing-thumbnails | 18.4s |
| bg-queue: playlist-covers | 38.8s |
| **Total bg work** | **~105s + fingerprint** |
| Track transitions | Full HDD seek (preload broken) |

### v2.5 — First launch (manifest + fingerprints build)
| Phase | Time |
|-------|------|
| Manifest build | ~3s (background) |
| Fingerprint compute | ~30-60s (background, after manifest — user is playing music) |
| bg-queue: thumbnail-atlas | ~1-2s (lazy, visible only) |
| bg-queue: cover-art-audit | 306ms |
| bg-queue: missing-thumbnails | 18.4s (will cache for next time) |
| bg-queue: playlist-covers | 38.8s (will cache for next time) |
| **Total bg work** | **~60s** (but non-blocking) |
| Track transitions | Instant (preload fixed) |

### v2.5 — Second launch (everything cached)
| Phase | Time |
|-------|------|
| Manifest read | ~4ms |
| Fingerprint check | **0ms** (fast-path skip) |
| bg-queue: thumbnail-atlas | **0ms** (cached 7 days) |
| bg-queue: cover-art-audit | **0ms** (cached 7 days) |
| bg-queue: missing-thumbnails | **0ms** (cached 7 days) |
| bg-queue: playlist-covers | **0ms** (cached 7 days) |
| **Total bg work** | **~0ms** (all cached) |
| Track transitions | Instant (preload fixed) |

## How to apply

1. Stop NovaTune
2. Copy these 2 files over your project:
   ```
   novatune-manifest-patch/
     main/ipc.js          → main/ipc.js          (REPLACES v2.4)
     renderer/renderer.js → renderer/renderer.js (REPLACES v2.4)
   ```
3. `npm run build:main && npm start`

## What to expect

### First launch after v2.5
- `[manifest] missing on startup — building from SQLite library...` (if manifest was deleted)
- `[manifest] computing folder fingerprints in background...` ← NEW
- `[manifest] fingerprints persisted — next launch will skip fingerprint check` ← NEW
- `[bg-queue] (1/7) Running "thumbnail-atlas"...` → done in ~1-2s (was 48s) ← LAZY
- `[bg-queue] Skipping "thumbnail-atlas" — cached` won't appear yet (first run)
- No more `Event handler error for 'timeupdate': ReferenceError: auto is not defined` ← FIXED
- Track transitions at 80% are instant (next track preloads) ← FIXED

### Second launch
- `[manifest] already exists: 1127 tracks, v1`
- `[Startup] Manifest exists with saved fingerprint — skipping fingerprint check (fast path).` ← NEW
- `[bg-queue] Skipping "thumbnail-atlas" — cached Xmin ago` ← NEW
- `[bg-queue] Skipping "cover-art-audit" — cached Xmin ago`
- `[bg-queue] Skipping "missing-thumbnails" — cached Xmin ago`
- `[bg-queue] Skipping "playlist-covers" — cached Xmin ago`
- Only 3 tasks actually run (missing-cover-art, progressive-covers, preload-all-covers) — all <1s each

### Day 8+ (cache expires)
Cacheable tasks run once, re-cache, skip for another 7 days.

## Files changed in v2.5

| File | Changes |
|------|---------|
| `main/ipc.js` | After startup manifest build, compute + persist `_combinedFingerprint` + `_scanFingerprints` in background. Rebuild manifest with correct fpHash. |
| `renderer/renderer.js` | (1) Fix `auto` → `"auto"` typo. (2) `buildThumbnailAtlas` now only builds visible tracks (was all 1127). (3) `thumbnail-atlas` + `playlist-covers` tasks now cacheable. (4) Added `_exhaustiveCoverArtAuditDebounced()` with 2s debounce; updated albums/artists navigation callers. |

## If something breaks

1. **App won't start**: Same as v2.4 — set `NOVATUNE_USE_MANIFEST=0`
2. **Thumbnails missing on scroll**: The lazy atlas builds on demand via `_populateSlot`. If you see blank thumbnails, check the browser console for atlas errors.
3. **Fingerprint fast-path not triggering**: Check that `settings.json` has `_combinedFingerprint` set. If not, delete `library.bin` and relaunch — the startup build will compute it.

## What's NOT in this patch (coming next)

- **Audio engine first-chunk preload during splash**: load the saved track's first 5 seconds into a hidden buffer during splash so first-play is instant even on HDD timeout (Step 2)
- **Chokidar folder watching**: real-time file change detection to eliminate the fingerprint check entirely (Step 3)
- **Worker thread thumbnail generation**: move sharp processing off the main thread (Step 4)
