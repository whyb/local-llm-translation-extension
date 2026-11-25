import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/content/early.js', import.meta.url), 'utf8');

function createHarness({ siteState, renderMode }) {
  const attributes = new Map();
  const messages = [];
  const settings = { translation: { renderMode } };
  const documentElement = {
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; }
  };
  const context = {
    console,
    location: { href: 'https://example.com/article' },
    document: {
      readyState: 'complete',
      documentElement,
      addEventListener() {}
    },
    window: { addEventListener() {} },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout() { return 0; },
    clearTimeout() {},
    LBT: {
      state: { settings },
      mark() {},
      async getSettings() { return settings; },
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'get-site-state') return { ok: true, ...siteState };
        if (message.type === 'page-snapshot-request') return { ok: true, snapshot: null };
        throw new Error(`unexpected message: ${message.type}`);
      },
      extractTextUnits() { return []; },
      applyEarlyTranslation() { throw new Error('early paint should not run in this test'); },
      errorMessage(error) { return error instanceof Error ? error.message : String(error); }
    }
  };
  return { context: vm.createContext(context), attributes, messages };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('timed out waiting for early cache painter');
}

test('early cache painter runs only for automatic sites', async () => {
  const ask = createHarness({
    siteState: { selected: 'ask', autoTranslateAllowed: false },
    renderMode: 'replace'
  });
  vm.runInContext(source, ask.context, { filename: 'early.js' });
  await waitFor(() => ask.attributes.get('data-lbt-early-status') === 'policy-skip');
  assert.deepEqual(ask.messages.map((message) => message.type), ['get-site-state']);
});

test('early cache painter defers non-replace display modes to the full run', async () => {
  const hover = createHarness({
    siteState: { selected: 'auto', autoTranslateAllowed: true },
    renderMode: 'replace-hover-reveal'
  });
  vm.runInContext(source, hover.context, { filename: 'early.js' });
  await waitFor(() => hover.attributes.get('data-lbt-early-status') === 'mode-deferred');
  assert.deepEqual(hover.messages.map((message) => message.type), ['get-site-state']);
});

test('early cache painter reaches cache lookup only when auto and replace are active', async () => {
  const automatic = createHarness({
    siteState: { selected: 'auto', autoTranslateAllowed: true },
    renderMode: 'replace'
  });
  vm.runInContext(source, automatic.context, { filename: 'early.js' });
  await waitFor(() => automatic.attributes.get('data-lbt-early-status') === 'no-snapshot');
  assert.deepEqual(automatic.messages.map((message) => message.type), ['get-site-state', 'page-snapshot-request']);
});
