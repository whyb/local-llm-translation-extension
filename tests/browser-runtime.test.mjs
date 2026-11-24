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
