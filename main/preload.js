/**
 * NovaTune — Preload Script
 * Exposes safe APIs to the renderer process via contextBridge.
 * Window controls are handled natively via titleBarOverlay.
 */

const { ipcRenderer } = require("electron");

window.novaAPI = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    return () => ipcRenderer.removeAllListeners(channel);
  },
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
};
