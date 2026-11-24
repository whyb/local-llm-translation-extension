import {
  containsPermissions, executeScript, getAllPermissions, getRegisteredContentScripts, isFirefox, onPermissionsAdded,
  onPermissionsRemoved, queryTabs, registerContentScripts, removePermissions,
  requestPermissions, unregisterContentScripts
} from '../shared/browser.js';
import { hostPatternForUrl, normalizeDomain } from '../shared/urls.js';
import { domainMatches } from '../shared/settings.js';

export const ALL_URLS = '<all_urls>';

export const CONTENT_SCRIPTS = [
  {
    key: 'early',
    js: ['src/content/common.js', 'src/content/early.js'],
    css: ['src/content/content.css'],
    runAt: 'document_start',
    allFrames: false,
    enabledOnly: true
  },
  {
    key: 'main',
    js: ['src/content/common.js', 'src/content/main.js'],
    css: ['src/content/content.css'],
    runAt: 'document_idle',
    allFrames: false,
    enabledOnly: true,
    catchUp: true
  },
  {
    key: 'frame',
    js: ['src/content/common.js', 'src/content/frame.js'],
    css: ['src/content/content.css'],
    runAt: 'document_idle',
    allFrames: true,
    enabledOnly: false,
    originFallback: true
  }
];

let contentScriptQueue = Promise.resolve();

function enqueueContentScriptOperation(operation) {
  const next = contentScriptQueue.then(operation, operation);
  contentScriptQueue = next.catch(() => {});
  return next;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function scriptId(pattern, key) {
  return `lbt-site-${slug(pattern)}-${key}`;
}

function idsForPattern(pattern) {
  return CONTENT_SCRIPTS.map((script) => scriptId(pattern, script.key));
}

export function scriptsForPattern(pattern, enabled) {
  return CONTENT_SCRIPTS
    .filter((script) => !script.enabledOnly || enabled || script.allFrames)
    .map((script) => ({
      id: scriptId(pattern, script.key),
      matches: [pattern],
      js: script.js,
      css: script.css,
      runAt: script.runAt,
      allFrames: script.allFrames,
      persistAcrossSessions: true,
      ...script.originFallback && isFirefox ? { matchOriginAsFallback: true } : {}
    }));
}

async function unregisterPatternNow(pattern) {
  const ids = new Set(idsForPattern(pattern));
  const registered = await getRegisteredContentScripts();
  const existing = registered.map((script) => script.id).filter((id) => ids.has(id));
  if (existing.length) await unregisterContentScripts({ ids: existing });
}

export function unregisterPattern(pattern) {
  return enqueueContentScriptOperation(() => unregisterPatternNow(pattern));
}

async function unregisterAllSiteScriptsNow() {
  await unregisterContentScripts();
}

export function unregisterAllSiteScripts() {
  return enqueueContentScriptOperation(() => unregisterAllSiteScriptsNow());
}

async function registerPatternNow(pattern, enabled) {
  await unregisterPatternNow(pattern);
  const scripts = scriptsForPattern(pattern, enabled);
  if (!scripts.length) return;
  try {
    await registerContentScripts(scripts);
  } catch (error) {
    if (!scripts.some((script) => 'matchOriginAsFallback' in script)) throw error;
    const fallback = scripts.map(({ matchOriginAsFallback, ...script }) => script);
    await registerContentScripts(fallback);
  }
}

export function registerPattern(pattern, enabled) {
  return enqueueContentScriptOperation(() => registerPatternNow(pattern, enabled));
}

export async function listGrantedOrigins() {
  try {
    const granted = await getAllPermissions();
    return (granted.origins ?? []).filter((origin) => origin === ALL_URLS || /^(\*|https?):\/\//.test(origin));
  } catch {
    return [];
  }
}

export async function hasAllSitesPermission() {
  try { return await containsPermissions({ origins: [ALL_URLS] }); } catch { return false; }
}

export async function requestAllSitesPermission() {
  try { return await requestPermissions({ origins: [ALL_URLS] }); } catch { return false; }
}

export async function removeAllSitesPermission() {
  try { return await removePermissions({ origins: [ALL_URLS] }); } catch { return false; }
}

export async function hasSitePermission(url) {
  const pattern = hostPatternForUrl(url);
  if (!pattern) return false;
  try {
    return await containsPermissions({ origins: [pattern] }) || await hasAllSitesPermission();
  } catch {
    return false;
  }
}

export async function requestSitePermission(url) {
  const pattern = hostPatternForUrl(url);
  if (!pattern) return false;
  try { return await requestPermissions({ origins: [pattern] }); } catch { return false; }
}

async function injectScriptsIntoTab(tab) {
  if (tab.id === undefined) return;
  try {
    const probe = await executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          const runtimeId = globalThis.chrome?.runtime?.id;
          return Boolean(
            runtimeId
            && globalThis.LBT?.api?.runtime?.id === runtimeId
            && document.documentElement?.hasAttribute('data-lbt-loaded')
            && document.querySelector('[data-lbt-floating-control]')
          );
        } catch {
          return false;
        }
      }
    });
    if (probe?.[0]?.result === true) return;
    await executeScript({
      target: { tabId: tab.id },
      files: ['src/content/common.js', 'src/content/main.js']
    });
    await executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement?.setAttribute('data-lbt-injected', 'true')
    }).catch(() => {});
  } catch { /* Restricted tab or missing permission. */ }
}

async function injectIntoOpenTabsNow(pattern, enabled) {
  if (!enabled) return;
  let tabs = [];
  try { tabs = await queryTabs({ url: pattern }); } catch { return; }
  for (const tab of tabs) await injectScriptsIntoTab(tab);
}

async function injectIntoAllOpenTabsNow() {
  let tabs = [];
  try { tabs = await queryTabs({}); } catch { return; }
  for (const tab of tabs) {
    if (!/^(?:https?|file):/i.test(String(tab.url || ''))) continue;
    await injectScriptsIntoTab(tab);
  }
}

export function injectIntoOpenTabs(pattern, enabled) {
  return enqueueContentScriptOperation(() => injectIntoOpenTabsNow(pattern, enabled));
}

export function syncSiteScripts({ enabledSites, allSitesEnabled }) {
  return enqueueContentScriptOperation(async () => {
    const granted = await listGrantedOrigins();
    await unregisterAllSiteScriptsNow();
    for (const pattern of granted) {
      if (pattern === ALL_URLS) {
        if (allSitesEnabled) {
          await registerPatternNow(ALL_URLS, true);
          await injectIntoAllOpenTabsNow();
        } else {
          for (const site of enabledSites ?? []) {
            const patternForSite = site.startsWith('*://') ? site : `*://${site}/*`;
            await registerPatternNow(patternForSite, true);
          }
        }
        continue;
      }
      const host = pattern.replace(/^\*:\/\//, '').replace(/\/\*$/, '');
      const enabled = allSitesEnabled || (enabledSites ?? []).some((site) => domainMatches(host, normalizeDomain(site)));
      await registerPatternNow(pattern, enabled);
    }
  });
}

export async function activateSite(url, { enabled = true } = {}) {
  const pattern = hostPatternForUrl(url);
  if (!pattern) return false;
  await registerPattern(pattern, enabled);
  await injectIntoOpenTabs(pattern, enabled);
  return true;
}

export function installPermissionListeners({ getSettings, onChanged, onAllSitesGranted, onAllSitesRemoved }) {
  const added = onPermissionsAdded((permissions) => {
    for (const origin of permissions.origins ?? []) {
      if (origin === ALL_URLS) {
        if (onAllSitesGranted) Promise.resolve(onAllSitesGranted()).catch(() => {});
        else syncSiteScripts(getSettings().behaviour).catch(() => {});
        continue;
      }
      const settings = getSettings();
      const host = origin.replace(/^\*:\/\//, '').replace(/\/\*$/, '');
      const enabled = settings.behaviour.allSitesEnabled || settings.behaviour.enabledSites.some((site) => domainMatches(host, normalizeDomain(site)));
      registerPattern(origin, enabled).then(() => injectIntoOpenTabs(origin, enabled)).catch(() => {});
      onChanged?.();
    }
  });
  const removed = onPermissionsRemoved((permissions) => {
    for (const origin of permissions.origins ?? []) {
      if (origin === ALL_URLS) Promise.resolve(onAllSitesRemoved?.()).catch(() => {});
      unregisterPattern(origin).catch(() => {});
    }
    onChanged?.();
  });
  return () => { added(); removed(); };
}

