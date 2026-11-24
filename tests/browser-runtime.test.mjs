import test from 'node:test';
import assert from 'node:assert/strict';

function runtimeEvent() {
  let listener = null;
  return {
    get listener() { return listener; },
    event: {
      addListener(fn) { listener = fn; },
      removeListener() { listener = null; }
    }
  };
}

test('Firefox runtime listeners return a Promise directly', async () => {
  const runtimeMessages = runtimeEvent();
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Firefox/128.0' }, configurable: true });
  globalThis.browser = { runtime: { onMessage: runtimeMessages.event } };
  delete globalThis.chrome;
  const browser = await import('../src/shared/browser.js?firefox-runtime-test');
  assert.equal(browser.isFirefox, true);
  browser.onRuntimeMessage(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { ok: true, value: 42 };
  });
  const result = await runtimeMessages.listener({ type: 'test' }, {});
  assert.deepEqual(result, { ok: true, value: 42 });
  delete globalThis.browser;
});

test('Chromium runtime listeners keep async sendResponse behavior', async () => {
  const runtimeMessages = runtimeEvent();
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Chrome/140.0' }, configurable: true });
  globalThis.chrome = { runtime: { onMessage: runtimeMessages.event } };
  delete globalThis.browser;
  const browser = await import('../src/shared/browser.js?chromium-runtime-test');
  assert.equal(browser.isFirefox, false);
  browser.onRuntimeMessage(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { ok: true, value: 7 };
  });
  let response = null;
  const keptOpen = runtimeMessages.listener({ type: 'test' }, {}, (value) => { response = value; });
  assert.equal(keptOpen, true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(response, { ok: true, value: 7 });
  delete globalThis.chrome;
});
test('Edge uses the native chrome namespace instead of its browser alias', async () => {
  let usedNamespace = null;
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/158.0.0.0 Safari/537.36 Edg/158.0.0.0' },
    configurable: true
  });
  const browserNamespace = {
    runtime: {
      sendMessage: async () => {
        usedNamespace = 'browser';
        return { namespace: 'browser' };
      }
    }
  };
  const chromeNamespace = {
    runtime: {
      sendMessage: async () => {
        usedNamespace = 'chrome';
        return { namespace: 'chrome' };
      }
    }
  };
  globalThis.browser = browserNamespace;
  globalThis.chrome = chromeNamespace;
  const browser = await import('../src/shared/browser.js?edge-runtime-test');
  assert.equal(browser.isFirefox, false);
  assert.equal(browser.extension, chromeNamespace);
  assert.deepEqual(await browser.sendRuntimeMessage({ type: 'test' }), { namespace: 'chrome' });
  assert.equal(usedNamespace, 'chrome');
  delete globalThis.browser;
  delete globalThis.chrome;
});
