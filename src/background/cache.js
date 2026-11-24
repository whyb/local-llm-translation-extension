const DB_NAME = 'lbt-cache';
const DB_VERSION = 4;
const STORES = {
  tm: { keyPath: 'key', indexes: [['lastUsed', 'lastUsed', false], ['domains', 'domains', true]] },
  pages: { keyPath: 'url', indexes: [['domain', 'domain', false]] },
  domainChrome: { keyPath: 'domain', indexes: [] },
  capabilities: { keyPath: 'profileId', indexes: [] },
  stats: { keyPath: 'scope', indexes: [] },
  runs: { keyPath: 'key', indexes: [] }
};

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function upgradeDatabase(database, transaction) {
  for (const [name, definition] of Object.entries(STORES)) {
    let store;
    if (!database.objectStoreNames.contains(name)) {
      store = database.createObjectStore(name, { keyPath: definition.keyPath });
    } else {
      store = transaction.objectStore(name);
    }
    for (const [indexName, keyPath, multiEntry] of definition.indexes) {
      if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, { multiEntry, unique: false });
    }
  }
}

export class CacheStore {
  constructor() {
    this.database = null;
    this.openPromise = null;
  }

  async open() {
    if (this.database) return this;
    if (this.openPromise) return this.openPromise;
    this.openPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable in this context'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => upgradeDatabase(request.result, request.transaction);
      request.onsuccess = () => {
        this.database = request.result;
        this.database.onversionchange = () => this.close();
        resolve(this);
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to open translation cache'));
      request.onblocked = () => reject(new Error('Translation cache is blocked by an older extension context'));
    }).catch((error) => {
      this.openPromise = null;
      throw error;
    });
    return this.openPromise;
  }

  close() {
    this.database?.close();
    this.database = null;
    this.openPromise = null;
  }

  async transaction(stores, mode, callback) {
    await this.open();
    const transaction = this.database.transaction(stores, mode);
    let result;
    try {
      result = callback(transaction);
    } catch (error) {
      try { transaction.abort(); } catch { /* noop */ }
      throw error;
    }
    await transactionDone(transaction);
    return result;
  }

  async get(storeName, key) {
    await this.open();
    const transaction = this.database.transaction([storeName], 'readonly');
    return requestAsPromise(transaction.objectStore(storeName).get(key));
  }

  async getAll(storeName) {
    await this.open();
    const transaction = this.database.transaction([storeName], 'readonly');
    return requestAsPromise(transaction.objectStore(storeName).getAll());
  }

  async put(storeName, value) {
    await this.open();
    const transaction = this.database.transaction([storeName], 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  }

  async putMany(storeName, values) {
    if (!values.length) return;
    await this.open();
    const transaction = this.database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const value of values) store.put(value);
    await transactionDone(transaction);
  }

  async delete(storeName, key) {
    await this.open();
    const transaction = this.database.transaction([storeName], 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  async deleteMany(storeName, keys) {
    if (!keys.length) return;
    await this.open();
    const transaction = this.database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const key of keys) store.delete(key);
    await transactionDone(transaction);
  }

  async clearStore(storeName) {
    await this.open();
    const transaction = this.database.transaction([storeName], 'readwrite');
    transaction.objectStore(storeName).clear();
    await transactionDone(transaction);
  }

  async clearAll() {
    await this.open();
    const names = Object.keys(STORES);
    const transaction = this.database.transaction(names, 'readwrite');
    for (const name of names) transaction.objectStore(name).clear();
    await transactionDone(transaction);
  }

  async tmGetMany(keys) {
    if (!keys.length) return [];
    await this.open();
    const transaction = this.database.transaction(['tm'], 'readonly');
    const store = transaction.objectStore('tm');
    return Promise.all(keys.map((key) => requestAsPromise(store.get(key))));
  }

  async tmAll() {
    return this.getAll('tm');
  }

  async tmPut(record) {
    return this.put('tm', record);
  }

  async tmPutMany(records) {
    return this.putMany('tm', records);
  }

  async tmDeleteMany(keys) {
    return this.deleteMany('tm', keys);
  }

  async pageGet(url) {
    return this.get('pages', url);
  }

  async pagePut(page) {
    return this.put('pages', page);
  }

  async pagesAll() {
    return this.getAll('pages');
  }

  async capabilityGet(profileId) {
    return this.get('capabilities', profileId);
  }

  async capabilityPut(capability) {
    return this.put('capabilities', capability);
  }

  async capabilitiesAll() {
    return this.getAll('capabilities');
  }

  async runPut(run) {
    return this.put('runs', run);
  }

  async runDelete(key) {
    return this.delete('runs', key);
  }

  async runsAll() {
    return this.getAll('runs');
  }

  async statsGet(scope = 'tm-lookups') {
    return this.get('stats', scope);
  }

  async statsPut(stats) {
    return this.put('stats', stats);
  }

  async purgeDomain(domain) {
    const normalized = String(domain || '').trim().toLowerCase();
    const [records, pages] = await Promise.all([this.tmAll(), this.pagesAll()]);
    const tmKeys = records.filter((record) => Array.isArray(record.domains) && record.domains.some((item) => item === normalized || item.endsWith(`.${normalized}`))).map((record) => record.key);
    const pageUrls = pages.filter((page) => page.domain === normalized || String(page.domain || '').endsWith(`.${normalized}`)).map((page) => page.url);
    await Promise.all([this.tmDeleteMany(tmKeys), this.deleteMany('pages', pageUrls)]);
    return { tm: tmKeys.length, pages: pageUrls.length };
  }

  async totalBytes() {
    const records = await this.tmAll();
    return records.reduce((sum, record) => sum + (Number(record.bytes) || JSON.stringify(record).length), 0);
  }

  async evict({ diskCapBytes = 256 * 1024 * 1024, ttlMs = null, now = Date.now() } = {}) {
    const records = await this.tmAll();
    const expired = [];
    const live = [];
    for (const record of records) {
      const age = now - Number(record.lastUsed ?? record.createdAt ?? 0);
      if (Number.isFinite(ttlMs) && ttlMs >= 0 && age > ttlMs) expired.push(record.key);
      else live.push(record);
    }
    live.sort((a, b) => Number(a.lastUsed ?? 0) - Number(b.lastUsed ?? 0));
    let total = live.reduce((sum, record) => sum + (Number(record.bytes) || JSON.stringify(record).length), 0);
    const evicted = [];
    while (total > diskCapBytes && live.length) {
      const record = live.shift();
      total -= Number(record.bytes) || JSON.stringify(record).length;
      evicted.push(record.key);
    }
    const remove = [...expired, ...evicted];
    if (remove.length) await this.tmDeleteMany(remove);
    return { expired: expired.length, evicted: evicted.length, bytes: total };
  }

  async removePage(url) {
    return this.delete('pages', url);
  }
}

export function recordSize(record) {
  const translationBytes = new TextEncoder().encode(record.translation ?? '').length;
  const textBytes = new TextEncoder().encode(record.normalizedText ?? '').length;
  const domainsBytes = new TextEncoder().encode((record.domains ?? []).join('\n')).length;
  return 160 + translationBytes + textBytes + domainsBytes;
}

export function serializeTm(records, format = 'json', now = Date.now()) {
  const payload = {
    lbt: 'tm-export',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    count: records.length,
    records
  };
  if (format === 'jsonl') return records.map((record) => JSON.stringify(record)).join('\n');
  return JSON.stringify(payload, null, 2);
}

export function parseTm(raw) {
  const text = String(raw ?? '').replace(/^\ufeff/, '').trim();
  if (!text) return { records: [], skipped: 0 };
  let values = [];
  if (text.startsWith('[') || text.startsWith('{')) {
    const parsed = JSON.parse(text);
    values = Array.isArray(parsed) ? parsed : Array.isArray(parsed.records) ? parsed.records : [];
  } else {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      values.push(JSON.parse(line));
    }
  }
  const records = [];
  let skipped = 0;
  for (const value of values) {
    if (!value || typeof value !== 'object') { skipped += 1; continue; }
    if (typeof value.key !== 'string' || typeof value.translation !== 'string' || typeof value.normalizedText !== 'string') {
      skipped += 1;
      continue;
    }
    records.push({
      key: value.key,
      translation: value.translation,
      normalizedText: value.normalizedText,
      srcLang: typeof value.srcLang === 'string' ? value.srcLang : null,
      tgtLang: typeof value.tgtLang === 'string' ? value.tgtLang : 'unknown',
      profileId: typeof value.profileId === 'string' ? value.profileId : 'imported',
      promptVersion: Number.isFinite(value.promptVersion) ? value.promptVersion : 1,
      styleId: value.styleId ?? null,
      model: typeof value.model === 'string' ? value.model : '',
      glossaryHash: typeof value.glossaryHash === 'string' ? value.glossaryHash : '',
      domains: Array.isArray(value.domains) ? value.domains.filter((item) => typeof item === 'string') : [],
      createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
      lastUsed: Number.isFinite(value.lastUsed) ? value.lastUsed : Date.now(),
      bytes: Number.isFinite(value.bytes) ? value.bytes : recordSize(value)
    });
  }
  return { records, skipped, total: values.length };
}

export const cacheStore = new CacheStore();
