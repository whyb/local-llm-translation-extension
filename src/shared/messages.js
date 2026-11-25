export const UI_TRANSLATIONS_REQUEST = 'ui-translations-request';
export const PERMISSION_REQUIRED = 'permission-required';

export const MESSAGE = Object.freeze({
  PING: 'ping',
  PONG: 'pong',
  TRANSLATE_PAGE: 'translate-page',
  STOP: 'stop',
  REVERT: 'revert',
  GET_PROGRESS: 'get-progress',
  GET_SITE_STATE: 'get-site-state',
  SET_SITE_MODE: 'set-site-mode',
  OPEN_OPTIONS: 'open-options',
  FRAME_HELLO: 'frame-hello',
  UNITS_REPORT: 'units-report',
  RUN_BEGIN: 'run-begin',
  RUN_CANCEL: 'run-cancel',
  RUN_REVERT: 'run-revert',
  RUN_SETTLED: 'run-settled',
  RUN_RESUME: 'run-resume',
  SEGMENT_DELIVERY: 'segment-delivery',
  SEGMENT_APPLIED: 'segment-applied',
  PROGRESS_UPDATE: 'progress-update',
  TOGGLE_RENDER_MODE: 'toggle-render-mode',
  TRANSLATE_SELECTION: 'translate-selection',
  SELECTION_REQUEST: 'selection-translate-request',
  SELECTION_DELIVERY: 'selection-delivery',
  SPA_NAVIGATE: 'spa-navigate',
  PAGE_CONTEXT_CHANGED: 'page-context-changed',
  BFCACHE_RESTORE: 'bfcache-restore',
  RUN_PAUSED: 'run-paused',
  HOVER_INTENT: 'hover-intent',
  NEXT_NAV_INTENT: 'next-nav-intent',
  PAGE_SNAPSHOT_REQUEST: 'page-snapshot-request',
  TM_LOOKUP_REQUEST: 'tm-lookup-request',
  TM_EXPORT_REQUEST: 'tm-export-request',
  TM_IMPORT_REQUEST: 'tm-import-request',
  CACHE_FORGET_REQUEST: 'cache-forget-request',
  CACHE_PURGE_REQUEST: 'cache-purge-request',
  CACHE_STATS_REQUEST: 'cache-stats-request',
  PROBE_PROFILE_REQUEST: 'probe-profile-request',
  CAPABILITIES_REQUEST: 'capabilities-request',
  AUTOTUNE_ESTIMATE_REQUEST: 'autotune-estimate-request',
  REFRESH_MODELS_REQUEST: 'refresh-models-request',
  TEST_CONNECTION_REQUEST: 'test-connection-request',
  TRANSLATION_PROMPT_TEST_REQUEST: 'translation-prompt-test-request',
  PREFETCH_METRICS_REQUEST: 'prefetch-metrics-request',
  DIAGNOSTICS_REQUEST: 'diagnostics-request',
  CLIENT_ERROR: 'client-error',
  ERROR_LOG_REQUEST: 'error-log-request',
  ERROR_LOG_CLEAR_REQUEST: 'error-log-clear-request',
  EXCLUSIONS_PREVIEW_REQUEST: 'exclusions-preview-request',
  HARD_RESET_REQUEST: 'hard-reset-request',
  SET_AUTO_TRANSLATE_DYNAMIC: 'set-auto-translate-dynamic',
  SET_TRANSLATION_PREFERENCES: 'set-translation-preferences',
  SAVE_SETTINGS: 'save-settings',
  LOAD_SETTINGS: 'load-settings',
  UI_TRANSLATIONS_REQUEST,
  PERMISSION_REQUIRED
});

export const MAX_PAGE_UNITS = 100000;
export const MAX_UI_TRANSLATION_KEYS = 2000;
export const MAX_UI_TRANSLATION_KEY_LENGTH = 500;
export const MAX_UI_TRANSLATION_TOTAL_KEY_LENGTH = 200000;
export const MAX_UI_LOCALE_LENGTH = 64;

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isMessage(value) {
  return isObject(value) && typeof value.type === 'string';
}

export function isProfileShape(profile) {
  return isObject(profile)
    && typeof profile.id === 'string'
    && typeof profile.baseUrl === 'string'
    && typeof profile.adapter === 'string';
}

function hasValidTabId(message) {
  return message.tabId === undefined || Number.isInteger(message.tabId);
}

export function validateContentMessage(message) {
  if (!isMessage(message)) return false;
  switch (message.type) {
    case MESSAGE.PING:
      return (message.url === undefined || typeof message.url === 'string')
        && (message.documentKey === undefined || typeof message.documentKey === 'string');
    case MESSAGE.TRANSLATE_PAGE:
    case MESSAGE.STOP:
    case MESSAGE.REVERT:
    case MESSAGE.GET_PROGRESS:
      return typeof message.url === 'string' && hasValidTabId(message);
    case MESSAGE.GET_SITE_STATE:
      return typeof message.url === 'string';
    case MESSAGE.SET_SITE_MODE:
      return typeof message.url === 'string'
        && (message.mode === null || ['auto', 'ask', 'never'].includes(message.mode));
    case MESSAGE.OPEN_OPTIONS:
      return true;
    case MESSAGE.FRAME_HELLO:
      return message.url === undefined || typeof message.url === 'string';
    case MESSAGE.UNITS_REPORT:
      return typeof message.url === 'string'
        && typeof message.runId === 'string'
        && Array.isArray(message.units)
        && message.units.length <= MAX_PAGE_UNITS
        && (message.snapshot === undefined || typeof message.snapshot === 'boolean')
        && (message.documentKey === undefined || typeof message.documentKey === 'string')
        && (message.inventoryRevision === undefined || (Number.isInteger(message.inventoryRevision) && message.inventoryRevision >= 0))
        && (message.chunkIndex === undefined || (Number.isInteger(message.chunkIndex) && message.chunkIndex >= 0))
        && (message.chunkCount === undefined || (Number.isInteger(message.chunkCount) && message.chunkCount >= 1))
        && (message.snapshotId === undefined || typeof message.snapshotId === 'string');
    case MESSAGE.SEGMENT_APPLIED:
      return typeof message.url === 'string'
        && typeof message.runId === 'string'
        && (message.documentKey === undefined || typeof message.documentKey === 'string')
        && Array.isArray(message.unitIds)
        && message.unitIds.length <= MAX_PAGE_UNITS
        && message.unitIds.every((unitId) => typeof unitId === 'string');
    case MESSAGE.SELECTION_REQUEST:
      return typeof message.url === 'string'
        && typeof message.requestId === 'string'
        && typeof message.text === 'string'
        && message.text.length <= 50000;
    case MESSAGE.SPA_NAVIGATE:
      return typeof message.url === 'string'
        && typeof message.key === 'string'
        && (message.previousKey === null || typeof message.previousKey === 'string');
    case MESSAGE.PAGE_CONTEXT_CHANGED:
      return typeof message.url === 'string'
        && typeof message.documentKey === 'string'
        && ['navigation', 'pagehide', 'spa-navigate'].includes(message.reason)
        && (message.runId === null || message.runId === undefined || typeof message.runId === 'string');
    case MESSAGE.BFCACHE_RESTORE:
      return typeof message.url === 'string' && typeof message.translated === 'boolean';
    case MESSAGE.RUN_PAUSED:
      return typeof message.url === 'string'
        && typeof message.runId === 'string'
        && ['page-unit-ceiling', 'token-ceiling', 'mutation-storm'].includes(message.reason);
    case MESSAGE.HOVER_INTENT:
      return typeof message.href === 'string'
        && typeof message.sourceUrl === 'string'
        && (message.rel === null || typeof message.rel === 'string')
        && typeof message.download === 'boolean';
    case MESSAGE.NEXT_NAV_INTENT:
      return typeof message.sourceUrl === 'string' && Array.isArray(message.picks) && message.picks.length <= 20;
    case MESSAGE.PAGE_SNAPSHOT_REQUEST:
    case MESSAGE.TM_LOOKUP_REQUEST:
      return typeof message.url === 'string'
        && (message.type === MESSAGE.PAGE_SNAPSHOT_REQUEST || Array.isArray(message.queries));
    case MESSAGE.TM_EXPORT_REQUEST:
      return message.format === 'json' || message.format === 'jsonl';
    case MESSAGE.TM_IMPORT_REQUEST:
      return typeof message.raw === 'string' && message.raw.length <= 50 * 1024 * 1024;
    case MESSAGE.CACHE_FORGET_REQUEST:
      return typeof message.domain === 'string';
    case MESSAGE.CACHE_PURGE_REQUEST:
    case MESSAGE.CACHE_STATS_REQUEST:
    case MESSAGE.AUTOTUNE_ESTIMATE_REQUEST:
    case MESSAGE.PREFETCH_METRICS_REQUEST:
    case MESSAGE.DIAGNOSTICS_REQUEST:
    case MESSAGE.HARD_RESET_REQUEST:
      return true;
    case MESSAGE.CLIENT_ERROR:
      return typeof message.source === 'string'
        && message.source.length <= 80
        && typeof message.message === 'string'
        && message.message.length <= 4000
        && (message.level === undefined || ['debug', 'info', 'warn', 'error'].includes(message.level))
        && (message.stack === undefined || (typeof message.stack === 'string' && message.stack.length <= 12000))
        && (message.url === undefined || typeof message.url === 'string')
        && (message.runId === undefined || message.runId === null || typeof message.runId === 'string')
        && (message.documentKey === undefined || typeof message.documentKey === 'string')
        && (message.userAgent === undefined || typeof message.userAgent === 'string')
        && (message.details === undefined || typeof message.details === 'object');
    case MESSAGE.ERROR_LOG_REQUEST:
    case MESSAGE.ERROR_LOG_CLEAR_REQUEST:
      return true;
    case MESSAGE.PROBE_PROFILE_REQUEST:
    case MESSAGE.REFRESH_MODELS_REQUEST:
    case MESSAGE.TEST_CONNECTION_REQUEST:
      return isProfileShape(message.profile);
    case MESSAGE.TRANSLATION_PROMPT_TEST_REQUEST:
      return isObject(message.settings)
        && (message.mode === 'batch' || message.mode === 'single')
        && Array.isArray(message.texts)
        && message.texts.length > 0
        && message.texts.length <= 64
        && message.texts.every((value) => typeof value === 'string' && value.length <= 50000)
        && message.texts.reduce((total, value) => total + value.length, 0) <= 200000
        && (message.batchSize === undefined || (Number.isInteger(message.batchSize) && message.batchSize >= 1 && message.batchSize <= 32))
        && (message.sourceLang === undefined || message.sourceLang === null || typeof message.sourceLang === 'string');
    case MESSAGE.CAPABILITIES_REQUEST:
      return Array.isArray(message.profileIds) && message.profileIds.every((value) => typeof value === 'string');
    case MESSAGE.EXCLUSIONS_PREVIEW_REQUEST:
      return typeof message.url === 'string' && Array.isArray(message.rules);
    case MESSAGE.SET_AUTO_TRANSLATE_DYNAMIC:
      return typeof message.value === 'boolean';
    case MESSAGE.SET_TRANSLATION_PREFERENCES:
      return isObject(message.preferences)
        && (message.preferences.targetLang === undefined
          || (typeof message.preferences.targetLang === 'string' && message.preferences.targetLang.length <= 200))
        && (message.preferences.renderMode === undefined
          || ['replace', 'bilingual-stacked', 'replace-hover-reveal'].includes(message.preferences.renderMode));
    case MESSAGE.SAVE_SETTINGS:
      return isObject(message.settings);
    case MESSAGE.LOAD_SETTINGS:
      return true;
    case MESSAGE.UI_TRANSLATIONS_REQUEST: {
      const validLocale = message.locale === null
        || (typeof message.locale === 'string' && message.locale.length <= MAX_UI_LOCALE_LENGTH);
      return validLocale
        && Array.isArray(message.keys)
        && message.keys.length <= MAX_UI_TRANSLATION_KEYS
        && message.keys.every((key) => typeof key === 'string' && key.length <= MAX_UI_TRANSLATION_KEY_LENGTH)
        && message.keys.reduce((total, key) => total + key.length, 0) <= MAX_UI_TRANSLATION_TOTAL_KEY_LENGTH;
    }
    default:
      return false;
  }
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function requestId(prefix = 'req') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function runId() {
  return requestId('run');
}

export function responseOk(type, payload = {}) {
  return { type, ok: true, ...payload };
}

export function responseError(type, error) {
  return { type, ok: false, error: errorMessage(error) };
}
