import {
  action, extension, getAllPermissions, getTab, onCommand, onRuntimeConnect, onRuntimeMessage, onStorageChanged,
  onTabActivated, onTabRemoved, onTabUpdated, openOptionsPage, queryTabs,
  runtime, sendTabMessage, storageClear
} from '../shared/browser.js';
import {
  ALL_URLS, domainMatches, loadSettings, normalizeSettings, resolveSiteTargetLang,
  saveSettings, sanitizeSettingsForContent, SETTINGS_KEY
} from '../shared/settings.js';
import { errorMessage, MESSAGE, RUN_PORT_NAME, runId as createRunId, validateContentMessage } from '../shared/messages.js';
import { domainFromUrl, hostPatternForUrl, normalizeUrl, siteStateFromSettings as buildSiteState } from '../shared/urls.js';
import { glossaryHash, makeTmKey, normalizeForLookup, stableHash } from '../shared/text.js';
import { cacheStore, parseTm, recordSize, serializeTm } from './cache.js';
import { primaryProfile, createAdapter, probeProfile, testConnection } from './providers/index.js';
import { promptVersionForSettings, testTranslationPrompt, TranslationService } from './translator.js';
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
  permissionCleanup: null
};

function runMapKey(tabId, url) {
  return `${tabId}:${normalizeUrl(url, state.settings.cache.urlNormalisation)}`;
}

function getRun(tabId, url, runId = null) {
  if (runId) {
    for (const run of state.runs.values()) if (run.runId === runId) return run;
  }
  return state.runs.get(runMapKey(tabId, url)) ?? null;
}

function frameKey(tabId, frameId) {
  return `${tabId}:${frameId}`;
}

function framesForTab(tabId) {
  return [...(state.framesByTab.get(tabId) ?? [])];
}

function rememberFrame(sender, message) {
  const tabId = sender?.tab?.id;
  if (tabId === undefined) return;
  const frameId = sender.frameId ?? 0;
  const set = state.framesByTab.get(tabId) ?? new Map();
  set.set(frameKey(tabId, frameId), {
    frameId,
    url: sender.url ?? message?.url ?? '',
    lastSeen: Date.now()
  });
  state.framesByTab.set(tabId, set);
}

function sendToFrame(tabId, frameId, message) {
  const options = Number.isInteger(frameId) ? { frameId } : undefined;
  return sendTabMessage(tabId, message, options).catch(() => undefined);
}

async function broadcastRun(run, message) {
  const frames = framesForTab(run.tabId);
  if (!frames.length) {
    await sendToFrame(run.tabId, undefined, message);
    return;
  }
  await Promise.all(frames.map((frame) => sendToFrame(run.tabId, frame.frameId, message)));
}

function progressSummary(run) {
  if (!run) return { state: 'idle', done: 0, total: 0, url: '', runId: null, notice: null };
  return {
    state: run.state,
    done: run.done,
    total: run.total,
    url: run.url,
    runId: run.runId,
    notice: run.notice ?? null,
    cacheHitRate: run.total ? run.cacheHits / run.total : null,
    tokensPerSecond: null
  };
}

function sendProgress(run) {
  const summary = progressSummary(run);
  broadcastRun(run, { type: MESSAGE.PROGRESS_UPDATE, ...summary }).catch(() => {});
}

function isEnabledForUrl(url) {
  const domain = domainFromUrl(url);
  if (!domain) return false;
  return state.settings.behaviour.allSitesEnabled
    || state.settings.behaviour.enabledSites.some((site) => domainMatches(domain, site));
}

async function maybeAutoStart(tabId, url) {
  if (!url || !isEnabledForUrl(url)) return;
  const stateInfo = buildSiteState(state.settings, url, await hasSitePermission(url));
  if (!stateInfo.autoTranslateAllowed) return;
  const key = runMapKey(tabId, url);
  if (state.autoStarted.has(key) || state.runs.has(key)) return;
  state.autoStarted.add(key);
  await startRun(tabId, url, { profileRole: 'primary', auto: true });
}

async function startRun(tabId, url, { profileRole = 'primary', auto = false } = {}) {
  const key = runMapKey(tabId, url);
  const existing = state.runs.get(key);
  if (existing && !['idle', 'complete', 'error', 'paused'].includes(existing.state)) return progressSummary(existing);
  const run = {
    runId: createRunId(),
    tabId,
    url,
    profileRole,
    auto,
    state: 'translating',
    done: 0,
    total: 0,
    cacheHits: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    frames: new Map(),
    controller: new AbortController(),
    notice: null
  };
  state.runs.set(key, run);
  await broadcastRun(run, { type: MESSAGE.RUN_BEGIN, url, runId: run.runId, profileRole });
  sendProgress(run);
  return progressSummary(run);
}

async function stopRun(tabId, url, reason = 'stop') {
  const run = getRun(tabId, url);
  if (!run) return { ok: true, state: 'idle' };
  try { run.controller.abort(new DOMException(reason, 'AbortError')); } catch { /* noop */ }
  run.state = 'idle';
  await broadcastRun(run, { type: MESSAGE.RUN_CANCEL, runId: run.runId, url: run.url, reason });
  state.runs.delete(runMapKey(tabId, url));
  return { ok: true, state: 'idle' };
}

async function revertRun(tabId, url) {
  const run = getRun(tabId, url);
  if (run) {
    try { run.controller.abort(new DOMException('revert', 'AbortError')); } catch { /* noop */ }
    await broadcastRun(run, { type: MESSAGE.RUN_REVERT, runId: run.runId, url: run.url });
    state.runs.delete(runMapKey(tabId, url));
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
  const frameId = sender.frameId ?? 0;
  const key = frameKey(tabId, frameId);
  let frameState = run.frames.get(key);
  if (!frameState) {
    frameState = { frameId, units: new Map(), seen: new Set(), processing: false, done: 0, total: 0 };
    run.frames.set(key, frameState);
  }
  for (const unit of message.units) {
    if (!unit || typeof unit.id !== 'string' || typeof unit.text !== 'string') continue;
    if (!frameState.seen.has(unit.id)) {
      frameState.seen.add(unit.id);
      frameState.units.set(unit.id, unit);
      frameState.total += 1;
      run.total += 1;
    }
  }
  if (frameState.processing) return { ok: true, queued: true };
  frameState.processing = true;
  try {
    while (frameState.units.size) {
      if (run.state !== 'translating' || run.controller.signal.aborted) break;
      const batch = [...frameState.units.values()];
      frameState.units.clear();
      await state.translator.translateUnits(batch, {
        url: run.url,
        domain: domainFromUrl(run.url),
        targetLang: resolveSiteTargetLang(state.settings, domainFromUrl(run.url)),
        profileRole: run.profileRole,
        signal: run.controller.signal,
        onSegment: (segment) => {
          if (run.state !== 'translating' || !frameState.seen.has(segment.unitId)) return;
          const unitId = segment.unitId;
          if (!run.doneIds) run.doneIds = new Set();
          if (!run.doneIds.has(unitId)) {
            run.doneIds.add(unitId);
            run.done += 1;
            frameState.done += 1;
            if (segment.hit) run.cacheHits += 1;
          }
          sendToFrame(tabId, frameId, {
            type: MESSAGE.SEGMENT_DELIVERY,
            runId: run.runId,
            segments: [{ unitId, text: segment.text, kind: segment.kind ?? 'text', hit: Boolean(segment.hit), attribute: segment.attribute ?? null }]
          }).catch(() => {});
          sendProgress(run);
        },
        onProgress: () => { if (run.state === 'translating') sendProgress(run); }
      });
      await savePageSnapshot(run.url, batch);
    }
    if (run.state === 'translating') {
      run.state = 'complete';
      run.updatedAt = Date.now();
      sendProgress(run);
      await sendToFrame(tabId, frameId, { type: MESSAGE.RUN_SETTLED, runId: run.runId, url: run.url, idleFill: Boolean(state.settings.speed.prefetch.idleFill) });
      state.runs.set(runMapKey(tabId, run.url), run);
      return { ok: true };
    }
    return { ok: true, paused: true };
  } catch (error) {
    if (run.controller.signal.aborted) return { ok: false, error: 'aborted' };
    state.translator.logError(error);
    run.state = 'error';
    run.notice = { severity: 'error', message: errorMessage(error) };
    sendProgress(run);
    return { ok: false, error: errorMessage(error) };
  } finally {
    frameState.processing = false;
    run.updatedAt = Date.now();
  }
}

async function handleSelection(message, sender) {
  const settings = state.settings;
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
    rules.push({ domain, url: null, policy: message.mode, targetLang: null, profileId: null, engineMode: null, neverSend: message.mode === 'never' });
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
  return { type: 'site-state-response', url: message.url, ok: true, ...buildSiteState(state.settings, message.url, await hasSitePermission(message.url)) };
}

async function getSiteStateFor(url) {
  return buildSiteState(state.settings, url, await hasSitePermission(url));
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

async function handleDiagnostics() {
  const [translation, cache, capabilities] = await Promise.all([
    state.translator.diagnostics(),
    cacheStats(),
    cacheStore.capabilitiesAll().catch(() => [])
  ]);
  return {
    type: 'diagnostics-response',
    ok: true,
    diagnostics: {
      ...translation,
      cache,
      capabilities,
      prefetch: state.prefetch?.snapshot() ?? null
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
  const senderUrl = sender?.tab?.url ?? message?.url ?? '';
  switch (message.type) {
    case MESSAGE.PING:
      if (tabId !== undefined && senderUrl) {
        await maybeAutoStart(tabId, senderUrl).catch(() => {});
      }
      return { type: MESSAGE.PONG, receivedAt: Date.now() };

    case MESSAGE.TRANSLATE_PAGE: {
      const targetTabId = await resolveMessageTabId(message, sender);
      const targetUrl = message.url || senderUrl;
      if (targetTabId === undefined) return { ok: false, error: 'No active tab' };
      if (!await hasSitePermission(targetUrl)) return { ok: false, error: 'Website access is required. Allow all sites from the popup first.' };
      const siteInfo = buildSiteState(state.settings, targetUrl, true);
      if (siteInfo.blocked) return { ok: false, error: 'This site is blocked by the current site policy.' };
      if (!isEnabledForUrl(targetUrl)) return { ok: false, error: 'This site is not enabled. Enable it in the popup first.' };
      const pattern = hostPatternForUrl(targetUrl);
      if (pattern) await injectIntoOpenTabs(pattern, true);
      return startRun(targetTabId, targetUrl, { profileRole: message.profileRole ?? 'primary' });
    }

    case MESSAGE.STOP:
      return stopRun(await resolveMessageTabId(message, sender), message.url);

    case MESSAGE.REVERT:
      return revertRun(await resolveMessageTabId(message, sender), message.url);

    case MESSAGE.GET_PROGRESS: {
      const run = getRun(await resolveMessageTabId(message, sender), message.url);
      return progressSummary(run);
    }
    case MESSAGE.GET_SITE_STATE:
      return { type: 'site-state-response', url: message.url, ok: true, ...await getSiteStateFor(message.url) };

    case MESSAGE.SET_SITE_MODE:
      return handleSetSiteMode(message);

    case MESSAGE.OPEN_OPTIONS:
      await openOptionsPage();
      return { type: 'open-options-response', ok: true };

    case MESSAGE.FRAME_HELLO: {
      rememberFrame(sender, message);
      const frameId = sender?.frameId ?? 0;
      const run = tabId === undefined ? null : getRun(tabId, senderUrl);
      if (run?.state === 'translating') {
        sendToFrame(tabId, frameId, {
          type: MESSAGE.RUN_RESUME,
          url: run.url,
          runId: run.runId,
          profileRole: run.profileRole
        }).catch(() => {});
      }
      return { ok: true };
    }

    case MESSAGE.UNITS_REPORT:
      return handleUnitsReport(message, sender);

    case MESSAGE.SELECTION_REQUEST:
      return handleSelection(message, sender);

    case MESSAGE.SPA_NAVIGATE:
      if (tabId !== undefined) await stopRun(tabId, message.url, 'spa-navigate');
      state.autoStarted.delete(runMapKey(tabId, message.url));
      return { ok: true };

    case MESSAGE.BFCACHE_RESTORE:
      return { ok: true, translated: Boolean(getRun(tabId, message.url)) };

    case MESSAGE.RUN_PAUSED: {
      const run = getRun(tabId, message.url, message.runId);
      if (run) {
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
      const capability = await probeProfile(message.profile);
      await cacheStore.capabilityPut(capability).catch(() => {});
      return { type: 'probe-profile-response', ok: true, profileId: message.profile.id, capabilities: capability };
    }

    case MESSAGE.TEST_CONNECTION_REQUEST: {
      const result = await testConnection(message.profile);
      await cacheStore.capabilityPut(result.capabilities).catch(() => {});
      return { type: 'test-connection-response', ok: true, latencyMs: result.latencyMs, tokensPerSecond: result.capabilities.tokensPerSecond, capabilities: result.capabilities };
    }

    case MESSAGE.TRANSLATION_PROMPT_TEST_REQUEST: {
      if (!validateContentMessage(message)) {
        return { type: 'translation-prompt-test-response', ok: false, error: 'Invalid prompt test request' };
      }
      const result = await testTranslationPrompt({
        settings: normalizeSettings(message.settings),
        mode: message.mode,
        texts: message.texts,
        batchSize: message.batchSize,
        sourceLang: message.sourceLang ?? null
      });
      return { type: 'translation-prompt-test-response', ok: true, ...result };
    }

    case MESSAGE.REFRESH_MODELS_REQUEST: {
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

    case MESSAGE.HUD_REQUEST: {
      const run = getRun(tabId, message.url);
      return { type: 'hud-response', ok: true, snapshot: progressSummary(run) };
    }

    case MESSAGE.DIAGNOSTICS_REQUEST:
      return handleDiagnostics();

    case MESSAGE.SAVE_SETTINGS:
      state.settings = await saveSettings(message.settings);
      await syncSiteScripts(state.settings.behaviour);
      return { ok: true, settings: state.settings };

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
    case 'translate-page': {
      if (!await hasSitePermission(tab.url)) break;
      const siteInfo = buildSiteState(state.settings, tab.url, true);
      if (siteInfo.blocked || !isEnabledForUrl(tab.url)) break;
      const pattern = hostPatternForUrl(tab.url);
      if (pattern) await injectIntoOpenTabs(pattern, true);
      await startRun(tab.id, tab.url, { profileRole: 'primary' });
      break;
    }
    case 'revert-page':
      await revertRun(tab.id, tab.url);
      break;
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
  await syncSiteScripts(state.settings.behaviour).catch(() => {});
  await cacheStore.open().catch(() => {});
  await cacheStore.evict({ diskCapBytes: state.settings.cache.diskCapBytes, ttlMs: state.settings.cache.ttlMs }).catch(() => {});
  const tab = await activeTab().catch(() => null);
  if (tab?.id && tab.url) maybeAutoStart(tab.id, tab.url).catch(() => {});
}

const ready = init();
ready.catch((error) => console.error('[lbt] background boot failed', error));

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
    await syncSiteScripts(state.settings.behaviour);
  }
});

onStorageChanged((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  state.settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
});

onRuntimeConnect((port) => {
  if (port.name !== RUN_PORT_NAME) return;
  port.onMessage.addListener(() => {});
  port.onDisconnect.addListener(() => {});
});

onRuntimeMessage(async (message, sender) => {
  await ready;
  return handleMessage(message, sender);
});

onCommand((command) => {
  ready.then(() => commandHandler(command)).catch((error) => console.error('[lbt] command failed', error));
});

onTabUpdated((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    state.autoStarted.delete(runMapKey(tabId, changeInfo.url ?? tab.url ?? ''));
    state.runs.delete(runMapKey(tabId, tab?.url ?? ''));
  }
});

onTabRemoved((tabId) => {
  state.framesByTab.delete(tabId);
  for (const [key, run] of state.runs) {
    if (run.tabId !== tabId) continue;
    try { run.controller.abort(); } catch { /* noop */ }
    state.runs.delete(key);
  }
});

onTabActivated(({ tabId }) => {
  ready.then(() => activeTab()).then((tab) => {
    if (tab?.url) maybeAutoStart(tabId, tab.url).catch(() => {});
  }).catch(() => {});
});



