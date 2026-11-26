import {
  action, extension, getAllPermissions, getTab, getUILanguage, onCommand, onRuntimeMessage, onStorageChanged,
  onTabActivated, onTabRemoved, onTabUpdated, openOptionsPage, queryTabs,
  runtime, sendTabMessage, storageClear, storageGet, storageSet
} from '../shared/browser.js';
import { translateForLocale } from '../shared/i18n.js';
import { getLanguageOptions } from '../shared/languages.js';
import {
  ALL_URLS, domainMatches, loadSettings, normalizeSettings, resolveSiteTargetLang,
  saveSettings, sanitizeSettingsForContent, SETTINGS_KEY
} from '../shared/settings.js';
import { errorMessage, MESSAGE, runId as createRunId, validateContentMessage } from '../shared/messages.js';
import { domainFromUrl, hostPatternForUrl, normalizeUrl, siteStateFromSettings as buildSiteState } from '../shared/urls.js';
import { glossaryHash, makeTmKey, normalizeForLookup, stableHash } from '../shared/text.js';
import { cacheStore, parseTm, recordSize, serializeTm } from './cache.js';
import { primaryProfile, createAdapter, probeProfile, testConnection } from './providers/index.js';
import { promptVersionForSettings, testTranslationPrompt, TranslationService } from './translator.js';
import {
  ERROR_LOG_KEY, errorFingerprint, normalizeErrorLevel, normalizeErrorRecord, pruneErrorLog,
  sanitizeErrorText, sanitizeErrorUrl, shouldRecordError
} from '../shared/error-log.js';
import { PrefetchService } from './prefetch.js';
import {
  activateSite, hasAllSitesPermission, hasSitePermission, injectIntoOpenTabs,
  installPermissionListeners, listGrantedOrigins, registerPattern, requestAllSitesPermission,
  requestSitePermission, scriptsForPattern, syncSiteScripts, unregisterPattern
} from './site-permissions.js';

const state = {
  settings: normalizeSettings(null),
  translator: null,
  prefetch: null,
  runs: new Map(),
  framesByTab: new Map(),
  autoStarted: new Set(),
  permissionCleanup: null,
  errorLogQueue: Promise.resolve()
};

const SEGMENT_DELIVERY_BATCH_SIZE = 80;
const SEGMENT_DELIVERY_FLUSH_MS = 16;
const PROGRESS_THROTTLE_MS = 100;

function runMapKey(tabId, url) {
  return `${tabId}:${normalizeUrl(url, state.settings.cache.urlNormalisation)}`;
}

function getRun(tabId, url, runId = null) {
  if (runId) {
    for (const run of state.runs.values()) {
      if (run.runId === runId && (tabId === undefined || run.tabId === tabId)) return run;
    }
  }
  return state.runs.get(runMapKey(tabId, url)) ?? null;
}

function tabRuns(tabId) {
  return [...state.runs.entries()].filter(([, run]) => run.tabId === tabId);
}

function activeRunForTab(tabId) {
  const entries = tabRuns(tabId).sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0));
  return entries[0]?.[1] ?? null;
}

function frameKey(tabId, frameId) {
  return `${tabId}:${frameId}`;
}

function framesForTab(tabId) {
  return [...(state.framesByTab.get(tabId) ?? [])];
}

function contentDocumentKey(sender, message) {
  return String(message?.documentKey ?? sender?.documentId ?? '');
}

async function endpointPermissionRequired(profile) {
  const baseUrl = typeof profile?.baseUrl === 'string' ? profile.baseUrl : '';
  if (!baseUrl || !hostPatternForUrl(baseUrl)) return false;
  return !await hasSitePermission(baseUrl);
}

function permissionRequiredResult(url) {
  return {
    ok: false,
    code: 'permission-required',
    permissionRequired: true,
    error: 'Website access is required. Allow all sites from the popup or options page, then try again.',
    url
  };
}

async function broadcastPermissionRequired(reason = 'all-sites-removed') {
  let tabs = [];
  try { tabs = await queryTabs({}); } catch { return; }
  await Promise.allSettled(tabs
    .filter((tab) => Number.isInteger(tab.id))
    .map((tab) => sendTabMessage(tab.id, {
      type: MESSAGE.PERMISSION_REQUIRED,
      reason,
      permissionRequired: true,
      allSites: true,
      url: tab.url || ''
    })));
}

function uiTranslationsResponse(message) {
  const locale = message.locale ?? getUILanguage();
  const keys = Array.isArray(message.keys) ? message.keys : [];
  const translations = Object.fromEntries(keys.map((key) => [key, translateForLocale(locale, key)]));
  const optionLocale = typeof locale === 'string' && locale.trim() && locale.trim().toLowerCase() !== 'auto'
    ? locale.trim()
    : getUILanguage();
  const languageOptions = getLanguageOptions(optionLocale).map(({ value, name, nativeName, territory, searchText }) => ({
    value, name, nativeName, territory, searchText
  }));
  return { ok: true, locale, translations, languageOptions };
}

function clearAutoStartedForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const key of state.autoStarted) if (key.startsWith(prefix)) state.autoStarted.delete(key);
}

function sameRunUrl(left, right) {
  try {
    return normalizeUrl(left, state.settings.cache.urlNormalisation) === normalizeUrl(right, state.settings.cache.urlNormalisation);
  } catch {
    return left === right;
  }
}

async function invalidateTabRuns(tabId, reason = 'navigation') {
  if (!Number.isInteger(tabId)) return 0;
  clearAutoStartedForTab(tabId);
  const entries = tabRuns(tabId);
  for (const [, run] of entries) {
    clearRunTimers(run);
    try { run.controller.abort(new DOMException(reason, 'AbortError')); } catch { /* noop */ }
    run.state = 'idle';
    await broadcastRun(run, { type: MESSAGE.RUN_CANCEL, runId: run.runId, url: run.url, reason }).catch(() => {});
  }
  for (const [key, run] of entries) {
    if (state.runs.get(key) === run) state.runs.delete(key);
  }
  if (!tabRuns(tabId).length) state.framesByTab.delete(tabId);
  return entries.length;
}

function rememberFrame(sender, message) {
  const tabId = sender?.tab?.id;
  if (tabId === undefined) return;
  const frameId = sender.frameId ?? 0;
  const set = state.framesByTab.get(tabId) ?? new Map();
  set.set(frameKey(tabId, frameId), {
    frameId,
    url: sender.url ?? message?.url ?? '',
    documentKey: contentDocumentKey(sender, message),
    lastSeen: Date.now()
  });
  state.framesByTab.set(tabId, set);
}

function sendToFrame(tabId, frameId, message) {
  const options = Number.isInteger(frameId) ? { frameId } : undefined;
  try {
    // Content notifications are fire-and-forget. Some frames do not call
    // sendResponse, and waiting on those messages can stall the whole run.
    Promise.resolve(sendTabMessage(tabId, message, options)).catch(() => undefined);
  } catch { /* Tab or frame may already be gone. */ }
  return Promise.resolve();
}

function flushSegmentOutbox(run, frameState) {
  if (!run || !frameState || run.controller.signal.aborted) return;
  if (frameState.outboxTimer) clearTimeout(frameState.outboxTimer);
  frameState.outboxTimer = null;
  if (!frameState.outbox.size) return;
  const segments = [];
  for (const [unitId, segment] of frameState.outbox) {
    segments.push(segment);
    frameState.outbox.delete(unitId);
    if (segments.length >= SEGMENT_DELIVERY_BATCH_SIZE) break;
  }
  sendToFrame(run.tabId, frameState.frameId, {
    type: MESSAGE.SEGMENT_DELIVERY,
    runId: run.runId,
    documentKey: frameState.documentKey,
    segments
  });
  if (frameState.outbox.size && !frameState.outboxTimer) {
    frameState.outboxTimer = setTimeout(() => flushSegmentOutbox(run, frameState), 0);
  }
}

function queueSegmentDelivery(run, frameState, payload) {
  if (!run || !frameState || run.controller.signal.aborted) return;
  frameState.outbox.set(payload.unitId, payload);
  if (frameState.outboxTimer) return;
  frameState.outboxTimer = setTimeout(() => flushSegmentOutbox(run, frameState), SEGMENT_DELIVERY_FLUSH_MS);
}

async function broadcastRun(run, message) {
  const frames = framesForTab(run.tabId);
  if (!frames.length) {
    await sendToFrame(run.tabId, undefined, message);
    return;
  }
  await Promise.all(frames.map((frame) => sendToFrame(run.tabId, frame.frameId, message)));
}

function clearFrameDelivery(frameState) {
  if (!frameState) return;
  if (frameState.outboxTimer) clearTimeout(frameState.outboxTimer);
  frameState.outboxTimer = null;
  frameState.outbox?.clear();
}

function clearRunTimers(run) {
  if (!run) return;
  clearRunSettlement(run);
  if (run.progressTimer) clearTimeout(run.progressTimer);
  run.progressTimer = null;
  for (const timer of run.primeTimers ?? []) clearTimeout(timer);
  run.primeTimers = [];
  for (const frameState of run.frames?.values?.() ?? []) clearFrameDelivery(frameState);
}

function clearRunSettlement(run) {
  if (!run?.settleTimer) return;
  clearTimeout(run.settleTimer);
  run.settleTimer = null;
}

function runQueuesDrained(run) {
  for (const frame of run.frames.values()) {
    if (frame.processing || frame.pending.size || frame.outbox?.size) return false;
  }
  return true;
}

function runFullyApplied(run) {
  for (const frame of run.frames.values()) {
    for (const unitId of frame.current.keys()) {
      if (frame.doneIds.has(unitId) && !frame.acknowledged.has(unitId)) return false;
    }
  }
  return true;
}

function scheduleRunSettlement(run) {
  if (!run || run.state !== 'translating') return;
  clearRunSettlement(run);
  run.settleTimer = setTimeout(() => {
    run.settleTimer = null;
    if (run.state !== 'translating') return;
    if (!runQueuesDrained(run)) {
      scheduleRunSettlement(run);
      return;
    }
    if (!runFullyApplied(run)) {
      if (Date.now() - Number(run.lastAckAt || 0) > 1500) {
        for (const frameState of run.frames.values()) replayUnacknowledgedSegments(run, frameState);
      }
      scheduleRunSettlement(run);
      return;
    }
    run.state = 'complete';
    run.updatedAt = Date.now();
    sendProgress(run);
    broadcastRun(run, {
      type: MESSAGE.RUN_SETTLED,
      runId: run.runId,
      url: run.url,
      autoTranslateDynamic: Boolean(state.settings.translation.autoTranslateDynamic)
    }).catch(() => {});
  }, 2500);
}

function progressSummary(run) {
  if (!run) return { state: 'idle', done: 0, translated: 0, total: 0, url: '', runId: null, notice: null };
  return {
    state: run.state,
    done: run.done,
    translated: run.translated ?? run.done,
    total: run.total,
    pending: Math.max(0, run.total - (run.translated ?? run.done)),
    url: run.url,
    runId: run.runId,
    origin: run.origin ?? (run.auto ? 'automatic' : 'manual'),
    autoTranslateDynamic: Boolean(state.settings.translation.autoTranslateDynamic),
    notice: run.notice ?? null,
    cacheHitRate: run.total ? run.cacheHits / run.total : null,
    tokensPerSecond: null
  };
}

function sendProgress(run) {
  if (run.progressTimer) clearTimeout(run.progressTimer);
  run.progressTimer = null;
  run.lastProgressAt = Date.now();
  const summary = progressSummary(run);
  broadcastRun(run, { type: MESSAGE.PROGRESS_UPDATE, ...summary }).catch(() => {});
}

function sendProgressSoon(run) {
  if (!run || run.progressTimer) return;
  const elapsed = Date.now() - Number(run.lastProgressAt || 0);
  const delay = Math.max(0, PROGRESS_THROTTLE_MS - elapsed);
  run.progressTimer = setTimeout(() => {
    run.progressTimer = null;
    if (run.state === 'idle') return;
    run.lastProgressAt = Date.now();
    sendProgress(run);
  }, delay);
}

function isEnabledForUrl(url) {
  const domain = domainFromUrl(url);
  if (!domain) return false;
  return state.settings.behaviour.allSitesEnabled
    || state.settings.behaviour.enabledSites.some((site) => domainMatches(domain, site));
}

async function maybeAutoStart(tabId, url, { documentKey = '' } = {}) {
  if (!url || !isEnabledForUrl(url)) return;
  const existing = activeRunForTab(tabId);
  if (existing) {
    if (documentKey && existing.documentKey && existing.documentKey !== documentKey) {
      await invalidateTabRuns(tabId, 'stale-document');
    } else {
      return;
    }
  }
  const stateInfo = buildSiteState(state.settings, url, await hasSitePermission(url));
  if (!stateInfo.autoTranslateAllowed) return;
  const afterPermission = activeRunForTab(tabId);
  if (afterPermission) return;
  const key = runMapKey(tabId, url);
  if (state.autoStarted.has(key) || state.runs.has(key)) return;
  state.autoStarted.add(key);
  await startRun(tabId, url, { profileRole: 'primary', auto: true, documentKey });
}

async function startRun(tabId, url, { profileRole = 'primary', auto = false, documentKey = '' } = {}) {
  const profile = primaryProfile(state.settings, profileRole);
  if (await endpointPermissionRequired(profile)) return permissionRequiredResult(url);
  const key = runMapKey(tabId, url);
  const existing = state.runs.get(key);
  if (existing && !['idle', 'complete', 'error', 'paused'].includes(existing.state)) return progressSummary(existing);
  if (tabRuns(tabId).length) await invalidateTabRuns(tabId, 'run-replaced');
  const run = {
    runId: createRunId(),
    tabId,
    url,
    documentKey: documentKey || '',
    profileRole,
    auto,
    origin: auto ? 'automatic' : 'manual',
    state: 'translating',
    done: 0,
    translated: 0,
    total: 0,
    pending: 0,
    cacheHits: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    frames: new Map(),
    controller: new AbortController(),
    settleTimer: null,
    progressTimer: null,
    lastProgressAt: 0,
    lastAckAt: Date.now(),
    notice: null
  };
  state.runs.set(key, run);
  await broadcastRun(run, { type: MESSAGE.RUN_BEGIN, url, runId: run.runId, profileRole, documentKey: run.documentKey });
  scheduleRunPriming(run);
  sendProgress(run);
  return progressSummary(run);
}

function scheduleRunPriming(run) {
  run.primeTimers = [250, 1000].map((delay) => setTimeout(() => {
    if (!run || run.state !== 'translating' || run.controller.signal.aborted) return;
    broadcastRun(run, {
      type: MESSAGE.RUN_RESUME,
      url: run.url,
      runId: run.runId,
      documentKey: run.documentKey,
      profileRole: run.profileRole
    }).catch(() => {});
  }, delay));
}

async function stopRun(tabId, url, reason = 'stop', runId = null) {
  const run = getRun(tabId, url, runId);
  if (!run) return { ok: true, state: 'idle' };
  clearRunTimers(run);
  try { run.controller.abort(new DOMException(reason, 'AbortError')); } catch { /* noop */ }
  run.state = 'idle';
  await broadcastRun(run, { type: MESSAGE.RUN_CANCEL, runId: run.runId, url: run.url, reason }).catch(() => {});
  const key = runMapKey(tabId, run.url);
  if (state.runs.get(key) === run) state.runs.delete(key);
  if (!tabRuns(tabId).length) {
    state.framesByTab.delete(tabId);
    state.autoStarted.delete(key);
  }
  return { ok: true, state: 'idle' };
}

async function revertRun(tabId, url, runId = null) {
  const run = getRun(tabId, url, runId);
  if (run) {
    clearRunTimers(run);
    try { run.controller.abort(new DOMException('revert', 'AbortError')); } catch { /* noop */ }
    await broadcastRun(run, { type: MESSAGE.RUN_REVERT, runId: run.runId, url: run.url });
    const key = runMapKey(tabId, run.url);
    if (state.runs.get(key) === run) state.runs.delete(key);
    if (!tabRuns(tabId).length) {
      state.framesByTab.delete(tabId);
      state.autoStarted.delete(key);
    }
  }
  return { ok: true, state: 'idle' };
}

async function savePageSnapshot(url, units) {
  if (!state.settings.cache.enabled || !units.length) return;
  const normalised = normalizeUrl(url, state.settings.cache.urlNormalisation);
  const hashes = units.map((unit) => stableHash(normalizeForLookup(unit.text, state.settings.cache.normalizeRules)));
  const zones = {};
  for (let index = 0; index < units.length; index += 1) zones[hashes[index]] = units[index].zone;
  await cacheStore.pagePut({
    url: normalised,
    domain: domainFromUrl(normalised),
    hashes: [...new Set(hashes)],
    zoneMap: zones,
    lastSeen: Date.now()
  }).catch(() => {});
}

async function lookupTmForQueries(url, queries) {
  const settings = state.settings;
  const domain = domainFromUrl(url);
  const targetLang = resolveSiteTargetLang(settings, domain);
  const profile = primaryProfile(settings, 'primary');
  if (!profile) return [];
  const glossaryFingerprint = glossaryHash(settings.translation.glossary);
  const keys = queries.map((query) => makeTmKey({
    text: query.text,
    targetLang,
    profileId: profile.id,
    model: profile.model ?? '',
    promptVersion: promptVersionForSettings(settings),
    glossaryFingerprint,
    normalizeRules: settings.cache.normalizeRules
  }));
  const records = await cacheStore.tmGetMany(keys);
  return queries.map((query, index) => {
    const record = records[index];
    if (!record) return { id: query.id, status: 'miss', translation: null };
    const expired = Number.isFinite(settings.cache.ttlMs) && settings.cache.ttlMs >= 0
      && Date.now() - Number(record.lastUsed ?? 0) > settings.cache.ttlMs;
    if (expired) return { id: query.id, status: 'miss', translation: null };
    return { id: query.id, status: 'hit', translation: record.translation };
  });
}

function recalculateRunProgress(run) {
  run.total = 0;
  run.translated = 0;
  run.done = 0;
  for (const frame of run.frames.values()) {
    for (const unitId of frame.current.keys()) {
      run.total += 1;
      if (frame.doneIds.has(unitId)) run.translated += 1;
      if (frame.acknowledged.has(unitId)) run.done += 1;
    }
  }
  run.pending = Math.max(0, run.total - run.translated);
  if (run.translated < run.cacheHits) run.cacheHits = run.translated;
}

function queueFrameUnits(run, frameState, { force = false } = {}) {
  if (!force && !state.settings.translation.autoTranslateDynamic) return 0;
  let queued = 0;
  for (const [unitId, unit] of frameState.current) {
    if (frameState.doneIds.has(unitId) || frameState.pending.has(unitId)) continue;
    frameState.pending.set(unitId, unit);
    queued += 1;
  }
  return queued;
}

function replayUnacknowledgedSegments(run, frameState) {
  const segments = [];
  for (const unitId of frameState.current.keys()) {
    if (!frameState.doneIds.has(unitId) || frameState.acknowledged.has(unitId)) continue;
    const segment = frameState.segments.get(unitId);
    if (segment) segments.push(segment);
  }
  if (!segments.length) return 0;
  for (const segment of segments) queueSegmentDelivery(run, frameState, segment);
  return segments.length;
}

async function processFrameQueue(run, frameState) {
  if (!run || !frameState || frameState.processing) return;
  if (run.state !== 'translating' || run.controller.signal.aborted) return;
  frameState.processing = true;
  try {
    while (frameState.pending.size) {
      if (run.state !== 'translating' || run.controller.signal.aborted) break;
      const batch = [...frameState.pending.values()];
      const batchById = new Map(batch.map((unit) => [unit.id, unit]));
      frameState.pending.clear();
      await state.translator.translateUnits(batch, {
        url: run.url,
        domain: domainFromUrl(run.url),
        targetLang: resolveSiteTargetLang(state.settings, domainFromUrl(run.url)),
        profileRole: run.profileRole,
        signal: run.controller.signal,
        onSegment: (segment) => {
          if (run.state !== 'translating' || run.controller.signal.aborted) return;
          const current = frameState.current.get(segment.unitId);
          const requested = batchById.get(segment.unitId);
          if (!current || !requested || current.text !== requested.text || current.kind !== requested.kind) return;
          if (!frameState.doneIds.has(segment.unitId)) {
            frameState.doneIds.add(segment.unitId);
            run.translated += 1;
            run.pending = Math.max(0, run.total - run.translated);
            if (segment.hit) run.cacheHits += 1;
          }
          const payload = { unitId: segment.unitId, text: segment.text, kind: segment.kind ?? 'text', hit: Boolean(segment.hit), attribute: segment.attribute ?? null };
          frameState.segments.set(segment.unitId, payload);
          queueSegmentDelivery(run, frameState, payload);
          sendProgressSoon(run);
        },
        onProgress: () => { if (run.state === 'translating') sendProgressSoon(run); }
      });
      await savePageSnapshot(run.url, batch);
    }
  } catch (error) {
    if (!run.controller.signal.aborted) {
      clearFrameDelivery(frameState);
      state.translator.logError(error);
      recordBackgroundError(error, { phase: 'translation', tabId: run.tabId, url: run.url, runId: run.runId });
      run.state = 'error';
      run.notice = { severity: 'error', message: errorMessage(error) };
      sendProgress(run);
    }
  } finally {
    frameState.processing = false;
    run.updatedAt = Date.now();
    if (run.state === 'translating') scheduleRunSettlement(run);
  }
}

async function resumeDynamicRun(run) {
  if (!run || run.controller.signal.aborted || ['error', 'paused'].includes(run.state)) return 0;
  let queued = 0;
  for (const frameState of run.frames.values()) queued += queueFrameUnits(run, frameState, { force: true });
  recalculateRunProgress(run);
  if (queued > 0 && run.state !== 'translating') {
    run.state = 'translating';
    run.notice = null;
    sendProgress(run);
    for (const frameState of run.frames.values()) processFrameQueue(run, frameState).catch(() => {});
  } else {
    sendProgress(run);
  }
  return queued;
}

async function updateAutoTranslateDynamic(tabId, value) {
  state.settings = await saveSettings({
    ...state.settings,
    translation: { ...state.settings.translation, autoTranslateDynamic: Boolean(value) }
  });
  const runs = tabRuns(tabId).map(([, run]) => run);
  if (value) {
    for (const run of runs) await resumeDynamicRun(run);
  } else {
    for (const run of runs) sendProgress(run);
  }
  return state.settings.translation.autoTranslateDynamic;
}

async function validateRunDocument(run, sender, message) {
  const frameId = sender?.frameId ?? 0;
  if (frameId !== 0) return true;
  const documentKey = contentDocumentKey(sender, message);
  if (!run.documentKey && documentKey) run.documentKey = documentKey;
  if (run.documentKey && documentKey && run.documentKey !== documentKey) {
    await invalidateTabRuns(run.tabId, 'stale-document');
    return false;
  }
  const currentUrl = sender?.url ?? sender?.tab?.url ?? message.url;
  if (currentUrl && !sameRunUrl(run.url, currentUrl)) {
    await invalidateTabRuns(run.tabId, 'page-context-changed');
    return false;
  }
  return true;
}

async function handleSegmentApplied(message, sender) {
  const tabId = sender?.tab?.id;
  if (tabId === undefined) return { ok: false, error: 'No tab sender' };
  const run = getRun(tabId, message.url, message.runId);
  if (!run || run.runId !== message.runId) return { ok: false, error: 'Run is not active' };
  if (!await validateRunDocument(run, sender, message)) return { ok: false, error: 'Stale page context' };
  const frameId = sender.frameId ?? 0;
  const frameState = run.frames.get(frameKey(tabId, frameId));
  if (!frameState) return { ok: true, acknowledged: 0 };
  const documentKey = contentDocumentKey(sender, message);
  if (frameState.documentKey && documentKey && frameState.documentKey !== documentKey) return { ok: false, error: 'Stale frame context' };
  let acknowledged = 0;
  for (const unitId of message.unitIds) {
    if (!frameState.current.has(unitId) || !frameState.segments.has(unitId)) continue;
    if (frameState.acknowledged.has(unitId)) continue;
    frameState.acknowledged.add(unitId);
    run.done += 1;
    acknowledged += 1;
  }
  if (acknowledged) {
    run.lastAckAt = Date.now();
    recalculateRunProgress(run);
    sendProgressSoon(run);
    if (run.state === 'translating' && runQueuesDrained(run)) scheduleRunSettlement(run);
  }
  return { ok: true, acknowledged };
}

async function handleUnitsReport(message, sender) {
  const tabId = sender?.tab?.id;
  if (tabId === undefined) return { ok: false, error: 'No tab sender' };
  if (sender.url && state.settings.exclusions?.zones?.thirdPartyIframes) {
    const topUrl = sender.tab?.url ?? message.url;
    try {
      if (!domainMatches(domainFromUrl(sender.url), domainFromUrl(topUrl)) && !domainMatches(domainFromUrl(topUrl), domainFromUrl(sender.url))) {
        return { ok: true, skipped: 'third-party-iframe' };
      }
    } catch { /* noop */ }
  }
  const run = getRun(tabId, message.url, message.runId);
  if (!run || run.runId !== message.runId) return { ok: false, error: 'Run is not active' };
  if (!await validateRunDocument(run, sender, message)) return { ok: false, error: 'Stale page context' };
  clearRunSettlement(run);

  const frameId = sender.frameId ?? 0;
  const documentKey = contentDocumentKey(sender, message);
  const key = frameKey(tabId, frameId);
  let frameState = run.frames.get(key);
  if (frameState?.documentKey && documentKey && frameState.documentKey !== documentKey) {
    clearFrameDelivery(frameState);
    frameState = null;
  }
  if (!frameState) {
    frameState = {
      frameId,
      documentKey,
      current: new Map(),
      pending: new Map(),
      doneIds: new Set(),
      segments: new Map(),
      acknowledged: new Set(),
      outbox: new Map(),
      outboxTimer: null,
      reportSnapshotId: '',
      reportChunkCount: 0,
      reportChunks: new Set(),
      reportBuffer: new Map(),
      processing: false,
      initialized: false,
      inventoryRevision: -1,
      lastSnapshotAt: Date.now()
    };
    run.frames.set(key, frameState);
  }
  if (message.chunkCount !== undefined) {
    const snapshotId = String(message.snapshotId || '');
    if (!snapshotId || !Number.isInteger(message.chunkIndex) || !Number.isInteger(message.chunkCount) || message.chunkIndex >= message.chunkCount) {
      return { ok: false, error: 'Invalid units-report chunk' };
    }
    if (frameState.reportSnapshotId !== snapshotId) {
      frameState.reportSnapshotId = snapshotId;
      frameState.reportChunkCount = message.chunkCount;
      frameState.reportChunks = new Set();
      frameState.reportBuffer = new Map();
    }
    for (const unit of message.units) {
      if (unit && typeof unit.id === 'string' && typeof unit.text === 'string') frameState.reportBuffer.set(unit.id, unit);
    }
    frameState.reportChunks.add(message.chunkIndex);
    if (frameState.reportChunks.size < frameState.reportChunkCount) {
      return { ok: true, chunked: true, received: frameState.reportChunks.size, expected: frameState.reportChunkCount };
    }
    message.units = [...frameState.reportBuffer.values()];
    message.snapshot = true;
    frameState.reportSnapshotId = '';
    frameState.reportChunkCount = 0;
    frameState.reportChunks = new Set();
    frameState.reportBuffer = new Map();
  }
  if (Number.isInteger(message.inventoryRevision) && message.inventoryRevision < frameState.inventoryRevision) {
    return { ok: true, staleSnapshot: true };
  }
  if (Number.isInteger(message.inventoryRevision)) frameState.inventoryRevision = message.inventoryRevision;
  const firstSnapshot = !frameState.initialized;
  const snapshot = message.snapshot === true;
  if (snapshot) {
    const next = new Map();
    for (const unit of message.units) {
      if (!unit || typeof unit.id !== 'string' || typeof unit.text !== 'string') continue;
      next.set(unit.id, unit);
      const previous = frameState.current.get(unit.id);
      if (previous && (previous.text !== unit.text || previous.kind !== unit.kind)) {
        frameState.doneIds.delete(unit.id);
        frameState.pending.delete(unit.id);
        frameState.segments.delete(unit.id);
        frameState.acknowledged.delete(unit.id);
        frameState.outbox.delete(unit.id);
      }
    }
    frameState.current = next;
    for (const collection of [frameState.pending, frameState.segments, frameState.outbox]) {
      for (const unitId of collection.keys()) if (!next.has(unitId)) collection.delete(unitId);
    }
    for (const collection of [frameState.doneIds, frameState.acknowledged]) {
      for (const unitId of collection) if (!next.has(unitId)) collection.delete(unitId);
    }
  } else {
    for (const unit of message.units) {
      if (!unit || typeof unit.id !== 'string' || typeof unit.text !== 'string') continue;
      const previous = frameState.current.get(unit.id);
      if (previous && (previous.text !== unit.text || previous.kind !== unit.kind)) {
        frameState.doneIds.delete(unit.id);
        frameState.pending.delete(unit.id);
        frameState.segments.delete(unit.id);
        frameState.acknowledged.delete(unit.id);
        frameState.outbox.delete(unit.id);
      }
      frameState.current.set(unit.id, unit);
    }
  }
  frameState.initialized = true;
  frameState.lastSnapshotAt = Date.now();
  replayUnacknowledgedSegments(run, frameState);
  queueFrameUnits(run, frameState, { force: firstSnapshot });
  recalculateRunProgress(run);

  if (run.state === 'complete' && state.settings.translation.autoTranslateDynamic && run.pending > 0) {
    run.state = 'translating';
    run.notice = null;
  }
  sendProgress(run);
  if (run.state !== 'translating' || run.controller.signal.aborted) {
    return { ok: true, queued: false, pending: run.pending };
  }
  await processFrameQueue(run, frameState);
  if (run.state === 'translating' && runQueuesDrained(run)) scheduleRunSettlement(run);
  return { ok: true, queued: frameState.pending.size > 0, pending: run.pending };
}

async function handleSelection(message, sender) {
  const settings = state.settings;
  const profile = primaryProfile(settings, 'selection');
  if (await endpointPermissionRequired(profile)) {
    return {
      type: MESSAGE.SELECTION_DELIVERY,
      url: message.url,
      requestId: message.requestId,
      status: 'error',
      text: null,
      error: permissionRequiredResult(message.url).error,
      code: 'permission-required',
      permissionRequired: true
    };
  }
  const domain = domainFromUrl(message.url);
  const targetLang = resolveSiteTargetLang(settings, domain);
  const controller = new AbortController();
  try {
    const result = await state.translator.translateSelection(message.text, {
      url: message.url,
      requestId: message.requestId,
      targetLang,
      signal: controller.signal
    });
    return {
      type: MESSAGE.SELECTION_DELIVERY,
      url: message.url,
      requestId: message.requestId,
      status: 'done',
      text: result.text,
      error: null
    };
  } catch (error) {
    return {
      type: MESSAGE.SELECTION_DELIVERY,
      url: message.url,
      requestId: message.requestId,
      status: 'error',
      text: null,
      error: errorMessage(error)
    };
  }
}

async function handleSetSiteMode(message) {
  const domain = domainFromUrl(message.url);
  if (!domain) return { type: 'site-state-response', url: message.url, ok: false, error: 'No domain for this page.' };
  const rules = state.settings.behaviour.siteRules.filter((rule) => rule.domain !== domain);
  if (message.mode !== null) {
    rules.push({ domain, url: null, policy: message.mode, targetLang: null, profileId: null, neverSend: message.mode === 'never' });
  }
  const enabledSites = new Set(state.settings.behaviour.enabledSites);
  if (message.mode !== null && message.mode !== 'never') enabledSites.add(domain);
  if (message.mode === 'never') enabledSites.delete(domain);
  state.settings = await saveSettings({
    ...state.settings,
    behaviour: { ...state.settings.behaviour, siteRules: rules, enabledSites: [...enabledSites].sort() }
  });
  await syncSiteScripts(state.settings.behaviour);
  if (message.mode !== null && message.mode !== 'never') {
    const pattern = hostPatternForUrl(message.url);
    if (pattern) await injectIntoOpenTabs(pattern, true);
  }
  const permissionGranted = await hasSitePermission(message.url);
  return { type: 'site-state-response', url: message.url, ok: true, ...buildSiteState(state.settings, message.url, permissionGranted), permissionRequired: !permissionGranted };
}

async function getSiteStateFor(url) {
  const siteState = buildSiteState(state.settings, url, await hasSitePermission(url));
  return { ...siteState, permissionRequired: !siteState.permissionGranted };
}

async function exportTm(format) {
  const records = await cacheStore.tmAll();
  return { type: 'tm-export-response', ok: true, payload: serializeTm(records, format), count: records.length };
}

async function importTm(raw) {
  const parsed = parseTm(raw);
  const existing = await cacheStore.tmAll();
  const byKey = new Map(existing.map((record) => [record.key, record]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const toWrite = [];
  for (const record of parsed.records) {
    const previous = byKey.get(record.key);
    if (!previous) { added += 1; toWrite.push(record); }
    else if (previous.translation !== record.translation) { updated += 1; toWrite.push({ ...previous, ...record, lastUsed: Date.now() }); }
    else unchanged += 1;
  }
  await cacheStore.tmPutMany(toWrite);
  return { type: 'tm-import-response', ok: true, total: parsed.total, added, updated, unchanged, skipped: parsed.skipped };
}

async function cacheStats() {
  const records = await cacheStore.tmAll();
  const pages = await cacheStore.pagesAll();
  const bytes = records.reduce((sum, record) => sum + (Number(record.bytes) || JSON.stringify(record).length), 0);
  return {
    tmEntries: records.length,
    pageSnapshots: pages.length,
    tmBytes: bytes,
    diskCapBytes: state.settings.cache.diskCapBytes,
    lookup: await cacheStore.statsGet().catch(() => null)
  };
}

async function readErrorLog() {
  const raw = await storageGet(ERROR_LOG_KEY).catch(() => []);
  return pruneErrorLog(raw, state.settings.diagnostics?.errorRetentionDays ?? 7);
}

async function appendErrorLog(value) {
  state.errorLogQueue = state.errorLogQueue.then(async () => {
    const record = normalizeErrorRecord(value);
    const minimumLevel = state.settings.diagnostics?.errorLogLevel ?? 'error';
    if (!shouldRecordError(record.level, minimumLevel)) return;
    const entries = await readErrorLog();
    const fingerprint = errorFingerprint(record);
    let duplicateIndex = -1;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (errorFingerprint(entries[index]) !== fingerprint) continue;
      if (record.timestamp - entries[index].timestamp <= 10000) duplicateIndex = index;
      break;
    }
    if (duplicateIndex >= 0) {
      const [previous] = entries.splice(duplicateIndex, 1);
      entries.push({ ...previous, ...record, count: previous.count + 1 });
    } else {
      entries.push(record);
    }
    await storageSet(ERROR_LOG_KEY, pruneErrorLog(entries, state.settings.diagnostics?.errorRetentionDays ?? 7));
  }).catch(() => {});
  return state.errorLogQueue;
}

function recordBackgroundError(value, details = {}) {
  const error = value instanceof Error ? value : new Error(String(value ?? 'Unknown error'));
  return appendErrorLog({
    level: 'error',
    source: 'background',
    message: error.message,
    stack: error.stack || '',
    url: runtime.getURL('src/background/index.js'),
    details: JSON.stringify(details),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
  });
}

async function recordClientError(message, sender) {
  const source = sanitizeErrorText(message.source || 'content', 80);
  return appendErrorLog({
    level: normalizeErrorLevel(message.level),
    source,
    message: message.message,
    stack: message.stack || '',
    url: sanitizeErrorUrl(message.url || sender?.url || sender?.tab?.url || ''),
    runId: message.runId || '',
    documentKey: message.documentKey || '',
    userAgent: message.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    details: message.details ? JSON.stringify(message.details) : ''
  });
}

async function clearErrorLog() {
  await storageSet(ERROR_LOG_KEY, []);
}

async function handleDiagnostics() {
  const [translation, cache, capabilities, errors] = await Promise.all([
    state.translator.diagnostics(),
    cacheStats(),
    cacheStore.capabilitiesAll().catch(() => []),
    readErrorLog()
  ]);
  return {
    type: 'diagnostics-response',
    ok: true,
    diagnostics: {
      ...translation,
      cache,
      capabilities,
      prefetch: state.prefetch?.snapshot() ?? null,
      errorLog: errors,
      errorLogSettings: state.settings.diagnostics
    }
  };
}

async function handleHardReset() {
  await storageClear().catch(() => {});
  await cacheStore.clearAll().catch(() => {});
  cacheStore.close();
  state.settings = normalizeSettings(null);
  setTimeout(() => runtime.reload(), 100);
  return { type: 'hard-reset-response', ok: true };
}

async function handleMessage(message, sender) {
  const tabId = sender?.tab?.id;
  const senderUrl = message?.url || sender?.url || sender?.tab?.url || '';
  switch (message.type) {
    case MESSAGE.PING:
      if (tabId !== undefined && senderUrl) {
        const existing = activeRunForTab(tabId);
        if (existing?.documentKey && message.documentKey && existing.documentKey !== message.documentKey) {
          await invalidateTabRuns(tabId, 'stale-document');
        }
        await maybeAutoStart(tabId, senderUrl, { documentKey: message.documentKey }).catch(() => {});
      }
      return { type: MESSAGE.PONG, receivedAt: Date.now() };

    case MESSAGE.UI_TRANSLATIONS_REQUEST:
      if (!validateContentMessage(message)) return { ok: false, error: 'Invalid UI translation request' };
      return uiTranslationsResponse(message);

    case MESSAGE.TRANSLATE_PAGE: {
      const targetTabId = await resolveMessageTabId(message, sender);
      const targetUrl = message.url || senderUrl;
      if (targetTabId === undefined) return { ok: false, error: 'No active tab' };
      if (!await hasSitePermission(targetUrl)) return permissionRequiredResult(targetUrl);
      const siteInfo = buildSiteState(state.settings, targetUrl, true);
      if (siteInfo.blocked) return { ok: false, error: 'This site is blocked by the current site policy.' };
      if (!isEnabledForUrl(targetUrl)) return { ok: false, error: 'This site is not enabled. Enable it in the popup first.' };
      const pattern = hostPatternForUrl(targetUrl);
      if (pattern) await injectIntoOpenTabs(pattern, true);
      return startRun(targetTabId, targetUrl, { profileRole: message.profileRole ?? 'primary', documentKey: message.documentKey ?? '' });
    }

    case MESSAGE.STOP:
      return stopRun(await resolveMessageTabId(message, sender), message.url, 'stop', message.runId ?? null);

    case MESSAGE.REVERT:
      return revertRun(await resolveMessageTabId(message, sender), message.url, message.runId ?? null);

    case MESSAGE.GET_PROGRESS: {
      const run = getRun(await resolveMessageTabId(message, sender), message.url);
      return progressSummary(run);
    }
    case MESSAGE.GET_SITE_STATE:
      return { type: 'site-state-response', url: message.url, ok: true, ...await getSiteStateFor(message.url) };

    case MESSAGE.SET_SITE_MODE:
      return handleSetSiteMode(message);

    case MESSAGE.OPEN_OPTIONS:
      await openOptionsPage(message.section === 'sites' ? 'sites' : undefined);
      return { type: 'open-options-response', ok: true };

    case MESSAGE.FRAME_HELLO: {
      rememberFrame(sender, message);
      const frameId = sender?.frameId ?? 0;
      const run = tabId === undefined ? null : activeRunForTab(tabId);
      if (run) {
        const documentKey = contentDocumentKey(sender, message);
        if (frameId === 0 && run.documentKey && documentKey && run.documentKey !== documentKey) {
          await invalidateTabRuns(tabId, 'stale-document');
          return { ok: false, error: 'Document changed' };
        }
        if (frameId === 0 && !run.documentKey && documentKey) run.documentKey = documentKey;
        if (run.state === 'translating' || (run.state === 'complete' && state.settings.translation.autoTranslateDynamic)) {
          sendToFrame(tabId, frameId, {
            type: MESSAGE.RUN_RESUME,
            url: run.url,
            runId: run.runId,
            documentKey: run.documentKey,
            profileRole: run.profileRole
          }).catch(() => {});
        }
      }
      return { ok: true };
    }

    case MESSAGE.UNITS_REPORT:
      return handleUnitsReport(message, sender);

    case MESSAGE.SEGMENT_APPLIED:
      return handleSegmentApplied(message, sender);

    case MESSAGE.SELECTION_REQUEST:
      return handleSelection(message, sender);

    case MESSAGE.SPA_NAVIGATE:
    case MESSAGE.PAGE_CONTEXT_CHANGED:
      if (tabId !== undefined) await invalidateTabRuns(tabId, message.reason || 'spa-navigate');
      return { ok: true };

    case MESSAGE.BFCACHE_RESTORE:
      if (tabId !== undefined) await invalidateTabRuns(tabId, 'bfcache-restore');
      return { ok: true, translated: false };

    case MESSAGE.RUN_PAUSED: {
      const run = getRun(tabId, message.url, message.runId);
      if (run) {
        clearRunTimers(run);
        run.state = 'paused';
        run.pauseReason = message.reason;
        run.notice = {
          severity: 'warning',
          message: message.reason === 'mutation-storm'
            ? 'Paused: too many page mutations.'
            : `Paused: ${message.reason}`
        };
        try { run.controller.abort(new DOMException('paused', 'AbortError')); } catch { /* noop */ }
        run.updatedAt = Date.now();
        sendProgress(run);
      }
      return { ok: true };
    }

    case MESSAGE.HOVER_INTENT:
      return state.prefetch.onHover(message);

    case MESSAGE.NEXT_NAV_INTENT:
      return state.prefetch.onNextNav(message);

    case MESSAGE.PAGE_SNAPSHOT_REQUEST: {
      const page = await cacheStore.pageGet(normalizeUrl(message.url, state.settings.cache.urlNormalisation));
      return { type: 'page-snapshot-response', ok: true, snapshot: page ? { hashes: page.hashes, zones: page.zoneMap, lastSeen: page.lastSeen } : null };
    }

    case MESSAGE.TM_LOOKUP_REQUEST:
      return { type: 'tm-lookup-response', ok: true, results: await lookupTmForQueries(message.url, message.queries) };

    case MESSAGE.CACHE_STATS_REQUEST:
      return { type: 'cache-stats-response', ok: true, stats: await cacheStats() };

    case MESSAGE.CACHE_FORGET_REQUEST:
      return { type: 'cache-forget-response', ok: true, result: await cacheStore.purgeDomain(message.domain) };

    case MESSAGE.CACHE_PURGE_REQUEST:
      await cacheStore.clearStore('tm');
      await cacheStore.clearStore('pages');
      await cacheStore.clearStore('domainChrome');
      return { type: 'cache-purge-response', ok: true };

    case MESSAGE.TM_EXPORT_REQUEST:
      return exportTm(message.format);

    case MESSAGE.TM_IMPORT_REQUEST:
      return importTm(message.raw);

    case MESSAGE.PROBE_PROFILE_REQUEST: {
      if (await endpointPermissionRequired(message.profile)) return permissionRequiredResult(message.profile.baseUrl);
      const capability = await probeProfile(message.profile);
      await cacheStore.capabilityPut(capability).catch(() => {});
      return { type: 'probe-profile-response', ok: true, profileId: message.profile.id, capabilities: capability };
    }

    case MESSAGE.TEST_CONNECTION_REQUEST: {
      if (await endpointPermissionRequired(message.profile)) return permissionRequiredResult(message.profile.baseUrl);
      const result = await testConnection(message.profile);
      await cacheStore.capabilityPut(result.capabilities).catch(() => {});
      return { type: 'test-connection-response', ok: true, latencyMs: result.latencyMs, tokensPerSecond: result.capabilities.tokensPerSecond, capabilities: result.capabilities };
    }

    case MESSAGE.TRANSLATION_PROMPT_TEST_REQUEST: {
      if (!validateContentMessage(message)) {
        return { type: 'translation-prompt-test-response', ok: false, error: 'Invalid prompt test request' };
      }
      const settings = normalizeSettings(message.settings);
      const profile = primaryProfile(settings, 'primary');
      if (await endpointPermissionRequired(profile)) return permissionRequiredResult(profile.baseUrl);
      const result = await testTranslationPrompt({
        settings,
        mode: message.mode,
        texts: message.texts,
        batchSize: message.batchSize,
        sourceLang: message.sourceLang ?? null
      });
      return { type: 'translation-prompt-test-response', ok: true, ...result };
    }

    case MESSAGE.REFRESH_MODELS_REQUEST: {
      if (await endpointPermissionRequired(message.profile)) return permissionRequiredResult(message.profile.baseUrl);
      const adapter = createAdapter(message.profile);
      const timeoutMs = Number.isFinite(message.timeoutMs) ? Math.max(1000, message.timeoutMs) : undefined;
      const probe = await adapter.probe({ timeoutMs });
      return {
        type: 'refresh-models-response',
        ok: true,
        models: probe.models ?? [],
        contextLength: probe.contextLength ?? null
      };
    }

    case MESSAGE.CAPABILITIES_REQUEST: {
      const records = await Promise.all(message.profileIds.map((id) => cacheStore.capabilityGet(id)));
      return { type: 'capabilities-response', ok: true, capabilities: records.filter(Boolean) };
    }

    case MESSAGE.AUTOTUNE_ESTIMATE_REQUEST:
      return { type: 'autotune-estimate-response', ok: true, values: {}, concurrency: null };

    case MESSAGE.PREFETCH_METRICS_REQUEST:
      return { type: 'prefetch-metrics-response', ok: true, snapshot: state.prefetch.snapshot() };

    case MESSAGE.DIAGNOSTICS_REQUEST:
      return handleDiagnostics();

    case MESSAGE.CLIENT_ERROR:
      await recordClientError(message, sender);
      return { ok: true };

    case MESSAGE.ERROR_LOG_REQUEST:
      return { ok: true, errors: await readErrorLog(), retentionDays: state.settings.diagnostics.errorRetentionDays };

    case MESSAGE.ERROR_LOG_CLEAR_REQUEST:
      await clearErrorLog();
      return { ok: true };

    case MESSAGE.SET_AUTO_TRANSLATE_DYNAMIC: {
      const value = await updateAutoTranslateDynamic(tabId, message.value);
      return { ok: true, value };
    }

    case MESSAGE.SET_TRANSLATION_PREFERENCES: {
      if (!validateContentMessage(message)) return { ok: false, error: 'Invalid translation preference update.' };
      const translation = { ...state.settings.translation };
      if (message.preferences.targetLang !== undefined) translation.targetLang = message.preferences.targetLang.trim();
      if (message.preferences.renderMode !== undefined) translation.renderMode = message.preferences.renderMode;
      state.settings = await saveSettings({ ...state.settings, translation });
      return {
        ok: true,
        translation: {
          targetLang: state.settings.translation.targetLang,
          renderMode: state.settings.translation.renderMode
        }
      };
    }

    case MESSAGE.SAVE_SETTINGS: {
      const previousDynamic = state.settings.translation.autoTranslateDynamic;
      state.settings = await saveSettings(message.settings);
      await syncSiteScripts(state.settings.behaviour);
      if (!previousDynamic && state.settings.translation.autoTranslateDynamic) {
        for (const [, run] of [...state.runs.entries()]) await resumeDynamicRun(run);
      }
      return { ok: true, settings: state.settings };
    }

    case MESSAGE.LOAD_SETTINGS:
      return { ok: true, settings: state.settings };

    case MESSAGE.HARD_RESET_REQUEST:
      return handleHardReset();

    default:
      return undefined;
  }
}

async function activeTab() {
  for (const query of [{ active: true, lastFocusedWindow: true }, { active: true }]) {
    try {
      const tabs = await queryTabs(query);
      const tab = tabs.find((candidate) => candidate?.id !== undefined);
      if (tab) return tab;
    } catch { /* Try the next query shape. */ }
  }
  return null;
}

async function resolveMessageTabId(message, sender) {
  const senderUrl = String(sender?.url ?? sender?.tab?.url ?? '');
  const senderIsExtensionPage = senderUrl.startsWith(runtime.getURL(''));
  if (senderIsExtensionPage && Number.isInteger(message?.tabId)) {
    try {
      const tab = await getTab(message.tabId);
      if (tab?.id !== undefined && (!message.url || !tab.url || tab.url === message.url)) return tab.id;
    } catch { /* The tab may have closed; fall back below. */ }
  }
  if (Number.isInteger(sender?.tab?.id)) return sender.tab.id;
  if (Number.isInteger(message?.tabId)) {
    try {
      const tab = await getTab(message.tabId);
      if (tab?.id !== undefined && (!message.url || !tab.url || tab.url === message.url)) return tab.id;
    } catch { /* The tab may have closed; fall back below. */ }
  }
  const current = await activeTab();
  if (!current?.id) return undefined;
  if (!message?.url || current.url === message.url) return current.id;
  try {
    const matches = await queryTabs({});
    const target = matches.find((tab) => tab.url === message.url);
    if (target?.id !== undefined) return target.id;
  } catch { /* Fall back to the active tab. */ }
  return current.id;
}

async function commandHandler(command) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url) return;
  switch (command) {
    case 'translate-selection':
      await sendTabMessage(tab.id, { type: MESSAGE.TRANSLATE_SELECTION, url: tab.url }).catch(() => {});
      break;
    case 'toggle-render-mode':
      await sendTabMessage(tab.id, { type: MESSAGE.TOGGLE_RENDER_MODE, url: tab.url }).catch(() => {});
      break;
    default:
      break;
  }
}

async function init() {
  state.settings = await loadSettings();
  state.translator = new TranslationService({ getSettings: () => state.settings });
  state.prefetch = new PrefetchService({
    getSettings: () => state.settings,
    translator: state.translator,
    onError: (error) => console.warn('[lbt] prefetch', error)
  });
  if (state.settings.behaviour.allSitesEnabled && !await hasAllSitesPermission()) {
    state.settings = await saveSettings({
      ...state.settings,
      behaviour: { ...state.settings.behaviour, allSitesEnabled: false }
    });
    await broadcastPermissionRequired('all-sites-missing-on-startup');
  }
  await syncSiteScripts(state.settings.behaviour).catch(() => {});
  await cacheStore.open().catch(() => {});
  await cacheStore.evict({ diskCapBytes: state.settings.cache.diskCapBytes, ttlMs: state.settings.cache.ttlMs }).catch(() => {});
  const tab = await activeTab().catch(() => null);
  if (tab?.id && tab.url) maybeAutoStart(tab.id, tab.url).catch(() => {});
}

globalThis.addEventListener?.('error', (event) => {
  recordBackgroundError(event.error || event.message, { phase: 'background-error-event', filename: event.filename, lineno: event.lineno, colno: event.colno });
});
globalThis.addEventListener?.('unhandledrejection', (event) => {
  recordBackgroundError(event.reason, { phase: 'background-unhandled-rejection' });
});

const ready = init();
ready.catch((error) => {
  console.error('[lbt] background boot failed', error);
  recordBackgroundError(error, { phase: 'background-boot' });
});

state.permissionCleanup = installPermissionListeners({
  getSettings: () => state.settings,
  onChanged: () => {},
  onAllSitesGranted: async () => {
    state.settings = await saveSettings({
      ...state.settings,
      behaviour: { ...state.settings.behaviour, allSitesEnabled: true }
    });
    await syncSiteScripts(state.settings.behaviour);
  },
  onAllSitesRemoved: async () => {
    state.settings = await saveSettings({
      ...state.settings,
      behaviour: { ...state.settings.behaviour, allSitesEnabled: false }
    });
    await broadcastPermissionRequired('all-sites-removed');
    await syncSiteScripts(state.settings.behaviour);
  }
});

onStorageChanged((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  state.settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
});

onRuntimeMessage(async (message, sender) => {
  await ready;
  return handleMessage(message, sender);
});

onCommand((command) => {
  ready.then(() => commandHandler(command)).catch((error) => {
    console.error('[lbt] command failed', error);
    recordBackgroundError(error, { phase: 'command', command });
  });
});

onTabUpdated((tabId, changeInfo, tab) => {
  const navigationStarted = changeInfo.status === 'loading' || Boolean(changeInfo.url);
  if (!navigationStarted) return;
  ready.then(async () => {
    if (changeInfo.status === 'loading') {
      await invalidateTabRuns(tabId, 'tab-reload');
      return;
    }
    const eventUrl = changeInfo.url ?? tab?.url ?? '';
    const runs = tabRuns(tabId);
    if (!runs.length) {
      clearAutoStartedForTab(tabId);
      return;
    }
    if (eventUrl && runs.every(([, run]) => sameRunUrl(run.url, eventUrl))) return;
    await invalidateTabRuns(tabId, 'tab-navigation');
  }).catch(() => {});
});

onTabRemoved((tabId) => {
  ready.then(() => invalidateTabRuns(tabId, 'tab-removed')).catch(() => {
    state.framesByTab.delete(tabId);
  });
});

onTabActivated(({ tabId }) => {
  ready.then(() => activeTab()).then((tab) => {
    if (tab?.url) maybeAutoStart(tabId, tab.url).catch(() => {});
  }).catch(() => {});
});



