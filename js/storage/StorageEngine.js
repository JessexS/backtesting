// ═══════════════════════════════════════════════════════════════
// StorageEngine — IndexedDB persistence for backtest results
// Stores: run metadata, equity curves, trade history
// ═══════════════════════════════════════════════════════════════

export class StorageEngine {
  constructor(dbName = 'BacktestDB', version = 1) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('runs')) {
          const store = db.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('strategy', 'strategy', { unique: false });
        }

        if (!db.objectStoreNames.contains('equityCurves')) {
          db.createObjectStore('equityCurves', { keyPath: 'runId' });
        }

        if (!db.objectStoreNames.contains('trades')) {
          const tradeStore = db.createObjectStore('trades', { keyPath: 'id', autoIncrement: true });
          tradeStore.createIndex('runId', 'runId', { unique: false });
        }

        if (!db.objectStoreNames.contains('candles')) {
          db.createObjectStore('candles', { keyPath: 'runId' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  // Save a backtest run
  async saveRun(runData) {
    if (!this.db) await this.init();

    const run = {
      timestamp: Date.now(),
      strategy: runData.strategy || 'Unknown',
      metrics: runData.metrics,
      settings: runData.settings,
      marketParams: runData.marketParams,
      duration: runData.duration,
      totalCandles: runData.totalCandles,
    };

    const runId = await this._put('runs', run);

    // Save equity curve separately (can be large)
    if (runData.equityCurve) {
      await this._put('equityCurves', { runId, data: runData.equityCurve });
    }

    // Save trades
    if (runData.trades) {
      for (const trade of runData.trades) {
        await this._put('trades', { ...trade, runId });
      }
    }

    return runId;
  }

  // Get all runs (metadata only)
  async getRuns(limit = 50) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('runs', 'readonly');
      const store = tx.objectStore('runs');
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev');
      const results = [];

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  // Get a specific run with full data
  async getRun(runId) {
    if (!this.db) await this.init();
    const run = await this._get('runs', runId);
    if (!run) return null;

    const equityData = await this._get('equityCurves', runId);
    run.equityCurve = equityData?.data || [];

    const trades = await this._getAllByIndex('trades', 'runId', runId);
    run.trades = trades;

    return run;
  }

  // Delete a run and associated data
  async deleteRun(runId) {
    if (!this.db) await this.init();
    await this._delete('runs', runId);
    await this._delete('equityCurves', runId);

    // Delete associated trades
    const trades = await this._getAllByIndex('trades', 'runId', runId);
    for (const t of trades) {
      await this._delete('trades', t.id);
    }
  }

  // Clear all data
  async clearAll() {
    if (!this.db) await this.init();
    await this._clear('runs');
    await this._clear('equityCurves');
    await this._clear('trades');
    await this._clear('candles');
  }

  // Get storage statistics
  async getStats() {
    if (!this.db) await this.init();
    const runs = await this.getRuns(1000);
    return {
      totalRuns: runs.length,
      oldestRun: runs.length > 0 ? new Date(runs[runs.length - 1].timestamp).toLocaleDateString() : 'N/A',
      newestRun: runs.length > 0 ? new Date(runs[0].timestamp).toLocaleDateString() : 'N/A',
    };
  }

  // Internal helpers
  _put(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _get(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _clear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _getAllByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }
}
