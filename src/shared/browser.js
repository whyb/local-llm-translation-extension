/**
 * Cross-browser WebExtension facade.
 *
 * Firefox exposes promise-based `browser` APIs. Chromium browsers expose
 * callback-first `chrome` APIs; Edge additionally provides a different
 * `browser` alias. Normalize both surfaces here so callers can always await.
 */

export const isFirefox = typeof navigator !== 'undefined' && /Firefox/i.test(navigator.userAgent);

// Edge exposes both namespaces. Its `browser` alias is not the same object as
// `chrome` and can differ in callback behavior, so Chromium browsers must use
// the native `chrome` surface. Firefox keeps its promise-based `browser` API.
export const extension = isFirefox
  ? globalThis.browser ?? globalThis.chrome
  : globalThis.chrome ?? globalThis.browser;
export const isChromeLike = !isFirefox;

export const runtime = extension?.runtime;
export const storage = extension?.storage;
export const tabs = extension?.tabs;
export const scripting = extension?.scripting;
export const permissions = extension?.permissions;
export const action = extension?.action;

function callChromeApi(method, context, ...args) {
  if (isFirefox) return method.apply(context, args);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(value);
    };
    const callback = (value) => {
      let error = null;
      try { error = extension?.runtime?.lastError ?? null; } catch { /* noop */ }
      finish(error, value);
    };
    let returned;
    try {
      returned = method.apply(context, [...args, callback]);
    } catch (error) {
      finish(error);
      return;
    }
    if (returned && typeof returned.then === 'function') {
      returned.then((value) => finish(null, value), (error) => finish(error));
    }
  });
}

export async function storageGet(key) {
  const values = await callChromeApi(storage.local.get, storage.local, key);
  return values?.[key];
}

export async function storageSet(key, value) {
  await callChromeApi(storage.local.set, storage.local, { [key]: value });
}

export async function storageRemove(key) {
  await callChromeApi(storage.local.remove, storage.local, key);
}

export async function storageClear() {
  await callChromeApi(storage.local.clear, storage.local);
}

export function sendRuntimeMessage(message, timeoutMs) {
  const request = callChromeApi(runtime.sendMessage, runtime, message);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return request;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Extension message timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function reportClientError(source, value, details = {}) {
  const error = value instanceof Error ? value : new Error(String(value ?? 'Unknown error'));
  const pageUrl = typeof globalThis.location?.href === 'string' ? globalThis.location.href : '';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return sendRuntimeMessage({
    type: 'client-error',
    source,
    level: 'error',
    message: error.message,
    stack: error.stack || '',
    url: pageUrl,
    userAgent,
    details
  }).catch(() => {});
}

export function openOptionsPage(section) {
  const normalizedSection = typeof section === 'string' ? section.trim().replace(/^#/, '') : '';
  if (normalizedSection && /^[a-z0-9_-]+$/i.test(normalizedSection)) {
    return tabs.create({ url: runtime.getURL(`src/ui/options/index.html#${normalizedSection}`) });
  }
  if (runtime.openOptionsPage) return runtime.openOptionsPage();
  return tabs.create({ url: runtime.getURL('src/ui/options/index.html') });
}

export function getUILanguage() {
  try {
    const value = extension?.i18n?.getUILanguage?.();
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    // Extension i18n is unavailable in some content-script contexts.
  }

  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages)) {
      const language = navigator.languages.find((value) => typeof value === 'string' && value.trim());
      if (language) return language.trim();
    }
    if (typeof navigator.language === 'string' && navigator.language.trim()) {
      return navigator.language.trim();
    }
  }
  return 'en';
}

export function onRuntimeMessage(handler) {
  if (isFirefox) {
    // Firefox resolves WebExtension message listeners directly from the returned
    // Promise. Returning `true` and resolving later through sendResponse can
    // outlive the listener's Promise scope during long provider requests.
    const listener = (message, sender) => Promise.resolve()
      .then(() => handler(message, sender))
      .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
  }
  const listener = (message, sender, sendResponse) => {
    Promise.resolve()
      .then(() => handler(message, sender))
      .then((result) => {
        if (result !== undefined) sendResponse(result);
      })
      .catch((error) => {
        try {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        } catch {
          // The message channel may already be closed.
        }
      });
    return true;
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}

export function onStorageChanged(handler) {
  storage.onChanged.addListener(handler);
  return () => storage.onChanged.removeListener(handler);
}

export async function queryTabs(queryInfo) {
  return callChromeApi(tabs.query, tabs, queryInfo);
}

export async function getTab(tabId) {
  return callChromeApi(tabs.get, tabs, tabId);
}

export async function sendTabMessage(tabId, message, options) {
  const args = options === undefined ? [tabId, message] : [tabId, message, options];
  return callChromeApi(tabs.sendMessage, tabs, ...args);
}

export async function createTab(properties) {
  return callChromeApi(tabs.create, tabs, properties);
}

export async function updateTab(tabId, properties) {
  return callChromeApi(tabs.update, tabs, tabId, properties);
}

export async function registerContentScripts(scripts) {
  return callChromeApi(scripting.registerContentScripts, scripting, scripts);
}

export async function getRegisteredContentScripts(filter) {
  return filter === undefined
    ? callChromeApi(scripting.getRegisteredContentScripts, scripting)
    : callChromeApi(scripting.getRegisteredContentScripts, scripting, filter);
}

export async function unregisterContentScripts(filter) {
  return filter === undefined
    ? callChromeApi(scripting.unregisterContentScripts, scripting)
    : callChromeApi(scripting.unregisterContentScripts, scripting, filter);
}

export async function executeScript(injection) {
  return callChromeApi(scripting.executeScript, scripting, injection);
}

export async function containsPermissions(permissionsToCheck) {
  return callChromeApi(permissions.contains, permissions, permissionsToCheck);
}

export async function requestPermissions(permissionsToRequest) {
  return callChromeApi(permissions.request, permissions, permissionsToRequest);
}

export async function removePermissions(permissionsToRemove) {
  return callChromeApi(permissions.remove, permissions, permissionsToRemove);
}

export async function getAllPermissions() {
  return callChromeApi(permissions.getAll, permissions);
}

export function onPermissionsAdded(handler) {
  permissions.onAdded.addListener(handler);
  return () => permissions.onAdded.removeListener(handler);
}

export function onPermissionsRemoved(handler) {
  permissions.onRemoved.addListener(handler);
  return () => permissions.onRemoved.removeListener(handler);
}

export function onTabUpdated(handler) {
  tabs.onUpdated.addListener(handler);
  return () => tabs.onUpdated.removeListener(handler);
}

export function onTabRemoved(handler) {
  tabs.onRemoved.addListener(handler);
  return () => tabs.onRemoved.removeListener(handler);
}

export function onTabActivated(handler) {
  tabs.onActivated.addListener(handler);
  return () => tabs.onActivated.removeListener(handler);
}

export function onCommand(handler) {
  extension.commands.onCommand.addListener(handler);
  return () => extension.commands.onCommand.removeListener(handler);
}

export function getManifest() {
  return runtime.getManifest();
}

export function getURL(path) {
  return runtime.getURL(path);
}
