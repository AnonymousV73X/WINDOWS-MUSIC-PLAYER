/**
 * NovaTune — Electron Builder Configuration
 * Extends the build config in package.json for advanced packaging.
 */

const path = require('path');

module.exports = {
  appId: 'com.novatune.player',
  productName: 'NovaTune',
  copyright: '© 2024 NovaTune. All rights reserved.',

  publish: {
    provider: 'github',
    owner: 'novatune',
    repo: 'player',
    releaseType: 'release',
  },

  directories: {
    output: path.join(__dirname, 'dist'),
    buildResources: path.join(__dirname, 'assets')
  },

  npmRebuild: false,

  files: [
    'main/**/*',
    'renderer/**/*',
    'assets/**/*',
    'package.json'
  ],

  fileAssociations: [
    { ext: 'mp3',  name: 'NovaTune.MP3',  description: 'MP3 Audio File',  mimeType: 'audio/mpeg' },
    { ext: 'flac', name: 'NovaTune.FLAC', description: 'FLAC Audio File', mimeType: 'audio/flac' },
    { ext: 'wav',  name: 'NovaTune.WAV',  description: 'WAV Audio File',  mimeType: 'audio/wav' },
    { ext: 'ogg',  name: 'NovaTune.OGG',  description: 'OGG Audio File',  mimeType: 'audio/ogg' },
    { ext: 'm4a',  name: 'NovaTune.M4A',  description: 'M4A Audio File',  mimeType: 'audio/mp4' },
    { ext: 'aac',  name: 'NovaTune.AAC',  description: 'AAC Audio File',  mimeType: 'audio/aac' },
    { ext: 'wma',  name: 'NovaTune.WMA',  description: 'WMA Audio File',  mimeType: 'audio/x-ms-wma' }
  ],

  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    icon: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
    requestedExecutionLevel: 'asInvoker',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
    uninstallerIcon: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
    installerHeaderIcon: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'NovaTune',
    perMachine: false,
    differentialPackage: true,
  },

  extraResources: [
    {
      from: 'assets/icons/tray.png',
      to: 'tray.png'
    }
  ]
};
