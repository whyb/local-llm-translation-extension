import { storageGet, storageSet, onStorageChanged } from './browser.js';
import { DEFAULT_TARGET_LANGUAGE } from './languages.js';
import { DEFAULT_PROMPT_TEMPLATES, LEGACY_PROMPT_TEMPLATES, PROMPT_CONTRACT_VERSION } from './prompt.js';
import { DEFAULT_ERROR_LOG_LEVEL, DEFAULT_ERROR_RETENTION_DAYS, ERROR_LOG_LEVELS } from './error-log.js';

export const APP_VERSION = '2.0.3';
export const SETTINGS_KEY = 'lbt.settings';
export const SETTINGS_VERSION = 4;
export const PROMPT_VERSION = PROMPT_CONTRACT_VERSION;
export const ALL_URLS = '<all_urls>';

export const ADAPTERS = ['openai', 'llamacpp', 'ollama', 'vllm', 'sglang', 'anthropic', 'gemini'];
export const ADAPTER_DEFAULT_BASE_URLS = Object.freeze({
  openai: 'https://api.openai.com/v1',
  llamacpp: 'http://127.0.0.1:8080/v1',
  ollama: 'http://localhost:11434/v1',
  vllm: 'http://localhost:8000/v1',
  sglang: 'http://127.0.0.1:30000/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com'
});
export const ROLES = ['primary', 'fallback', 'selection', 'prefetch'];
export const RENDER_MODES = ['replace', 'bilingual-stacked', 'replace-hover-reveal'];
export const SITE_POLICIES = ['auto', 'ask', 'never'];
export const STRUCTURED_OUTPUT_MODES = ['auto', 'json_schema', 'json_object', 'prompt-only'];
export const REASONING_MODES = ['off', 'default', 'custom'];
export const REASONING_EFFORTS = ['off', 'low', 'medium', 'high', 'max'];
export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const SUPPORTED_LOCALES = Object.freeze([
  'en',
  'zh-TW',
  'zh-CN',
  'ja',
  'ko',
  'pt',
  'es',
  'fr',
  'de',
  'it',
  'el',
  'th',
  'id',
  'hi',
  'ru',
  'ar',
  'tr',
  'vi',
  'bn',
  'ur',
  'fa',
  'sw'
]);

export const TRACKING_PARAMS = [
  'utm_*', 'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid',
  'yclid', 'twclid', 'ttclid', 'mc_cid', 'mc_eid', 'igshid', '_ga', '_gl',
  '_hsenc', '_hsmi', 'hsctatracking', 'mkt_tok', 's_cid', 'vero_id', 'wickedid',
  'oly_anon_id', 'oly_enc_id', 'jsessionid', 'phpsessid', 'aspsessionid*',
  'sid', 'sessid', 'session', 'sessionid', 'session_id'
];

const ATTRIBUTE_DEFAULTS = {
  enabled: true,
  title: false,
  alt: false,
  placeholder: true,
  ariaLabel: false,
  buttonValue: true
};

export const DEFAULT_CONTEXT_LENGTH = 65535;

export function createDefaultProfile(index = 0, role = index === 0 ? 'primary' : 'fallback', adapter = 'openai') {
  const normalizedAdapter = ADAPTERS.includes(adapter) ? adapter : 'openai';
  return {
    id: `profile-${index + 1}`,
    name: `Provider ${index + 1}`,
    role,
    adapter: normalizedAdapter,
    baseUrl: ADAPTER_DEFAULT_BASE_URLS[normalizedAdapter],
    apiKey: null,
    model: null,
    contextLength: DEFAULT_CONTEXT_LENGTH,
    batchSize: 8,
    maxInFlight: 1,
    timeoutMs: 120000,
    retries: 2,
    temperature: 0.2,
    maxTokens: null,
    structuredOutput: 'auto',
    streaming: true,
    reasoning: { mode: 'off', effort: null },
    rawRequestJson: null
  };
}

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  providers: {
    profiles: [createDefaultProfile(0)],
    selectedProfileId: null,
    autoProbeOnSave: true,
    hardErrorThreshold: 3
  },
  translation: {
    targetLang: DEFAULT_TARGET_LANGUAGE,
    promptTemplates: {
      batch: DEFAULT_PROMPT_TEMPLATES.batch,
      single: DEFAULT_PROMPT_TEMPLATES.single
    },
    renderMode: 'replace',
    autoTranslateDynamic: true,
    formality: 'default',
    glossary: [],
    customPromptAdditions: '',
    pinCustomPromptToPrefix: false,
    layoutGuards: {
      whitespace: true,
      bidi: true,
      clippedExpansion: true,
      rubyWbr: true,
      maxExpansionRatio: 1.5
    }
  },
  cache: {
    enabled: true,
    diskCapBytes: 268435456,
    hotTierWatermarkEntries: 20000,
    normalizedMatching: true,
    normalizeRules: {
      collapseWhitespace: true,
      stripNbspAndZeroWidth: true,
      foldQuotesAndDashes: true,
      decodeEntities: true,
      tolerateTrailingPunctuation: true,
      caseFoldMaxLength: 24
    },
    crossSiteReuse: true,
    ttlMs: null,
    invalidateOn: {
      promptVersion: true,
      modelChange: true,
      targetLangChange: true,
      glossaryChange: true
    },
    urlNormalisation: {
      enabled: true,
      stripParams: [...TRACKING_PARAMS],
      stripFragment: true,
      domainOverrides: []
    }
  },
  speed: {
    zoneWeights: {
      main: 1,
      heading: 1,
      nav: 0.5,
      aside: 0.3,
      related: 0.2,
      footer: 0.1,
      ad: 0.02,
      boilerplate: 0.05
    },
    prefetch: {
      hoverPrefetch: false,
      hoverPrefetchMaxPages: 2,
      boilerplatePriming: true,
      maxPagesInFlight: 1,
      maxTokensPerMinute: 20000,
      pauseOnBatterySaver: true,
      pauseOnMeteredConnection: true,
      nextNavPrediction: false,
      nextNavMaxLinks: 1,
      nextNavLongReadMinChars: 6000,
      nextNavMinScore: 50,
      metricsEnabled: true,
      metricsRetentionMinutes: 60
    },
    autoTune: {
      enabled: true,
      pins: {},
      timeToVisibleBudgetMs: 5000,
      minBatchSize: 1,
      maxBatchSize: 32
    },
    streamingCommit: true,
    runaway: {
      enabled: true,
      pageUnitCeiling: 100000,
      perMinuteTokenCeiling: 60000,
      responseExpansionRatio: 2,
      responseMinOutputTokens: 256,
      mutationStormDetection: true,
      mutationStormWindowMs: 3000,
      mutationStormMaxMutations: 300,
      maxFrameJoinReopens: 5
    },
    contentMemory: { maxRetainedOriginals: 5000 }
  },
  appearance: {
    uiLocale: null,
    floatingButtonEnabled: true,
    floatingButtonCorner: 'bottom-right',
    selectionButtonEnabled: true
  },
  behaviour: {
    autoTranslateDefault: 'ask',
    allSitesEnabled: false,
    hotkeys: {
      translateSelection: null,
      toggleRenderMode: null
    },
    siteRules: [],
    enabledSites: []
  },
  exclusions: {
    structural: true,
    perSegmentLanguage: true,
    nonLinguistic: true,
    zones: {
      ads: false,
      cookieBanners: true,
      editableFields: true,
      thirdPartyIframes: false,
      hiddenContent: true
    },
    domainSelectorRules: [],
    attributes: { ...ATTRIBUTE_DEFAULTS },
    language: { inheritPageLanguage: true }
  },
  diagnostics: {
    errorLogLevel: DEFAULT_ERROR_LOG_LEVEL,
    errorRetentionDays: DEFAULT_ERROR_RETENTION_DAYS
  }
};

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value, fallback = null) {
  return value === null || typeof value === 'string' ? value : fallback;
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value, fallback = null) {
  return value === null ? null : Number.isFinite(value) ? value : fallback;
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function enumOr(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeProfile(raw, index, roleFallback) {
  const base = createDefaultProfile(index, roleFallback);
  const value = isObject(raw) ? raw : {};
  return {
    id: stringOr(value.id, base.id) || base.id,
    name: stringOr(value.name, base.name) || base.name,
    role: enumOr(value.role, ROLES, base.role),
    adapter: enumOr(value.adapter, ADAPTERS, base.adapter),
    baseUrl: stringOr(value.baseUrl, base.baseUrl),
    apiKey: nullableString(value.apiKey, base.apiKey),
    model: nullableString(value.model, base.model),
    contextLength: Math.max(1, Math.floor(numberOr(value.contextLength, base.contextLength))),
    batchSize: Math.max(1, Math.floor(numberOr(value.batchSize, base.batchSize))),
    maxInFlight: Math.max(1, Math.floor(numberOr(value.maxInFlight, base.maxInFlight))),
    timeoutMs: Math.max(1000, Math.floor(numberOr(value.timeoutMs, base.timeoutMs))),
    retries: Math.max(0, Math.floor(numberOr(value.retries, base.retries))),
    temperature: nullableNumber(value.temperature, base.temperature),
    maxTokens: nullableNumber(value.maxTokens, base.maxTokens),
    structuredOutput: enumOr(value.structuredOutput, STRUCTURED_OUTPUT_MODES, base.structuredOutput),
    streaming: boolOr(value.streaming, base.streaming),
    reasoning: {
      mode: enumOr(value.reasoning?.mode, REASONING_MODES, base.reasoning.mode),
      effort: value.reasoning?.effort === null || REASONING_EFFORTS.includes(value.reasoning?.effort)
        ? value.reasoning.effort
        : base.reasoning.effort
    },
    rawRequestJson: nullableString(value.rawRequestJson, base.rawRequestJson)
  };
}

function normalizeGlossary(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => isObject(entry) && typeof entry.source === 'string')
    .map((entry) => ({
      source: entry.source,
      replacement: entry.replacement === null || typeof entry.replacement === 'string' ? entry.replacement : null
    }))
    .filter((entry) => entry.source.trim() !== '');
}

function normalizeDomainRules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => isObject(entry) && typeof entry.domain === 'string')
    .map((entry) => ({
      domain: entry.domain.trim().toLowerCase(),
      allow: Array.isArray(entry.allow) ? entry.allow.filter((item) => typeof item === 'string') : [],
      deny: Array.isArray(entry.deny) ? entry.deny.filter((item) => typeof item === 'string') : []
    }))
    .filter((entry) => entry.domain !== '');
}

function normalizeSiteRules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => isObject(entry) && typeof entry.domain === 'string')
    .map((entry) => ({
      domain: entry.domain.trim().toLowerCase(),
      url: typeof entry.url === 'string' ? entry.url : null,
      policy: entry.policy === null || SITE_POLICIES.includes(entry.policy) ? entry.policy : null,
      targetLang: nullableString(entry.targetLang),
      profileId: nullableString(entry.profileId),
      neverSend: boolOr(entry.neverSend, false)
    }))
    .filter((entry) => entry.domain !== '');
}

function normalizeDomainOverrides(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => isObject(entry) && typeof entry.domain === 'string')
    .map((entry) => ({
      domain: entry.domain.trim().toLowerCase(),
      keepParams: Array.isArray(entry.keepParams) ? entry.keepParams.filter((item) => typeof item === 'string') : [],
      keepFragment: boolOr(entry.keepFragment, false)
    }))
    .filter((entry) => entry.domain !== '');
}

function normalizePromptTemplates(translation) {
  const value = isObject(translation) ? translation : {};
  const legacy = typeof value.promptTemplate === 'string' && value.promptTemplate.trim()
    ? value.promptTemplate
    : null;
  const templates = isObject(value.promptTemplates) ? value.promptTemplates : {};
  const normalize = (candidate, fallback, previousDefault) => {
    if (typeof candidate !== 'string' || !candidate.trim()) return fallback;
    return candidate === previousDefault ? fallback : candidate;
  };
  const legacyBatch = legacy === LEGACY_PROMPT_TEMPLATES.batch ? DEFAULT_PROMPT_TEMPLATES.batch : legacy;
  const legacySingle = legacy === LEGACY_PROMPT_TEMPLATES.single ? DEFAULT_PROMPT_TEMPLATES.single : legacy;
  return {
    batch: normalize(
      templates.batch,
      legacyBatch ?? DEFAULT_PROMPT_TEMPLATES.batch,
      LEGACY_PROMPT_TEMPLATES.batch
    ),
    single: normalize(
      templates.single,
      legacySingle ?? DEFAULT_PROMPT_TEMPLATES.single,
      LEGACY_PROMPT_TEMPLATES.single
    )
  };
}

export function normalizeSettings(raw) {
  const input = isObject(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const legacySettings = !Number.isFinite(input.version) || input.version < SETTINGS_VERSION;
  const legacyDefaultPageCeiling = legacySettings && [500, 5000].includes(Number(input.speed?.runaway?.pageUnitCeiling));
  const profiles = Array.isArray(input.providers?.profiles)
    ? input.providers.profiles.map((profile, index) => normalizeProfile(profile, index, index === 0 ? 'primary' : 'fallback'))
    : d.providers.profiles.map((profile) => ({ ...profile, reasoning: { ...profile.reasoning } }));
  const selectedProfileId = typeof input.providers?.selectedProfileId === 'string'
    && profiles.some((profile) => profile.id === input.providers.selectedProfileId)
    ? input.providers.selectedProfileId
    : null;
  const promptTemplates = normalizePromptTemplates(input.translation);

  return {
    version: SETTINGS_VERSION,
    providers: {
      profiles,
      selectedProfileId,
      autoProbeOnSave: boolOr(input.providers?.autoProbeOnSave, d.providers.autoProbeOnSave),
      hardErrorThreshold: Math.max(1, Math.floor(numberOr(input.providers?.hardErrorThreshold, d.providers.hardErrorThreshold)))
    },
    translation: {
      targetLang: stringOr(input.translation?.targetLang, d.translation.targetLang) || d.translation.targetLang,
      promptTemplates,
      renderMode: enumOr(input.translation?.renderMode, RENDER_MODES, d.translation.renderMode),
      autoTranslateDynamic: boolOr(input.translation?.autoTranslateDynamic, d.translation.autoTranslateDynamic),
      formality: enumOr(input.translation?.formality, ['default', 'informal', 'formal'], d.translation.formality),
      glossary: normalizeGlossary(input.translation?.glossary),
      customPromptAdditions: stringOr(input.translation?.customPromptAdditions, ''),
      pinCustomPromptToPrefix: boolOr(input.translation?.pinCustomPromptToPrefix, false),
      layoutGuards: {
        whitespace: boolOr(input.translation?.layoutGuards?.whitespace, d.translation.layoutGuards.whitespace),
        bidi: boolOr(input.translation?.layoutGuards?.bidi, d.translation.layoutGuards.bidi),
        clippedExpansion: boolOr(input.translation?.layoutGuards?.clippedExpansion, d.translation.layoutGuards.clippedExpansion),
        rubyWbr: boolOr(input.translation?.layoutGuards?.rubyWbr, d.translation.layoutGuards.rubyWbr),
        maxExpansionRatio: Math.max(1, numberOr(input.translation?.layoutGuards?.maxExpansionRatio, d.translation.layoutGuards.maxExpansionRatio))
      }
    },
    cache: {
      enabled: boolOr(input.cache?.enabled, d.cache.enabled),
      diskCapBytes: Math.max(1048576, Math.floor(numberOr(input.cache?.diskCapBytes, d.cache.diskCapBytes))),
      hotTierWatermarkEntries: Math.max(0, Math.floor(numberOr(input.cache?.hotTierWatermarkEntries, d.cache.hotTierWatermarkEntries))),
      normalizedMatching: boolOr(input.cache?.normalizedMatching, d.cache.normalizedMatching),
      normalizeRules: {
        collapseWhitespace: boolOr(input.cache?.normalizeRules?.collapseWhitespace, d.cache.normalizeRules.collapseWhitespace),
        stripNbspAndZeroWidth: boolOr(input.cache?.normalizeRules?.stripNbspAndZeroWidth, d.cache.normalizeRules.stripNbspAndZeroWidth),
        foldQuotesAndDashes: boolOr(input.cache?.normalizeRules?.foldQuotesAndDashes, d.cache.normalizeRules.foldQuotesAndDashes),
        decodeEntities: boolOr(input.cache?.normalizeRules?.decodeEntities, d.cache.normalizeRules.decodeEntities),
        tolerateTrailingPunctuation: boolOr(input.cache?.normalizeRules?.tolerateTrailingPunctuation, d.cache.normalizeRules.tolerateTrailingPunctuation),
        caseFoldMaxLength: Math.max(0, Math.floor(numberOr(input.cache?.normalizeRules?.caseFoldMaxLength, d.cache.normalizeRules.caseFoldMaxLength)))
      },
      crossSiteReuse: boolOr(input.cache?.crossSiteReuse, d.cache.crossSiteReuse),
      ttlMs: nullableNumber(input.cache?.ttlMs, d.cache.ttlMs),
      invalidateOn: {
        promptVersion: boolOr(input.cache?.invalidateOn?.promptVersion, true),
        modelChange: boolOr(input.cache?.invalidateOn?.modelChange, true),
        targetLangChange: boolOr(input.cache?.invalidateOn?.targetLangChange, true),
        glossaryChange: boolOr(input.cache?.invalidateOn?.glossaryChange, true)
      },
      urlNormalisation: {
        enabled: boolOr(input.cache?.urlNormalisation?.enabled, d.cache.urlNormalisation.enabled),
        stripParams: Array.isArray(input.cache?.urlNormalisation?.stripParams)
          ? input.cache.urlNormalisation.stripParams.filter((item) => typeof item === 'string')
          : [...d.cache.urlNormalisation.stripParams],
        stripFragment: boolOr(input.cache?.urlNormalisation?.stripFragment, true),
        domainOverrides: normalizeDomainOverrides(input.cache?.urlNormalisation?.domainOverrides)
      }
    },
    speed: {
      zoneWeights: {
        main: numberOr(input.speed?.zoneWeights?.main, d.speed.zoneWeights.main),
        heading: numberOr(input.speed?.zoneWeights?.heading, d.speed.zoneWeights.heading),
        nav: numberOr(input.speed?.zoneWeights?.nav, d.speed.zoneWeights.nav),
        aside: numberOr(input.speed?.zoneWeights?.aside, d.speed.zoneWeights.aside),
        related: numberOr(input.speed?.zoneWeights?.related, d.speed.zoneWeights.related),
        footer: numberOr(input.speed?.zoneWeights?.footer, d.speed.zoneWeights.footer),
        ad: numberOr(input.speed?.zoneWeights?.ad, d.speed.zoneWeights.ad),
        boilerplate: numberOr(input.speed?.zoneWeights?.boilerplate, d.speed.zoneWeights.boilerplate)
      },
      prefetch: {
        hoverPrefetch: boolOr(input.speed?.prefetch?.hoverPrefetch, d.speed.prefetch.hoverPrefetch),
        hoverPrefetchMaxPages: Math.max(0, Math.floor(numberOr(input.speed?.prefetch?.hoverPrefetchMaxPages, d.speed.prefetch.hoverPrefetchMaxPages))),
        boilerplatePriming: boolOr(input.speed?.prefetch?.boilerplatePriming, d.speed.prefetch.boilerplatePriming),
        maxPagesInFlight: Math.max(0, Math.floor(numberOr(input.speed?.prefetch?.maxPagesInFlight, d.speed.prefetch.maxPagesInFlight))),
        maxTokensPerMinute: Math.max(0, Math.floor(numberOr(input.speed?.prefetch?.maxTokensPerMinute, d.speed.prefetch.maxTokensPerMinute))),
        pauseOnBatterySaver: boolOr(input.speed?.prefetch?.pauseOnBatterySaver, d.speed.prefetch.pauseOnBatterySaver),
        pauseOnMeteredConnection: boolOr(input.speed?.prefetch?.pauseOnMeteredConnection, d.speed.prefetch.pauseOnMeteredConnection),
        nextNavPrediction: boolOr(input.speed?.prefetch?.nextNavPrediction, d.speed.prefetch.nextNavPrediction),
        nextNavMaxLinks: Math.max(0, Math.floor(numberOr(input.speed?.prefetch?.nextNavMaxLinks, d.speed.prefetch.nextNavMaxLinks))),
        nextNavLongReadMinChars: Math.max(0, Math.floor(numberOr(input.speed?.prefetch?.nextNavLongReadMinChars, d.speed.prefetch.nextNavLongReadMinChars))),
        nextNavMinScore: Math.max(0, numberOr(input.speed?.prefetch?.nextNavMinScore, d.speed.prefetch.nextNavMinScore)),
        metricsEnabled: boolOr(input.speed?.prefetch?.metricsEnabled, d.speed.prefetch.metricsEnabled),
        metricsRetentionMinutes: Math.max(1, Math.floor(numberOr(input.speed?.prefetch?.metricsRetentionMinutes, d.speed.prefetch.metricsRetentionMinutes)))
      },
      autoTune: {
        enabled: boolOr(input.speed?.autoTune?.enabled, d.speed.autoTune.enabled),
        pins: isObject(input.speed?.autoTune?.pins) ? input.speed.autoTune.pins : {},
        timeToVisibleBudgetMs: Math.max(1, numberOr(input.speed?.autoTune?.timeToVisibleBudgetMs, d.speed.autoTune.timeToVisibleBudgetMs)),
        minBatchSize: Math.max(1, Math.floor(numberOr(input.speed?.autoTune?.minBatchSize, d.speed.autoTune.minBatchSize))),
        maxBatchSize: Math.max(1, Math.floor(numberOr(input.speed?.autoTune?.maxBatchSize, d.speed.autoTune.maxBatchSize)))
      },
      streamingCommit: boolOr(input.speed?.streamingCommit, d.speed.streamingCommit),
      runaway: {
        enabled: boolOr(input.speed?.runaway?.enabled, d.speed.runaway.enabled),
        pageUnitCeiling: Math.min(100000, Math.max(0, Math.floor(numberOr(
          legacyDefaultPageCeiling ? d.speed.runaway.pageUnitCeiling : input.speed?.runaway?.pageUnitCeiling,
          d.speed.runaway.pageUnitCeiling
        )))),
        perMinuteTokenCeiling: Math.max(0, Math.floor(numberOr(input.speed?.runaway?.perMinuteTokenCeiling, d.speed.runaway.perMinuteTokenCeiling))),
        responseExpansionRatio: Math.max(1, numberOr(input.speed?.runaway?.responseExpansionRatio, d.speed.runaway.responseExpansionRatio)),
        responseMinOutputTokens: Math.max(0, Math.floor(numberOr(input.speed?.runaway?.responseMinOutputTokens, d.speed.runaway.responseMinOutputTokens))),
        mutationStormDetection: boolOr(input.speed?.runaway?.mutationStormDetection, d.speed.runaway.mutationStormDetection),
        mutationStormWindowMs: Math.max(100, Math.floor(numberOr(input.speed?.runaway?.mutationStormWindowMs, d.speed.runaway.mutationStormWindowMs))),
        mutationStormMaxMutations: Math.max(1, Math.floor(numberOr(input.speed?.runaway?.mutationStormMaxMutations, d.speed.runaway.mutationStormMaxMutations))),
        maxFrameJoinReopens: Math.max(0, Math.floor(numberOr(input.speed?.runaway?.maxFrameJoinReopens, d.speed.runaway.maxFrameJoinReopens)))
      },
      contentMemory: { maxRetainedOriginals: Math.max(100, Math.floor(numberOr(input.speed?.contentMemory?.maxRetainedOriginals, d.speed.contentMemory.maxRetainedOriginals))) }
    },
    appearance: {
      uiLocale: enumOr(input.appearance?.uiLocale, SUPPORTED_LOCALES, null),
      floatingButtonEnabled: boolOr(input.appearance?.floatingButtonEnabled, true),
      floatingButtonCorner: enumOr(input.appearance?.floatingButtonCorner, CORNERS, d.appearance.floatingButtonCorner),
      selectionButtonEnabled: boolOr(input.appearance?.selectionButtonEnabled, true)
    },
    behaviour: {
      autoTranslateDefault: enumOr(input.behaviour?.autoTranslateDefault, SITE_POLICIES, d.behaviour.autoTranslateDefault),
      allSitesEnabled: boolOr(input.behaviour?.allSitesEnabled, false),
      hotkeys: {
        translateSelection: nullableString(input.behaviour?.hotkeys?.translateSelection),
        toggleRenderMode: nullableString(input.behaviour?.hotkeys?.toggleRenderMode)
      },
      siteRules: normalizeSiteRules(input.behaviour?.siteRules),
      enabledSites: Array.isArray(input.behaviour?.enabledSites)
        ? input.behaviour.enabledSites.filter((item) => typeof item === 'string').map((item) => item.trim().toLowerCase()).filter(Boolean)
        : []
    },
    exclusions: {
      structural: boolOr(input.exclusions?.structural, true),
      perSegmentLanguage: boolOr(input.exclusions?.perSegmentLanguage, true),
      nonLinguistic: boolOr(input.exclusions?.nonLinguistic, true),
      zones: {
        ads: boolOr(input.exclusions?.zones?.ads, d.exclusions.zones.ads),
        cookieBanners: boolOr(input.exclusions?.zones?.cookieBanners, d.exclusions.zones.cookieBanners),
        editableFields: boolOr(input.exclusions?.zones?.editableFields, d.exclusions.zones.editableFields),
        thirdPartyIframes: boolOr(input.exclusions?.zones?.thirdPartyIframes, d.exclusions.zones.thirdPartyIframes),
        hiddenContent: boolOr(input.exclusions?.zones?.hiddenContent, d.exclusions.zones.hiddenContent)
      },
      domainSelectorRules: normalizeDomainRules(input.exclusions?.domainSelectorRules),
      attributes: {
        enabled: boolOr(input.exclusions?.attributes?.enabled, true),
        title: boolOr(input.exclusions?.attributes?.title, d.exclusions.attributes.title),
        alt: boolOr(input.exclusions?.attributes?.alt, d.exclusions.attributes.alt),
        placeholder: boolOr(input.exclusions?.attributes?.placeholder, d.exclusions.attributes.placeholder),
        ariaLabel: boolOr(input.exclusions?.attributes?.ariaLabel, d.exclusions.attributes.ariaLabel),
        buttonValue: boolOr(input.exclusions?.attributes?.buttonValue, d.exclusions.attributes.buttonValue)
      },
      language: { inheritPageLanguage: boolOr(input.exclusions?.language?.inheritPageLanguage, true) }
    },
    diagnostics: {
      errorLogLevel: enumOr(input.diagnostics?.errorLogLevel, ERROR_LOG_LEVELS, d.diagnostics.errorLogLevel),
      errorRetentionDays: Math.min(90, Math.max(1, Math.floor(numberOr(input.diagnostics?.errorRetentionDays, d.diagnostics.errorRetentionDays))))
    }
  };
}

export async function loadSettings() {
  const raw = await storageGet(SETTINGS_KEY);
  return normalizeSettings(raw);
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await storageSet(SETTINGS_KEY, normalized);
  return normalized;
}

export function subscribeSettings(handler) {
  return onStorageChanged((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    handler(normalizeSettings(changes[SETTINGS_KEY].newValue));
  });
}

/**
 * Content scripts never need provider credentials. Keep this subset explicit so
 * future settings additions do not accidentally leak API keys into page-adjacent
 * execution contexts.
 */
export function sanitizeSettingsForContent(settings) {
  const normalized = normalizeSettings(settings);
  return {
    translation: normalized.translation,
    speed: normalized.speed,
    appearance: normalized.appearance,
    behaviour: normalized.behaviour,
    exclusions: normalized.exclusions,
    cache: { urlNormalisation: normalized.cache.urlNormalisation }
  };
}

export function domainMatches(hostname, domain) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  const candidate = String(domain || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  if (!host || !candidate) return false;
  return host === candidate || host.endsWith(`.${candidate}`);
}

export function findSiteRule(settings, hostname) {
  return settings.behaviour.siteRules.find((rule) => domainMatches(hostname, rule.domain)) ?? null;
}

export function resolveSitePolicy(settings, hostname) {
  const rule = findSiteRule(settings, hostname);
  if (rule?.neverSend) return 'never';
  if (rule?.policy) return rule.policy;
  return settings.behaviour.autoTranslateDefault;
}

export function resolveSiteTargetLang(settings, hostname) {
  return findSiteRule(settings, hostname)?.targetLang ?? settings.translation.targetLang;
}

export function resolveSiteProfileId(settings, hostname, role = 'primary') {
  const rule = findSiteRule(settings, hostname);
  if (role === 'primary' && rule?.profileId) return rule.profileId;
  return null;
}



