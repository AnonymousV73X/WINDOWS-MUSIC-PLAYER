/**
 * NovaTune — Metadata Worker Thread
 * Offloads metadata parsing (music-metadata) to a separate thread
 * so the main process event loop stays responsive during scans.
 *
 * PERF FIX: On HDD, reading metadata for 1000+ tracks can take 60-120s.
 * Running this on the main process blocks ALL IPC handlers, making the
 * entire app unresponsive. This worker runs metadata reads in a separate
 * thread and communicates results via message passing.
 *
 * Usage:
 *   const worker = new MetadataWorker();
 *   worker.readMetadata(filePath).then(metadata => ...);
 *   worker.readQuickInfo(filePath).then(info => ...);
 *   worker.shutdown(); // clean up
 */

const { Worker } = require("worker_threads");
const path = require("path");

class MetadataWorker {
  constructor() {
    this._worker = null;
    this._taskId = 0;
    this._pending = new Map(); // taskId → { resolve, reject }
    this._initPromise = null;
  }

  /**
   * Lazily initialize the worker thread.
   */
  _ensureWorker() {
    if (this._worker) return;

    this._worker = new Worker(path.join(__dirname, "metadataWorkerThread.js"), {
      workerData: { coverCacheDir: null },
    });

    this._worker.on("message", (msg) => {
      const pending = this._pending.get(msg.taskId);
      if (!pending) return;
      this._pending.delete(msg.taskId);

      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }
    });

    this._worker.on("error", (err) => {
      console.error("[MetadataWorker] Worker error:", err.message);
      // Reject all pending tasks
      for (const [id, { reject }] of this._pending) {
        reject(new Error(`Worker error: ${err.message}`));
      }
      this._pending.clear();
      // Attempt restart on next call
      this._worker = null;
    });

    this._worker.on("exit", (code) => {
      if (code !== 0) {
        console.warn(`[MetadataWorker] Worker exited with code ${code}`);
      }
      this._worker = null;
    });
  }

  /**
   * Set the cover cache directory for the worker.
   */
  setCoverCacheDir(dir) {
    this._ensureWorker();
    this._worker.postMessage({ type: "setCoverCacheDir", dir });
  }

  /**
   * Read full metadata from a file in the worker thread.
   * @param {string} filePath
   * @returns {Promise<Object>}
   */
  readMetadata(filePath) {
    this._ensureWorker();
    const taskId = ++this._taskId;
    return new Promise((resolve, reject) => {
      this._pending.set(taskId, { resolve, reject });
      this._worker.postMessage({ type: "readMetadata", filePath, taskId });
    });
  }

  /**
   * Read quick info (duration, bitrate) from a file in the worker thread.
   * @param {string} filePath
   * @returns {Promise<Object>}
   */
  readQuickInfo(filePath) {
    this._ensureWorker();
    const taskId = ++this._taskId;
    return new Promise((resolve, reject) => {
      this._pending.set(taskId, { resolve, reject });
      this._worker.postMessage({ type: "readQuickInfo", filePath, taskId });
    });
  }

  /**
   * Shut down the worker thread.
   */
  shutdown() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    // Reject any remaining pending tasks
    for (const [id, { reject }] of this._pending) {
      reject(new Error("Worker shutdown"));
    }
    this._pending.clear();
  }
}

module.exports = MetadataWorker;
