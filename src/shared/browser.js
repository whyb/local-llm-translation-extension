/**
 * Cross-browser WebExtension facade.
 *
 * Firefox exposes `browser` promises; Chromium-based browsers expose `chrome`
 * promises for the MV3 APIs used here. Keeping this in one place makes the
 * rest of the codebase free of namespace conditionals.
 */
export const extension = globalThis.browser ?? globalThis.chrome;

export const isFirefox = typeof navigator !== 'undefined' && /Firefox/i.test(navigator.userAgent);
export const isChromeLike = !isFirefox;

export const runtime = extension?.runtime;
export const storage = extension?.storage;
export const tabs = extension?.tabs;
export const scripting = extension?.scripting;
export const permissions = extension?.permissions;
export const action = extension?.action;
export const offscreen = extension?.offscreen;

export async function storageGet(key) {
  const values = await storage.local.get(key);
  return values?.[key];
}

export async function storageSet(key, value) {
  await storage.local.set({ [key]: value });
}

export async function storageRemove(key) {
  await storage.local.remove(key);
}

export async function storageClear() {
  await storage.local.clear();
}

export function sendRuntimeMessage(message) {
  return runtime.sendMessage(message);
}

export function connectRuntime(name) {
  return runtime.connect({ name });
}

export function openOptionsPage() {
  if (runtime.openOptionsPage) return runtime.openOptionsPage();
  return tabs.create({ url: runtime.getURL('src/ui/options/index.html') });
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

export function onRuntimeConnect(handler) {
  const listener = (port) => handler(port);
  runtime.onConnect.addListener(listener);
  return () => runtime.onConnect.removeListener(listener);
}
export function onStorageChanged(handler) {
  storage.onChanged.addListener(handler);
  return () => storage.onChanged.removeListener(handler);
}

export async function queryTabs(queryInfo) {
  return tabs.query(queryInfo);
}

export async function getTab(tabId) {
  return tabs.get(tabId);
}

export async function sendTabMessage(tabId, message, options) {
  return tabs.sendMessage(tabId, message, options);
}

export async function createTab(properties) {
  return tabs.create(properties);
}

export async function updateTab(tabId, properties) {
  return tabs.update(tabId, properties);
}

export async function registerContentScripts(scripts) {
  return scripting.registerContentScripts(scripts);
}

export async function getRegisteredContentScripts(filter) {
  return scripting.getRegisteredContentScripts(filter);
}

export async function unregisterContentScripts(filter) {
  return scripting.unregisterContentScripts(filter);
}

export async function executeScript(injection) {
  return scripting.executeScript(injection);
}

export async function containsPermissions(permissionsToCheck) {
  return permissions.contains(permissionsToCheck);
}

export async function requestPermissions(permissionsToRequest) {
  return permissions.request(permissionsToRequest);
}

export async function removePermissions(permissionsToRemove) {
  return permissions.remove(permissionsToRemove);
}

export async function getAllPermissions() {
  return permissions.getAll();
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
