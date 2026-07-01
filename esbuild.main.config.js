const esbuild = require("esbuild");

esbuild
  .build({
    entryPoints: ["main/main.js"],
    bundle: true,
    platform: "node",
    target: "node18", // Electron 28 uses Node 18+
    external: [
      "electron",
      "better-sqlite3",
      "sharp",
      "music-metadata",
      "electron-updater", // Must be external — contains dynamic requires
      "chokidar", // Must be external — used by electron-updater
    ],
    outfile: "main/main.bundle.js",
    minify: process.env.NODE_ENV === "production",
    sourcemap: true,
  })
  .catch(() => process.exit(1));
