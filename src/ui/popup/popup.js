import { getManifest, onPermissionsAdded, onPermissionsRemoved, openOptionsPage, queryTabs, reportClientError, sendRuntimeMessage } from '../../shared/browser.js';
import { applyI18n, localizeDocument, setUiLocale, t } from '../../shared/i18n.js';
import { loadSettings, normalizeSettings, resolveSitePolicy } from '../../shared/settings.js';
import { isSupportedPageUrl, siteStateFromSettings } from '../../shared/urls.js';
import { ALL_URLS, hasAllSitesPermission, requestAllSitesPermission } from '../../background/site-permissions.js';

const $ = (selector) => document.querySelector(selector);
const STATUS_TIMEOUT_MS = 3500;
let settings = normalizeSettings(null);

function applyDocumentLocale() {
  setUiLocale(settings.appearance?.uiLocale ?? null);
  localizeDocument(document);
  applyI18n(document);
  document.title = t('Local LLM Translator Pro');
}

applyDocumentLocale();

const ui = {
  title: $('#page-title'), url: $('#page-url'), dot: $('#state-dot'), label: $('#state-label'), detail: $('#state-detail'),
  progress: $('#progress-bar'), done: $('#done'), total: $('#total'), hitRate: $('#hit-rate'),
  permissionCard: $('#permission-card'), permissionCopy: $('#permission-copy'), enable: $('#enable-site'), actions: $('#actions'),
  translate: $('#translate'), stop: $('#stop'), revert: $('#revert'), settings: $('#settings'),
  modeControl: $('#mode-control'), modeHint: $('#mode-hint'), allSites: $('#all-sites'), openSiteSettings: $('#open-site-settings'),
  provider: $('#provider'), providerNote: $('#provider-note'), error: $('#error'), version: $('#version')
};

let tab = null;
let permissionGranted = false;
let permitted = false;
let siteState = null;
let pollTimer = null;
let busy = false;
let refreshPromise = null;

function withTimeout(promise, timeoutMs = STATUS_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Status request timed out.')), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function sendStatusMessage(message, fallback) {
  try {
    return await withTimeout(sendRuntimeMessage(message));
  } catch {
    return fallback;
  }
}

function isPermissionError(value) {
  if (!value) return false;
  if (value.permissionRequired === true || value.code === 'permission-required') return true;
  const text = typeof value === 'string' ? value : String(value.error ?? value.message ?? '');
  return /website access is required|allow all sites|site access required/i.test(text);
}

function showError(value) {
  ui.error.hidden = !value;
  ui.error.textContent = value || '';
}

function setState(status, detail = '') {
  ui.dot.className = `dot ${status}`;
  const statusLabel = status === 'checking'
    ? t('Checking…')
    : status === 'translating'
      ? t('Translating')
      : status === 'complete'
        ? t('Translated')
        : status === 'error'
          ? t('Needs attention')
          : t('Ready');
  ui.label.textContent = statusLabel;
  ui.detail.textContent = detail;
}

function updateProgress(progress) {
  const done = Number(progress?.done) || 0;
  const total = Number(progress?.total) || 0;
  ui.done.textContent = String(done);
  ui.total.textContent = String(total);
  ui.hitRate.textContent = Number.isFinite(progress?.cacheHitRate) ? `${Math.round(progress.cacheHitRate * 100)}%` : '—';
  ui.progress.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
  ui.translate.disabled = busy || progress?.state === 'translating';
  ui.stop.disabled = busy || progress?.state !== 'translating';
  ui.revert.disabled = busy;
  if (progress?.state === 'error') setState('error', progress.notice?.message || t('Translation failed.'));
  else if (progress?.state === 'translating') setState('translating', t('{done} / {total} segments', { done, total }));
  else if (total > 0 && done >= total) setState('complete', t('Cached and page translations are up to date.'));
  else setState('idle', t('Nothing is running.'));
}

function renderProvider() {
  const primary = settings.providers.profiles.find((profile) => profile.role === 'primary') ?? settings.providers.profiles[0];
  ui.provider.textContent = primary ? `${primary.name} · ${primary.adapter}` : t('No provider');
  ui.providerNote.textContent = primary
    ? (primary.model || primary.baseUrl || t('Configure a model'))
    : t('Add a primary provider in Settings');
}

function renderPermission() {
  ui.permissionCard.hidden = !ui.tabSupported || permissionGranted;
  ui.actions.hidden = !ui.tabSupported || !permissionGranted;
  ui.enable.disabled = busy || !ui.tabSupported;
  ui.permissionCopy.textContent = t('Allow access to all websites once. Nothing is read or changed until you allow it.');
  ui.modeControl.querySelectorAll('button').forEach((button) => {
    button.disabled = busy || !ui.tabSupported || !permissionGranted;
  });
}

function renderMode() {
  const mode = siteState?.selected ?? resolveSitePolicy(settings, new URL(tab.url).hostname);
  ui.modeControl.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  ui.modeHint.textContent = mode === 'auto'
    ? (settings.behaviour.allSitesEnabled
      ? t('Every allowed page translates automatically. You can still stop or revert it.')
      : t('Automatic applies only to sites you enable one by one.'))
    : mode === 'never'
      ? t('This site is blocked. Nothing will be read or sent.')
      : t('Manual mode never sends text until you press Translate.');
  ui.allSites.hidden = !permissionGranted || !settings.behaviour.allSitesEnabled;
}

async function currentTab() {
  for (const query of [{ active: true, lastFocusedWindow: true }, { active: true, currentWindow: true }]) {
    try {
      const [tab] = await queryTabs(query);
      if (tab) return tab;
    } catch { /* Try the next query shape. */ }
  }
  return null;
}

async function refreshInternal() {
  setState('checking');
  showError('');
  try {
    tab = await withTimeout(currentTab());
  } catch {
    tab = null;
  }
  ui.tabSupported = Boolean(tab?.url && isSupportedPageUrl(tab.url));
  ui.title.textContent = tab?.title || t('No active page');
  ui.url.textContent = tab?.url || '—';
  ui.version.textContent = `v${getManifest().version}`;
  if (!ui.tabSupported) {
    permissionGranted = false;
    permitted = false;
    siteState = null;
    renderPermission();
    updateProgress({ state: 'idle', done: 0, total: 0 });
    setState('idle', tab ? t('Unsupported browser page.') : t('No active page'));
    return;
  }

  const settingsPromise = withTimeout(loadSettings()).catch(() => normalizeSettings(null));
  try {
    permissionGranted = Boolean(await withTimeout(hasAllSitesPermission()));
  } catch {
    permissionGranted = false;
  }
  settings = await settingsPromise;
  applyDocumentLocale();
  renderProvider();
  if (!permissionGranted) {
    permitted = false;
    siteState = null;
    renderPermission();
    updateProgress({ state: 'idle', done: 0, total: 0 });
    setState('error', t('Site access required'));
    renderMode();
    return;
  }

  const stateMessage = await sendStatusMessage({ type: 'get-site-state', url: tab.url }, null);
  siteState = stateMessage?.ok ? stateMessage : siteStateFromSettings(settings, tab.url, permissionGranted);
  permitted = permissionGranted && Boolean(siteState?.enabled);
  renderPermission();
  renderMode();
  const progress = await sendStatusMessage({ type: 'get-progress', url: tab.url, tabId: tab.id }, null);
  updateProgress(progress ?? { state: 'idle', done: 0, total: 0 });
}

function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshInternal().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function enableSite() {
  if (!tab?.url || busy) return false;
  busy = true;
  showError('');
  ui.enable.textContent = t('Requesting…');
  try {
    if (!permissionGranted) {
      const granted = await requestAllSitesPermission();
      if (!granted) {
        permissionGranted = false;
        permitted = false;
        renderPermission();
        setState('error', t('Site access required'));
        showError(t('Site permission was not granted.'));
        return false;
      }
      permissionGranted = true;
    }
    settings = await loadSettings();
    applyDocumentLocale();
    settings.behaviour.allSitesEnabled = true;
    const saved = await sendRuntimeMessage({ type: 'save-settings', settings });
    if (!saved?.ok) throw new Error(saved?.error || t('Save failed: {error}', { error: t('unknown') }));
    const selected = siteState?.selected ?? settings.behaviour.autoTranslateDefault;
    const mode = selected === 'never' ? 'never' : selected;
    const response = await sendRuntimeMessage({ type: 'set-site-mode', url: tab.url, mode });
    if (!response?.ok) throw new Error(response?.error || t('Could not enable this site.'));
    permitted = true;
    siteState = response;
    settings = await loadSettings();
    ui.enable.textContent = t('Enabled');
    await refresh();
    return true;
  } catch (error) {
    if (!permissionGranted) {
      permitted = false;
      renderPermission();
      setState('error', t('Site access required'));
    }
    showError(error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    busy = false;
    ui.enable.textContent = t('Allow all sites');
    renderPermission();
  }
}

async function setMode(mode) {
  if (!tab?.url || busy) return;
  try {
    permissionGranted = Boolean(await withTimeout(hasAllSitesPermission()));
  } catch {
    permissionGranted = false;
  }
  if (!permissionGranted) {
    permitted = false;
    siteState = null;
    renderPermission();
    setState('error', t('Site access required'));
    return;
  }
  if (!permitted) {
    const enabled = await enableSite();
    if (!enabled) return;
  }
  busy = true;
  try {
    const response = await sendRuntimeMessage({ type: 'set-site-mode', url: tab.url, mode });
    if (!response?.ok) {
      if (isPermissionError(response)) {
        permissionGranted = false;
        permitted = false;
        renderPermission();
        setState('error', t('Site access required'));
      }
      throw new Error(response?.error || t('Could not update site mode.'));
    }
    siteState = response;
    settings = await loadSettings();
    applyDocumentLocale();
    renderMode();
    renderPermission();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    busy = false;
    renderPermission();
  }
}

async function translate() {
  if (!tab?.url || busy) return;
  try {
    permissionGranted = Boolean(await withTimeout(hasAllSitesPermission()));
  } catch {
    permissionGranted = false;
  }
  if (!permissionGranted) {
    permitted = false;
    siteState = null;
    renderPermission();
    setState('error', t('Site access required'));
    return;
  }
  if (!permitted) {
    const enabled = await enableSite();
    if (!enabled) return;
  }
  busy = true;
  showError('');
  try {
    const response = await sendRuntimeMessage({ type: 'translate-page', url: tab.url, tabId: tab.id });
    if (response?.error) {
      if (isPermissionError(response)) {
        permissionGranted = false;
        permitted = false;
        renderPermission();
        setState('error', t('Site access required'));
      }
      throw new Error(response.error);
    }
    setState('translating', t('Starting…'));
    await refresh();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    busy = false;
    renderPermission();
  }
}

async function stop() {
  if (!tab?.url) return;
  try { await sendRuntimeMessage({ type: 'stop', url: tab.url, tabId: tab.id }); await refresh(); } catch (error) { showError(error instanceof Error ? error.message : String(error)); }
}

async function revert() {
  if (!tab?.url) return;
  try { await sendRuntimeMessage({ type: 'revert', url: tab.url, tabId: tab.id }); await refresh(); } catch (error) { showError(error instanceof Error ? error.message : String(error)); }
}

ui.enable.addEventListener('click', enableSite);
ui.translate.addEventListener('click', translate);
ui.stop.addEventListener('click', stop);
ui.revert.addEventListener('click', revert);
ui.settings.addEventListener('click', () => openOptionsPage());
ui.openSiteSettings.addEventListener('click', () => openOptionsPage('sites'));
ui.modeControl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (button) setMode(button.dataset.mode);
});

refresh().catch((error) => {
  reportClientError('popup', error, { phase: 'refresh' });
  permissionGranted = false;
  permitted = false;
  siteState = null;
  renderPermission();
  updateProgress({ state: 'idle', done: 0, total: 0 });
  setState('error', t('Site access required'));
  showError(error instanceof Error ? error.message : String(error));
});
pollTimer = setInterval(() => {
  if (!tab?.url || busy || !permissionGranted) return;
  sendStatusMessage({ type: 'get-progress', url: tab.url, tabId: tab.id }, null).then((progress) => {
    if (progress) updateProgress(progress);
  });
}, 750);
window.addEventListener('focus', () => {
  if (busy || document.visibilityState === 'hidden') return;
  refresh().catch(() => {});
});
window.addEventListener('pagehide', () => clearInterval(pollTimer), { once: true });
window.addEventListener('error', (event) => {
  reportClientError('popup', event.error || event.message, { phase: 'window-error', filename: event.filename, lineno: event.lineno, colno: event.colno });
});
window.addEventListener('unhandledrejection', (event) => {
  reportClientError('popup', event.reason, { phase: 'unhandled-rejection' });
});
