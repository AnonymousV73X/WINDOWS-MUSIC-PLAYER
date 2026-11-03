// scripts/apply-cancel-feature.js
// Applies the cancel-download feature across 3 files using exact string replacement
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function patch(filePath, replacements) {
  let src = fs.readFileSync(filePath, "utf8");
  let changed = false;
  for (const [target, replacement] of replacements) {
    if (!src.includes(target)) {
      console.error(`❌ Target not found in ${path.basename(filePath)}:\n  "${target.slice(0, 80)}..."`);
      process.exit(1);
    }
    src = src.split(target).join(replacement);
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(filePath, src, "utf8");
    console.log(`✅ Patched: ${path.relative(root, filePath)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. main/downloadEngine.js
// ─────────────────────────────────────────────────────────────────────────────
patch(path.join(root, "main/downloadEngine.js"), [
  // 1a. Add trackId param to downloadWithYtDlp
  [
    "async function downloadWithYtDlp(urlOrQuery, destBase, onProgress) {",
    "async function downloadWithYtDlp(urlOrQuery, destBase, onProgress, trackId) {"
  ],
  // 1b. Register download right after spawn
  [
    "    try {\r\n      proc = spawn(ytDlpBinary, args, { windowsHide: true });\r\n    } catch (err) {\r\n      return reject(err);\r\n    }",
    "    try {\r\n      proc = spawn(ytDlpBinary, args, { windowsHide: true });\r\n      if (trackId) registerDownload(trackId, proc);\r\n    } catch (err) {\r\n      return reject(err);\r\n    }"
  ],
  // 1c. Add trackId param to downloadAndTagTrack
  [
    "async function downloadAndTagTrack(trackInfo, targetFolder, onProgress) {",
    "async function downloadAndTagTrack(trackInfo, targetFolder, onProgress, trackId) {"
  ],
  // 1d. Thread trackId in strategy 1
  [
    "      const downloadedPath = await downloadWithYtDlp(targetUrl, destBase, onProgress);",
    "      const downloadedPath = await downloadWithYtDlp(targetUrl, destBase, onProgress, trackId);"
  ],
  // 1e. Thread trackId in strategy 2
  [
    "  const downloadedPath = await downloadWithYtDlp(searchQuery, destBase, onProgress);",
    "  const downloadedPath = await downloadWithYtDlp(searchQuery, destBase, onProgress, trackId);"
  ],
  // 1f. Upgrade cancelDownload to also clean up .part files (store {proc,destBase} in map)
  [
    `// ─── Active download registry (trackId → spawned yt-dlp process) ──────────────\nconst _activeDownloads = new Map(); // trackId → ChildProcess\n\nfunction registerDownload(trackId, proc) {\n  _activeDownloads.set(trackId, proc);\n  proc.on("close", () => _activeDownloads.delete(trackId));\n  proc.on("error", () => _activeDownloads.delete(trackId));\n}\n\nfunction cancelDownload(trackId) {\n  const proc = _activeDownloads.get(trackId);\n  if (!proc) return false;\n  try {\n    proc.kill("SIGKILL");\n  } catch (_) {}\n  _activeDownloads.delete(trackId);\n  return true;\n}`,
    `// ─── Active download registry (trackId → spawned yt-dlp process) ──────────────\nconst _activeDownloads = new Map(); // trackId → { proc, destBase }\n\nfunction registerDownload(trackId, proc, destBase) {\n  _activeDownloads.set(trackId, { proc, destBase });\n  proc.on("close", () => _activeDownloads.delete(trackId));\n  proc.on("error", () => _activeDownloads.delete(trackId));\n}\n\nfunction cancelDownload(trackId) {\n  const entry = _activeDownloads.get(trackId);\n  if (!entry) return false;\n  const { proc, destBase } = entry;\n  try { proc.kill("SIGKILL"); } catch (_) {}\n  _activeDownloads.delete(trackId);\n  // Clean up partial files left by yt-dlp\n  if (destBase) {\n    [destBase + ".mp3.part", destBase + ".m4a.part", destBase + ".webm.part"].forEach((f) => {\n      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}\n    });\n  }\n  return true;\n}`
  ],
]);

// Also fix registerDownload call to pass destBase (needs to be done inside downloadWithYtDlp body).
// We stored destBase before spawn, so let's patch the registerDownload call now:
patch(path.join(root, "main/downloadEngine.js"), [
  [
    "      proc = spawn(ytDlpBinary, args, { windowsHide: true });\r\n      if (trackId) registerDownload(trackId, proc);",
    "      proc = spawn(ytDlpBinary, args, { windowsHide: true });\r\n      if (trackId) registerDownload(trackId, proc, destBase);"
  ]
]);

// ─────────────────────────────────────────────────────────────────────────────
// 2. main/ipc.js
// ─────────────────────────────────────────────────────────────────────────────
patch(path.join(root, "main/ipc.js"), [
  // 2a. Thread trackId into downloadAndTagTrack
  [
    "    const savedPath = await DownloadEngine.downloadAndTagTrack(trackInfo, targetFolder, onProgress);",
    "    const savedPath = await DownloadEngine.downloadAndTagTrack(trackInfo, targetFolder, onProgress, trackInfo.id);"
  ],
  // 2b. Add the cancel IPC handler right after the download handler closes
  [
    "function compareVersions(a, b) {",
    `ipcMain.handle("discovery:cancel", async (event, { trackId }) => {
  try {
    const cancelled = DownloadEngine.cancelDownload(trackId);
    console.log(\`[IPC] discovery:cancel trackId=\${trackId} cancelled=\${cancelled}\`);
    return { success: cancelled };
  } catch (err) {
    console.error("[IPC] discovery:cancel error:", err);
    return { success: false, error: err.message };
  }
});

function compareVersions(a, b) {`
  ]
]);

// ─────────────────────────────────────────────────────────────────────────────
// 3. renderer/ui/DiscoveryView.js
// ─────────────────────────────────────────────────────────────────────────────
patch(path.join(root, "renderer/ui/DiscoveryView.js"), [
  // 3a. Add cancel ✕ button to the downloading/resolving branch
  [
    `    if (state.status === "downloading" || state.status === "resolving") {\r\n      return \`\r\n        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--green); font-weight: 500;">\r\n          <div style="width: 14px; height: 14px; border: 2px solid color-mix(in srgb, var(--green) 30%, transparent); border-top-color: var(--green); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>\r\n          <span>\${state.percent || 10}%</span>\r\n        </div>\r\n      \`;\r\n    }`,
    `    if (state.status === "downloading" || state.status === "resolving") {\r\n      return \`\r\n        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--green); font-weight: 500;">\r\n          <div style="width: 14px; height: 14px; border: 2px solid color-mix(in srgb, var(--green) 30%, transparent); border-top-color: var(--green); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>\r\n          <span>\${state.percent || 10}%</span>\r\n          <button class="action-cancel-btn" data-id="\${trackId}" style="background: none; border: none; padding: 2px 6px; cursor: pointer; color: rgba(255,255,255,0.45); font-size: 15px; line-height: 1; transition: color 0.15s;" title="Cancel download" onmouseover="this.style.color='rgba(255,80,80,0.9)'" onmouseout="this.style.color='rgba(255,255,255,0.45)'">✕</button>\r\n        </div>\r\n      \`;\r\n    }`
  ],
  // 3b. Add cancel button listener in _attachResultEvents, after download buttons
  [
    `    // Clicking row of a downloaded song plays it\r\n    this.container.querySelectorAll(".discovery-track-row").forEach((row) => {`,
    `    // Cancel buttons\r\n    this.container.querySelectorAll(".action-cancel-btn").forEach((btn) => {\r\n      btn.addEventListener("click", async (e) => {\r\n        e.stopPropagation();\r\n        const id = btn.dataset.id;\r\n        try {\r\n          await this.novaAPI.invoke("discovery:cancel", { trackId: id });\r\n        } catch (_) {}\r\n        this.downloadStates.delete(id);\r\n        this._updateTrackDownloadUI(id, { status: "idle" });\r\n      });\r\n    });\r\n\r\n    // Clicking row of a downloaded song plays it\r\n    this.container.querySelectorAll(".discovery-track-row").forEach((row) => {`
  ],
  // 3c. Guard row-click against cancel button too
  [
    `          e.target.closest(".preview-btn") ||\r\n          e.target.closest(".action-download-btn")\r\n        )\r\n          return;`,
    `          e.target.closest(".preview-btn") ||\r\n          e.target.closest(".action-download-btn") ||\r\n          e.target.closest(".action-cancel-btn")\r\n        )\r\n          return;`
  ]
]);

console.log("\n🎉 All patches applied successfully!");
