import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const registered = new Map();
const delay = () => new Promise((resolve) => setTimeout(resolve, 1));

globalThis.chrome = {
  scripting: {
    async getRegisteredContentScripts() {
      await delay();
      return [...registered.values()].map((script) => ({ ...script, js: [...script.js], css: [...script.css], matches: [...script.matches] }));
    },
    async registerContentScripts(scripts) {
      await delay();
      for (const script of scripts) {
        if (registered.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
      }
      for (const script of scripts) registered.set(script.id, script);
    },
    async unregisterContentScripts(filter) {
      await delay();
      if (!filter?.ids) {
        registered.clear();
        return;
      }
      for (const id of filter.ids) registered.delete(id);
    },
    async executeScript() { return [{ result: true }]; }
  },
  permissions: {
    async contains() { return true; },
    async request() { return true; },
    async remove() { return true; },
    async getAll() { return { origins: [] }; },
    onAdded: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  },
  tabs: {
    async query() { return []; },
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} },
    onActivated: { addListener() {}, removeListener() {} }
  },
  storage: { local: {}, onChanged: { addListener() {}, removeListener() {} } }
};

const { ALL_URLS, injectIntoOpenTabs, registerPattern, scriptsForPattern, syncSiteScripts } = await import('../src/background/site-permissions.js');
const pattern = '*://www.cnbc.com/*';

test('concurrent registration requests never duplicate dynamic script ids', async () => {
  await Promise.all([
    registerPattern(pattern, false),
    registerPattern(pattern, true),
    registerPattern(pattern, false),
    registerPattern(pattern, true)
  ]);
  const ids = [...registered.keys()];
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(new Set(ids), new Set(scriptsForPattern(pattern, true).map((script) => script.id)));
});

test('upgrading a partial registration removes the existing frame script first', async () => {
  await registerPattern(pattern, false);
  assert.deepEqual([...registered.keys()], [`lbt-site-www-cnbc-com-frame`]);
  await registerPattern(pattern, true);
  const ids = [...registered.keys()].sort();
  assert.deepEqual(ids, scriptsForPattern(pattern, true).map((script) => script.id).sort());
});

test('permission sync and explicit registration are serialized', async () => {
  globalThis.chrome.permissions.getAll = async () => ({ origins: [pattern] });
  await Promise.all([
    registerPattern(pattern, true),
    syncSiteScripts({ enabledSites: ['www.cnbc.com'], allSitesEnabled: false })
  ]);
  const ids = [...registered.keys()].sort();
  assert.deepEqual(ids, scriptsForPattern(pattern, true).map((script) => script.id).sort());
});

test('broad all-sites permission registers an all-urls dynamic script bundle', async () => {
  globalThis.chrome.permissions.getAll = async () => ({ origins: [ALL_URLS] });
  await syncSiteScripts({ enabledSites: [], allSitesEnabled: true });
  const ids = [...registered.keys()].sort();
  assert.deepEqual(ids, scriptsForPattern(ALL_URLS, true).map((script) => script.id).sort());
});
test('open-tab reinjection does not trust a stale content-script marker', async () => {
  const source = await readFile(new URL('../src/background/site-permissions.js', import.meta.url), 'utf8');
  assert.match(source, /globalThis\.LBT\?\.api\?\.runtime\?\.id/);
  assert.match(source, /data-lbt-loaded/);

  const originalQuery = globalThis.chrome.tabs.query;
  const originalExecute = globalThis.chrome.scripting.executeScript;
  const calls = [];
  globalThis.chrome.tabs.query = async () => [{ id: 77, url: 'https://www.cnbc.com/' }];
  globalThis.chrome.scripting.executeScript = async (options) => {
    calls.push(options);
    if (options.func) return [{ result: false }];
    return [{ result: null }];
  };
  try {
    await injectIntoOpenTabs(pattern, true);
    assert.ok(calls.some((options) => options.files?.includes('src/content/main.js')));
  } finally {
    globalThis.chrome.tabs.query = originalQuery;
    globalThis.chrome.scripting.executeScript = originalExecute;
  }
});
