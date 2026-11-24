import { cacheStore, recordSize } from './cache.js';
import { createAdapter, fallbackProfile, primaryProfile, ProviderError, reasoningEffort } from './providers/index.js';
import {
  estimateTokens, glossaryHash, makeTmKey, normalizeForLookup, stableHash
} from '../shared/text.js';
import { resolveSiteProfileId } from '../shared/settings.js';
import {
  DEFAULT_PROMPT_TEMPLATES, PROMPT_CONTRACT_VERSION, promptFingerprint, renderPromptTemplate, validatePromptTemplate
} from '../shared/prompt.js';

const PROMPT_VERSION = PROMPT_CONTRACT_VERSION;
const FIXED_PROBE = 'Reply with the single word: ok';

function stripCodeFence(value) {
  return String(value ?? '').replace(/^\s*```(?:json|text|markdown|txt)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

export function parseEnvelope(value, expectedCount) {
  const text = stripCodeFence(value);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { parsed = null; }
    }
  }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.r) ? parsed.r : Array.isArray(parsed?.segments) ? parsed.segments : null;
  if (!rows) {
    throw new ProviderError('Model response did not contain a translation array', {
      kind: 'malformed',
      detail: `Expected ${expectedCount} indexed result(s); no parseable JSON envelope was found (${text.length} characters received).`
    });
  }
  return rows
    .filter((row) => row && (Number.isInteger(row.i) || Number.isInteger(row.index)) && typeof (row.t ?? row.text ?? row.translation) === 'string')
    .map((row) => ({ i: Number(row.i ?? row.index), t: row.t ?? row.text ?? row.translation }));
}

function randomMarkerToken() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID().replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase();
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(6);
    cryptoApi.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return stableHash(`${Date.now()}:${Math.random()}`).slice(0, 12).toUpperCase();
}

export function createBatchToken(units = [], explicit = null) {
  const requested = String(explicit ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 16).toUpperCase();
  const texts = units.map((unit) => String(unit?.text ?? ''));
  if (requested.length >= 6 && !texts.some((text) => text.includes(requested))) return requested;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = randomMarkerToken();
    if (token.length >= 6 && !texts.some((text) => text.includes(token))) return token;
  }
  return stableHash(`${Date.now()}:${Math.random()}:${texts.join('\u001f')}`).slice(0, 20).toUpperCase();
}

export function parseMarkerEnvelope(value, expectedCount, token) {
  const text = stripCodeFence(value);
  const normalizedToken = String(token ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!normalizedToken) {
    throw new ProviderError('Batch marker token is missing', { kind: 'config' });
  }
  const pattern = new RegExp(`[⟦\\[]?\\s*LBT\\s*[:：]\\s*${normalizedToken}\\s*[:：]\\s*(\\d+)\\s*[⟧\\]]?`, 'gi');
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== expectedCount) {
    throw new ProviderError('Model response did not preserve every batch marker', {
      kind: 'malformed',
      detail: `Expected ${expectedCount} marker blocks; received ${matches.length}.`
    });
  }
  const seen = new Set();
  const rows = matches.map((match, position) => {
    const index = Number(match[1]) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= expectedCount) {
      throw new ProviderError('Model response used a batch marker index outside the request', {
        kind: 'malformed',
        detail: `Marker ${position + 1} contained invalid index ${match[1]}.`
      });
    }
    if (seen.has(index)) {
      throw new ProviderError('Model response duplicated a batch marker', {
        kind: 'malformed',
        detail: `Marker index ${index + 1} appeared more than once.`
      });
    }
    seen.add(index);
    const next = matches[position + 1];
    const translated = text.slice(match.index + match[0].length, next?.index ?? text.length).trim();
    if (!translated) {
      throw new ProviderError('Model response left a batch marker without translated text', {
        kind: 'malformed',
        detail: `Marker index ${index + 1} had an empty translation.`
      });
    }
    return { i: index, t: translated };
  });
  if (seen.size !== expectedCount) {
    throw new ProviderError('Model response did not return one translation per batch marker', {
      kind: 'malformed',
      detail: `Expected indexes 1-${expectedCount}; received ${seen.size} unique block(s).`
    });
  }
  return rows;
}

export function parseBatchResponse(value, expectedCount, token) {
  let markerError = null;
  try {
    return parseMarkerEnvelope(value, expectedCount, token);
  } catch (error) {
    markerError = error;
  }
  try {
    const rows = parseEnvelope(value, expectedCount);
    const indexes = new Set(rows.map((row) => row.i));
    const complete = rows.length === expectedCount
      && indexes.size === expectedCount
      && [...indexes].every((index) => index >= 0 && index < expectedCount);
    if (!complete) {
      throw new ProviderError('JSON fallback did not contain exactly one translation per segment', {
        kind: 'malformed',
        detail: `JSON fallback returned ${rows.length} row(s) with ${indexes.size} unique index(es) for ${expectedCount} segment(s).`
      });
    }
    return rows;
  } catch (jsonError) {
    throw new ProviderError('Model response was neither valid marker text nor a JSON translation envelope', {
      kind: 'malformed',
      detail: `${markerError?.message ?? 'Marker parse failed'}; ${jsonError?.message ?? 'JSON parse failed'}`
    });
  }
}

export function promptVersionForSettings(settings, mode = 'batch') {
  const translation = settings.translation ?? {};
  const legacyTemplate = translation.promptTemplate;
  const templates = translation.promptTemplates ?? {
    batch: legacyTemplate ?? DEFAULT_PROMPT_TEMPLATES.batch,
    single: legacyTemplate ?? DEFAULT_PROMPT_TEMPLATES.single
  };
  return promptFingerprint({
    templates,
    mode,
    customPromptAdditions: translation.customPromptAdditions || '',
    tone: translation.formality || 'default'
  });
}

function invalidPromptError(validation) {
  const describe = (names) => names.map((name) => `{${name}}`).join(', ');
  const issues = [];
  if (validation.missing.length) issues.push(`missing required placeholder(s): ${describe(validation.missing)}`);
  if (validation.unknown.length) issues.push(`unknown placeholder(s): ${describe(validation.unknown)}`);
  return new ProviderError(`Translation prompt template is invalid for ${validation.mode} mode (${issues.join('; ')})`, {
    kind: 'config',
    detail: JSON.stringify(validation)
  });
}

function promptTemplateForMode(translation, mode) {
  const templates = translation.promptTemplates ?? {};
  return templates[mode]
    ?? translation.promptTemplate
    ?? DEFAULT_PROMPT_TEMPLATES[mode];
}

function fixedSystemPrompt(mode) {
  if (mode === 'single') {
    return [
      'You are a translation engine.',
      'Return only the translated text in plain text.',
      'Do not return JSON, labels, explanations, quotation marks around the whole result, or code fences.'
    ].join(' ');
  }
  return [
    'You are a translation engine.',
    'Copy every segment marker line exactly.',
    'Return only marker-prefixed translations.',
    'Do not return JSON, commentary, labels, or code fences.'
  ].join(' ');
}

function buildMessages(units, context, mode = 'batch') {
  const translation = context.settings.translation;
  const template = promptTemplateForMode(translation, mode);
  const validation = validatePromptTemplate(template, mode);
  if (!validation.valid) throw invalidPromptError(validation);

  const glossary = Array.isArray(translation.glossary)
    ? translation.glossary
      .filter((entry) => entry.source && entry.replacement !== null)
      .map((entry) => ({ source: entry.source, replacement: entry.replacement }))
    : [];
  const batchToken = mode === 'batch' ? createBatchToken(units, context.batchToken) : '';
  const sourceText = mode === 'single'
    ? String(units[0]?.text ?? '')
    : units.map((unit, index) => `⟦LBT:${batchToken}:${index + 1}⟧\n${String(unit.text ?? '')}`).join('\n');
  const renderedPrompt = renderPromptTemplate(template, {
    target_lang: context.targetLang,
    batch_token: batchToken,
    source_text: sourceText,
    source_lang: context.sourceLang ?? 'auto-detect',
    tone: translation.formality || 'default',
    glossary_json: JSON.stringify(glossary),
    custom_instructions: translation.customPromptAdditions || 'No additional instructions.'
  }, mode);
  return [
    { role: 'system', content: fixedSystemPrompt(mode) },
    { role: 'user', content: renderedPrompt }
  ];
}


export function contextPromptTokenBudget(profile) {
  const contextLength = Math.floor(Number(profile?.contextLength));
  if (!Number.isFinite(contextLength) || contextLength <= 0) return null;
  const maxTokens = Math.floor(Number(profile?.maxTokens));
  const outputReserve = Math.min(
    contextLength * 0.5,
    Math.max(128, Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : contextLength * 0.25)
  );
  return Math.max(64, Math.floor(contextLength - outputReserve));
}

export function estimateBatchPromptTokens(units, context) {
  const messages = buildMessages(units, { ...context, batchToken: 'CONTEXT0000' }, 'batch');
  return messages.reduce((sum, message) => sum + estimateTokens(message.content) + 6, 0);
}

export function contextBoundedBatches(units, maxBatchSize, context, profile) {
  const maxItems = Math.max(1, Math.floor(Number(maxBatchSize) || 8));
  const promptBudget = contextPromptTokenBudget(profile);
  if (!promptBudget) {
    const batches = [];
    for (let index = 0; index < units.length; index += maxItems) batches.push(units.slice(index, index + maxItems));
    return batches;
  }
  const batches = [];
  let batch = [];
  for (const unit of units) {
    if (!batch.length) {
      batch = [unit];
      continue;
    }
    const candidate = [...batch, unit];
    if (candidate.length > maxItems || estimateBatchPromptTokens(candidate, context) > promptBudget) {
      batches.push(batch);
      batch = [unit];
    } else {
      batch = candidate;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function cacheContext(settings, profile, targetLang, domain, mode = 'batch') {
  const glossaryFingerprint = glossaryHash(settings.translation.glossary);
  return {
    targetLang,
    profileId: profile.id,
    model: profile.model ?? '',
    promptVersion: promptVersionForSettings(settings, mode),
    glossaryFingerprint,
    normalizeRules: settings.cache.normalizeRules
  };
}

export class TranslationService {
  constructor({ getSettings, onError = null } = {}) {
    this.getSettings = getSettings;
    this.onError = onError;
    this.recentRequests = [];
    this.recentErrors = [];
    this.prefetchStats = { pagesWarmed: 0, tokensSpent: 0, hits: 0, saved: 0 };
  }

  settings() {
    return this.getSettings();
  }

  logRequest(entry) {
    this.recentRequests.unshift({ ...entry, timestamp: Date.now() });
    this.recentRequests = this.recentRequests.slice(0, 50);
  }

  logError(error, profile = null) {
    const value = {
      kind: error?.kind ?? 'error',
      message: String(error?.message ?? error).slice(0, 500),
      detail: error?.detail ? String(error.detail).slice(0, 500) : null,
      profileId: profile?.id ?? null,
      profileName: profile?.name ?? null,
      timestamp: Date.now()
    };
    this.recentErrors.unshift(value);
    this.recentErrors = this.recentErrors.slice(0, 50);
    this.onError?.(error);
  }

  async lookupCache(units, settings, profile, targetLang, domain, mode = 'batch') {
    if (!settings.cache.enabled) return units.map(() => null);
    const context = cacheContext(settings, profile, targetLang, domain, mode);
    const keys = units.map((unit) => makeTmKey({
      text: unit.text,
      ...context
    }));
    let records = [];
    try { records = await cacheStore.tmGetMany(keys); } catch (error) { this.logError(error, profile); }
    return records.map((record, index) => {
      if (!record) return null;
      if (Number.isFinite(settings.cache.ttlMs) && settings.cache.ttlMs >= 0 && Date.now() - Number(record.lastUsed ?? 0) > settings.cache.ttlMs) {
        cacheStore.tmDeleteMany([keys[index]]).catch(() => {});
        return null;
      }
      return { record, key: keys[index] };
    });
  }

  async storeCache(units, translations, settings, profile, targetLang, domain, srcLang, mode = 'batch') {
    if (!settings.cache.enabled) return;
    const context = cacheContext(settings, profile, targetLang, domain, mode);
    const records = [];
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      const translation = translations.get(index) ?? translations.get(String(index));
      if (typeof translation !== 'string' || !translation.trim()) continue;
      const key = makeTmKey({ text: unit.text, ...context });
      const normalizedText = normalizeForLookup(unit.text, settings.cache.normalizeRules);
      const record = {
        key,
        translation,
        normalizedText,
        srcLang: unit.srcLang ?? srcLang ?? null,
        tgtLang: targetLang,
        profileId: profile.id,
        promptVersion: context.promptVersion,
        styleId: null,
        model: profile.model ?? '',
        glossaryHash: context.glossaryFingerprint,
        domains: domain ? [domain] : [],
        createdAt: Date.now(),
        lastUsed: Date.now()
      };
      record.bytes = recordSize(record);
      records.push(record);
    }
    if (records.length) {
      try { await cacheStore.tmPutMany(records); } catch (error) { this.logError(error, profile); }
      try { await cacheStore.evict({ diskCapBytes: settings.cache.diskCapBytes, ttlMs: settings.cache.ttlMs }); } catch { /* best effort */ }
    }
  }

  async chooseProfile(settings, domain, role, preferredId) {
    const preferred = preferredId ?? resolveSiteProfileId(settings, domain, role);
    const profile = primaryProfile(settings, role, preferred);
    return profile ?? null;
  }

  async callWithFallback(profile, request, domain, settings) {
    const candidates = [profile];
    const fallback = fallbackProfile(settings, profile?.id);
    if (fallback) candidates.push(fallback);
    let lastError = null;
    for (const candidate of candidates) {
      if (!candidate) continue;
      const adapter = createAdapter(candidate);
      const started = performance.now();
      try {
        const result = await adapter.chat({
          ...request,
          model: request.model ?? candidate.model,
          reasoningEffort: reasoningEffort(candidate),
          timeoutMs: candidate.timeoutMs
        });
        this.logRequest({
          profileId: candidate.id,
          profileName: candidate.name,
          durationMs: Math.round(performance.now() - started),
          promptTokens: result.usage?.promptTokens ?? null,
          completionTokens: result.usage?.completionTokens ?? null,
          status: 'ok'
        });
        return { result, profile: candidate };
      } catch (error) {
        lastError = error;
        this.logRequest({
          profileId: candidate.id,
          profileName: candidate.name,
          durationMs: Math.round(performance.now() - started),
          promptTokens: null,
          completionTokens: null,
          status: 'error'
        });
        this.logError(error, candidate);
      }
    }
    throw lastError ?? new ProviderError('No provider profile is available', { kind: 'config' });
  }

  async translateBatch(units, context, signal) {
    const settings = this.settings();
    const { domain, targetLang, profileRole = 'primary', preferredProfileId = null } = context;
    const profile = await this.chooseProfile(settings, domain, profileRole, preferredProfileId);
    if (!profile) throw new ProviderError('No translation profile is configured', { kind: 'config' });
    const batchToken = createBatchToken(units, context.batchToken);
    const request = {
      messages: buildMessages(units, { ...context, settings, batchToken }, 'batch'),
      model: profile.model,
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
      responseFormat: 'prompt-only',
      signal,
      timeoutMs: profile.timeoutMs,
      reasoningEffort: reasoningEffort(profile),
      extraBody: profile.rawRequestJson ? undefined : undefined
    };
    const { result, profile: usedProfile } = await this.callWithFallback(profile, request, domain, settings);
    const rows = parseBatchResponse(result.content, units.length, batchToken);
    const translations = new Map();
    for (const row of rows) {
      if (row.i >= 0 && row.i < units.length) translations.set(row.i, row.t);
    }
    return { translations, profile: usedProfile };
  }

  async translateSingle(text, context = {}, signal) {
    const settings = this.settings();
    const {
      domain = '', targetLang, profileRole = 'selection', preferredProfileId = null, sourceLang = null
    } = context;
    const profile = await this.chooseProfile(settings, domain, profileRole, preferredProfileId);
    if (!profile) throw new ProviderError('No single-text translation profile is configured', { kind: 'config' });
    const selectedTargetLang = targetLang ?? settings.translation.targetLang;
    const adapter = createAdapter(profile);
    const request = {
      messages: buildMessages(
        [{ id: 'single', kind: 'text', text: String(text ?? ''), srcLang: sourceLang }],
        { ...context, settings, targetLang: selectedTargetLang },
        'single'
      ),
      model: profile.model,
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
      responseFormat: 'prompt-only',
      signal,
      timeoutMs: profile.timeoutMs,
      reasoningEffort: reasoningEffort(profile),
      extraBody: undefined
    };
    const { result, profile: usedProfile } = await this.callWithFallback(profile, request, domain, settings);
    const translation = String(result.content ?? '').trim();
    if (!translation) throw new ProviderError('Selection translation returned no text', { kind: 'malformed' });
    return { text: translation, profile: usedProfile };
  }

  async translateUnits(units, context = {}) {
    const settings = this.settings();
    const targetLang = context.targetLang ?? settings.translation.targetLang;
    const domain = context.domain ?? '';
    const profileRole = context.profileRole ?? 'primary';
    const signal = context.signal;
    const onSegment = context.onSegment ?? (() => {});
    const onProgress = context.onProgress ?? (() => {});
    const profile = await this.chooseProfile(settings, domain, profileRole, context.preferredProfileId);
    if (!profile) throw new ProviderError('No translation profile is configured', { kind: 'config' });

    const uniqueUnits = [...new Map(units.map((unit) => [unit.id, unit])).values()];
    const cacheHits = await this.lookupCache(uniqueUnits, settings, profile, targetLang, domain);
    const misses = [];
    let completed = 0;
    for (let index = 0; index < uniqueUnits.length; index += 1) {
      const unit = uniqueUnits[index];
      const hit = cacheHits[index];
      if (hit) {
        onSegment({ unitId: unit.id, kind: unit.kind ?? 'text', text: hit.record.translation, hit: true, attribute: unit.attribute ?? null });
        completed += 1;
        this.prefetchStats.hits += 1;
      } else {
        misses.push(unit);
      }
    }
    onProgress({ done: completed, total: uniqueUnits.length });

    const batchSize = Math.max(1, Number(profile.batchSize) || 8);
    const plannedBatches = contextBoundedBatches(misses, batchSize, {
      ...context,
      settings,
      targetLang,
      sourceLang: misses.map((unit) => unit.srcLang).find(Boolean) ?? null
    }, profile);
    for (const batch of plannedBatches) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const batchContext = {
        ...context,
        settings,
        targetLang,
        domain,
        profileRole,
        sourceLang: batch.map((unit) => unit.srcLang).find(Boolean) ?? null
      };
      let translations;
      let usedProfile;
      try {
        const result = await this.translateBatch(batch, batchContext, signal);
        translations = result.translations;
        usedProfile = result.profile;
      } catch (error) {
        if (error?.kind !== 'malformed') throw error;
        // Weak models occasionally copy delimiters incorrectly. Degrade only
        // on a parse failure, not on auth/network errors, and translate every
        // block independently so one malformed response cannot fail the page.
        this.logError(error, profile);
        translations = new Map();
        usedProfile = profile;
        for (let index = 0; index < batch.length; index += 1) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const unit = batch[index];
          const fallback = await this.translateSingle(unit.text, {
            domain,
            targetLang,
            sourceLang: unit.srcLang,
            profileRole,
            preferredProfileId: profile.id
          }, signal);
          translations.set(index, fallback.text);
          usedProfile = fallback.profile;
        }
      }
      const rendered = new Map();
      for (let index = 0; index < batch.length; index += 1) {
        const unit = batch[index];
        const translation = translations.get(index);
        if (typeof translation !== 'string' || !translation.trim()) continue;
        rendered.set(index, translation);
        onSegment({ unitId: unit.id, kind: unit.kind ?? 'text', text: translation, hit: false, refined: false, attribute: unit.attribute ?? null });
        completed += 1;
      }
      await this.storeCache(batch, rendered, settings, usedProfile, targetLang, domain, batch.map((unit) => unit.srcLang).find(Boolean) ?? null);
      onProgress({ done: completed, total: uniqueUnits.length });
    }
    return { done: completed, total: uniqueUnits.length, profile };
  }

  async translateSelection(text, { url, requestId, targetLang, sourceLang = null, signal } = {}) {
    const settings = this.settings();
    const domain = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
    const profile = await this.chooseProfile(settings, domain, 'selection', null);
    if (!profile) throw new ProviderError('No selection profile is configured', { kind: 'config' });
    const selectedTargetLang = targetLang ?? settings.translation.targetLang;
    const unit = {
      id: `selection-${requestId ?? stableHash(text)}`,
      kind: 'text',
      text,
      srcLang: sourceLang,
      zone: 'main',
      attribute: null
    };
    const hits = await this.lookupCache([unit], settings, profile, selectedTargetLang, domain, 'single');
    if (hits[0]) return { text: hits[0].record.translation, profileId: profile.id };

    const result = await this.translateSingle(text, {
      domain,
      targetLang: selectedTargetLang,
      sourceLang,
      profileRole: 'selection',
      preferredProfileId: profile.id
    }, signal);
    await this.storeCache(
      [unit],
      new Map([[0, result.text]]),
      settings,
      result.profile,
      selectedTargetLang,
      domain,
      sourceLang,
      'single'
    );
    return { text: result.text, profileId: result.profile.id };
  }

  async probe(profile) {
    const { probeProfile } = await import('./providers/index.js');
    return probeProfile(profile);
  }

  async testConnection(profile) {
    const { testConnection } = await import('./providers/index.js');
    return testConnection(profile);
  }

  async diagnostics() {
    let stats = null;
    try { stats = await cacheStore.statsGet(); } catch { /* optional */ }
    return {
      requests: [...this.recentRequests],
      errors: [...this.recentErrors],
      prefetch: { ...this.prefetchStats },
      cacheStats: stats,
      fixedProbe: FIXED_PROBE
    };
  }
}

export async function testTranslationPrompt({
  settings,
  mode = 'batch',
  texts = [],
  batchSize = 8,
  sourceLang = null
} = {}) {
  const promptMode = mode === 'single' ? 'single' : 'batch';
  const profile = primaryProfile(settings, 'primary', null);
  if (!profile) throw new ProviderError('No primary translation profile is configured', { kind: 'config' });
  const normalizedTexts = (Array.isArray(texts) ? texts : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 64);
  if (!normalizedTexts.length) throw new ProviderError('Prompt test requires at least one non-empty text segment', { kind: 'config' });
  const requestedBatchSize = Math.max(1, Math.min(32, Math.floor(Number(batchSize) || 1)));
  const service = new TranslationService({ getSettings: () => settings });
  const targetLang = settings.translation.targetLang;
  const started = performance.now();
  if (promptMode === 'single') {
    const result = await service.translateSingle(normalizedTexts[0], {
      domain: '',
      targetLang,
      sourceLang,
      profileRole: 'primary',
      preferredProfileId: profile.id
    });
    return {
      mode: promptMode,
      profileId: result.profile.id,
      profileName: result.profile.name,
      durationMs: Math.round(performance.now() - started),
      requestedBatchSize: 1,
      rows: [{ index: 0, source: normalizedTexts[0], translation: result.text }]
    };
  }
  const units = normalizedTexts.slice(0, requestedBatchSize).map((text, index) => ({
    id: `prompt-test-${index + 1}`,
    kind: 'text',
    text,
    srcLang: sourceLang
  }));
  const result = await service.translateBatch(units, {
    domain: '',
    targetLang,
    sourceLang,
    profileRole: 'primary',
    preferredProfileId: profile.id
  });
  const rows = units.map((unit, index) => ({
    index,
    source: unit.text,
    translation: result.translations.get(index) ?? null
  }));
  if (rows.some((row) => typeof row.translation !== 'string' || !row.translation.trim())) {
    throw new ProviderError('Prompt test batch returned an incomplete translation set', { kind: 'malformed' });
  }
  return {
    mode: promptMode,
    profileId: result.profile.id,
    profileName: result.profile.name,
    durationMs: Math.round(performance.now() - started),
    requestedBatchSize,
    rows
  };
}

export { PROMPT_VERSION, buildMessages };

