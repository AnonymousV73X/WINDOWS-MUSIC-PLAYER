# NovaTune — Patch v2.6 (Splash Screen Redesign)

Pure UI polish — no logic changes. Fixes the "wobbly circles" and adds a modern minimal design.

## What was wrong

The splash status dots used Unicode characters (`○ ◐ ● ! –`) which:
1. **Wobbled** — each glyph renders at a different offset within its font box, and the `splash-spin` animation rotated the whole character around a non-centered origin
2. **Were inconsistent** across font fallbacks (monospace vs Outfit)
3. **Looked dated** — spinning `◐` is a 2010-era loading pattern

The music icon also had a `splash-float` animation that bobbed it up and down — too playful for "modern minimal".

## What v2.6 changes

### 1. CSS-drawn dots (no Unicode)

**Before**: `<span class="splash-status-dot">◐</span>` (text content, font-rendered)
**After**: `<span class="splash-status-dot"></span>` (empty, CSS draws the shape)

Each state has a distinct visual:

| State | Visual | CSS |
|-------|--------|-----|
| Not started | Dim hollow circle | `background: rgba(255,255,255,0.12)` |
| Loading | Pulsing green ring | `border: 1.5px solid var(--green)` + `splash-pulse` animation |
| Done | Solid green circle with glow | `background: var(--green)` + `box-shadow: 0 0 6px rgba(30,215,96,0.5)` |
| Error | Solid red circle | `background: #ff6b6b` |
| Skipped | Hollow dim circle | `border: 1px solid rgba(255,255,255,0.15)` |

The `splash-pulse` animation scales the ring (1.0 → 1.15 → 1.0) and emits an expanding box-shadow halo — Material Design-style ripple. No rotation, so no wobble.

### 2. Progress bar

Added a 2px progress track below the status panel:

```html
<div class="splash-progress-track">
  <div id="splash-progress-fill" class="splash-progress-fill"></div>
</div>
```

The fill width is calculated in `_renderSplashStatus()`:

```js
const total = _splashSubsystems.length;  // 7
let completed = 0;
for (const sub of _splashSubsystems) {
  const info = _splashStatus[sub.id];
  if (info && (info.state === "done" || info.state === "skipped")) {
    completed++;
  }
}
const pct = Math.round((completed / total) * 100);
fill.style.width = pct + "%";
```

**"Skipped" counts as complete** — if the fingerprint check is skipped (fast-path), the user doesn't need to wait for it, so it counts toward progress.

The fill has a green glow (`box-shadow: 0 0 8px rgba(30,215,96,0.4)`) and uses a smooth cubic-bezier transition (`0.5s cubic-bezier(0.4, 0, 0.2, 1)` — the Material Design standard easing).

### 3. Icon animation toned down

**Before**: `splash-float` (bobbed up/down 5px every 2.4s) + `splash-glow` (pulsed opacity)
**After**: Only `splash-glow` (subtle 3s pulse, 6% → 14% opacity)

The icon is now static — no vertical movement. The glow pulse is slower (3s vs 2.4s) and more subtle (6-14% vs 8-18%). This feels calmer and more "premium".

Icon size reduced from 56px → 48px to match the more minimal aesthetic.

### 4. Typography refined

- Title: 22px → 20px, weight 700 → 600, letter-spacing -0.5px → -0.3px
- Status labels: font-weight 400 (unchanged), but `font-variant-numeric: tabular-nums` on messages so timestamps/counts don't jitter

### 5. Layout refined

- Status panel `margin-top: 8px` → `24px` (more breathing room below title)
- Row `gap: 8px` → `10px`, `grid-template-columns: 16px 1fr auto` → `14px 1fr auto`
- Dot size: implicit (font-size 12px) → explicit `8px × 8px`
- Progress track: 260px wide, 2px tall, `margin-top: 20px`

## Visual result

```
        ┌─────────────┐
        │      ♫      │  ← Static icon, subtle glow pulse
        │             │
        │   NovaTune  │  ← Smaller, lighter title
        │             │
        │  ● Booting         ✓│  ← Done (green glow)
        │  ● Settings        ✓│
        │  ◯ Library    1127 tracks│  ← Loading (pulsing ring)
        │  ○ Playlists       │  ← Not started (dim)
        │  ○ Last track      │
        │  ○ Audio engine    │
        │  ○ Library check   │
        │             │
        │  ▓▓▓▓▓░░░░░░░░░░░░░│  ← Progress bar (28%)
        └─────────────┘
```

## How to apply

1. Stop NovaTune
2. Copy these 3 files over your project:
   ```
   novatune-manifest-patch/
     renderer/renderer.js       → renderer/renderer.js       (REPLACES v2.5)
     renderer/index.html        → renderer/index.html        (REPLACES v2.5)
     renderer/styles/main.css   → renderer/styles/main.css   (REPLACES v2.5)
   ```
3. `npm run build:main && npm start`

## What to expect

The splash will look visibly different on next launch:
- **No wobble** — dots are CSS-drawn, perfectly centered
- **Pulsing rings** instead of spinning characters for loading state
- **Green glow** on completed items
- **Progress bar** at the bottom fills as subsystems complete
- **Calmer icon** — no bobbing, just a subtle glow pulse
- **Better spacing** — more breathing room, smaller icon, lighter title

The functionality is identical to v2.5 — same subsystems, same status messages, same splash dismiss logic. Only the visual presentation changed.

## Files changed in v2.6

| File | Changes |
|------|---------|
| `renderer/index.html` | Added `<div class="splash-progress-track">` + `<div id="splash-progress-fill">` below the status panel |
| `renderer/styles/main.css` | Rewrote splash styles: CSS-drawn dots, pulsing ring animation, progress bar, toned down icon animation, refined typography |
| `renderer/renderer.js` | Removed Unicode character assignments (`○ ◐ ● ! –`) from `_renderSplashStatus()`. Added progress bar percentage calculation + update logic. |

## Notes

- The `splash-float` keyframe was removed entirely (no longer referenced)
- The `splash-spin` keyframe was removed (no longer needed — pulsing replaces spinning)
- The `splash-glow` keyframe was kept but tuned (slower, more subtle)
- The `splash-fade-up` keyframe was kept (used for initial fade-in of all elements)
- All status states use CSS classes (`is-loading`, `is-done`, `is-error`, `is-skipped`) — no JS-driven style changes, all declarative
