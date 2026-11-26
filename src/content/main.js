/* Main page translator. Loaded after content/common.js at document_idle. */
(() => {
  'use strict';
  const LBT = globalThis.LBT;
  if (!LBT) return;
  const { api, state, Renderer, createDeliveryScheduler, sendMessage, getSettings, subscribeSettings, mark } = LBT;
  const renderer = new Renderer();
  const documentKey = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  state.documentKey = documentKey;
  let settings = state.settings;
  let runId = null;
  let lastRunId = null;
  let runUrl = location.href;
  let sessionHref = location.href;
  let sessionActive = false;
  let inventoryRevision = 0;
  let extractionTimer = null;
  let mutationObserver = null;
  let navTimer = null;
  let lastPageHref = location.href;
  let mutationCount = 0;
  let mutationWindowStart = Date.now();
  let lastSelection = null;
  let selectionRequestId = null;
  let runPaused = false;
  let ui = null;
  let extractionRoots = new Set();
  let panelTranslations = Object.freeze({});
  let panelLanguageOptions = Object.freeze([]);
  let panelUiLocale = 'en';
  let panelRequestedLocale = 'en';
  let panelTranslationRequest = 0;

  const GITHUB_URL = 'https://github.com/whyb/local-llm-translation-extension';
  const PANEL_TRANSLATION_KEYS = Object.freeze([
    'private by design',
    'Open settings',
    'CURRENT PAGE',
    'Current page',
    'Ready',
    '{done} done',
    '{total} total',
    '{percent}%',
    '{percent}% cache',
    '— cache',
    'Translate page',
    'Stop',
    'Revert',
    'TRANSLATE MODE',
    'What should happen on this site?',
    'All sites allowed',
    'Automatic',
    'Ask me',
    'Never',
    'Site translation mode',
    'Every allowed page translates automatically. You can still stop or revert it.',
    'Automatic applies only to sites you enable one by one.',
    'This site is blocked. Nothing will be read or sent.',
    'Manual mode never sends text until you press Translate.',
    'Advanced site rules →',
    'TRANSLATION',
    'Translation',
    'Target language',
    'Display mode',
    'Replace the original',
    'Bilingual — stacked',
    'Replace, hover to reveal',
    'Search languages or enter a custom tag',
    'Show language options',
    'Language options',
    'Custom values are accepted: type a language name or BCP 47 tag.',
    'No built-in match. Press Enter or leave the field to use the entered value.',
    'Save failed: {error}',
    'Site access required',
    'Allow access to all websites once. Nothing is read or changed until you allow it.',
    'Allow all sites',
    'GitHub',
    'Local LLM Translator Pro — {done}/{total} ({percent}%)',
    'Local LLM Translator Pro — translating',
    'Starting translation…',
    'Could not reach the translation service: {error}',
    'Translation stopped.',
    'Original text restored.',
    'Site translation mode updated.',
    'Could not update site mode.',
    'Could not update site mode: {error}',
    'Translation failed.',
    'Translation paused.',
    'Display: {mode}',
    'Paused: too many page mutations.',
    'Applying translations to the page… {done} / {translated}',
    'Translating {pending} new or remaining segments…',
    'Translating page…',
    'Translation complete.',
    '{count} new segments waiting. Enable automatic translation or click Translate.',
    'New content detected. Preparing translation…',
    'Translate selection',
    'Translating…',
    'Translated',
    'Selection translation failed.',
    'Selection',
    'Copy',
    'Copied',
    'Replace selection',
    'Close'
  ]);

  const deliveryScheduler = createDeliveryScheduler({
    applySegment: (segment) => mutateWithoutObservation(() => renderer.apply(segment.unitId, segment.text)),
    onAck: (unitIds) => acknowledgeSegments(unitIds),
    isActive: () => Boolean(runId && sessionActive && !runPaused && location.href === sessionHref),
    onFirstApplied: () => mark('lbt:first-segment-committed')
  });

  const SHADOW_CSS = `
    :host {
      all: initial;
      color-scheme: light dark;
      --lbt-bg: #f4f6fb;
      --lbt-card: #ffffff;
      --lbt-ink: #172033;
      --lbt-muted: #6e7a91;
      --lbt-line: #dfe5ef;
      --lbt-accent: #2563eb;
      --lbt-accent-2: #7c3aed;
      --lbt-accent-soft: #edf2ff;
      --lbt-danger: #b42318;
      --lbt-success: #16835a;
      --lbt-shadow: 0 18px 50px rgba(28,42,75,.14);
    }
    @media (prefers-color-scheme: dark) {
      :host { --lbt-bg: #0c1220; --lbt-card: #151d2d; --lbt-ink: #f4f7ff; --lbt-muted: #9ba8c2; --lbt-line: #2a3650; --lbt-accent-soft: #17284a; --lbt-shadow: 0 18px 50px rgba(0,0,0,.34); }
    }
    * { box-sizing: border-box; }
    .lbt-floating { position: fixed; z-index: 2147483646; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--lbt-ink); }
    .lbt-floating[data-corner="top-left"] { left: 18px; top: 18px; align-items: flex-start; }
    .lbt-floating[data-corner="top-right"] { right: 18px; top: 18px; }
    .lbt-floating[data-corner="bottom-left"] { left: 18px; bottom: 18px; align-items: flex-start; }
    .lbt-floating[data-corner="bottom-right"] { right: 18px; bottom: 18px; }
    [hidden] { display: none !important; }
    .lbt-fab-shell { --lbt-fab-progress: 0%; width: 54px; height: 54px; padding: 4px; border-radius: 18px; background: conic-gradient(from -90deg, #67e8f9 var(--lbt-fab-progress), rgba(255,255,255,.2) 0); box-shadow: 0 14px 36px rgba(37,99,235,.32); transition: background .18s ease, box-shadow .18s ease, transform .18s ease; }
    .lbt-fab-shell[data-active="true"] { box-shadow: 0 16px 42px rgba(37,99,235,.45); }
    .lbt-fab-shell[data-complete="true"] { background: conic-gradient(#22c55e 0 100%); box-shadow: 0 14px 36px rgba(34,197,94,.34); }
    .lbt-fab-shell[data-indeterminate="true"] { animation: lbt-fab-ring-spin 1.35s linear infinite; background: conic-gradient(from -90deg, rgba(255,255,255,.14), #67e8f9 34%, rgba(255,255,255,.14) 70%, rgba(255,255,255,.14)); }
    .lbt-fab { position: relative; width: 46px; height: 46px; border-radius: 14px; border: 1px solid rgba(255,255,255,.48); background: #fff; cursor: pointer; display: block; overflow: hidden; padding: 0; }
    .lbt-fab-logo { width: 100%; height: 100%; display: block; object-fit: cover; }
    .lbt-fab-badge { position: absolute; right: 2px; bottom: 2px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px; background: rgba(17,24,39,.92); color: #fff; font: 750 9px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-align: center; box-sizing: border-box; box-shadow: 0 2px 8px rgba(0,0,0,.28); }
    .lbt-fab:hover { transform: translateY(-1px); }
    @keyframes lbt-fab-ring-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .lbt-fab-shell[data-indeterminate="true"] { animation: none; } }
    .lbt-panel { width: min(360px, calc(100vw - 36px)); max-height: min(760px, calc(100vh - 36px)); overflow: auto; display: grid; gap: 11px; border: 1px solid var(--lbt-line); border-radius: 20px; background: var(--lbt-card); box-shadow: var(--lbt-shadow); padding: 14px; backdrop-filter: blur(18px); }
    .lbt-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .lbt-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .lbt-brand-mark { flex: none; width: 38px; height: 38px; display: block; border-radius: 12px; object-fit: cover; box-shadow: 0 12px 30px rgba(37,99,235,.32); }
    .lbt-brand-copy { display: grid; gap: 2px; min-width: 0; }
    .lbt-brand-copy strong { font-size: 13px; letter-spacing: -.01em; }
    .lbt-brand-copy span { color: var(--lbt-muted); font-size: 11px; }
    .lbt-icon-button { border: 1px solid var(--lbt-line); background: var(--lbt-card); color: var(--lbt-ink); width: 34px; height: 34px; border-radius: 10px; cursor: pointer; font-size: 17px; }
    .lbt-page-card, .lbt-card { border: 1px solid var(--lbt-line); border-radius: 16px; background: var(--lbt-card); box-shadow: none; padding: 13px; }
    .lbt-page-card { display: grid; gap: 8px; background: radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--lbt-accent) 13%, transparent), transparent 52%), var(--lbt-card); }
    .lbt-eyebrow { color: var(--lbt-muted); font-size: 10px; font-weight: 750; letter-spacing: .12em; }
    .lbt-status-row { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 12px; }
    .lbt-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--lbt-muted); box-shadow: 0 0 0 4px color-mix(in srgb, var(--lbt-muted) 15%, transparent); }
    .lbt-dot.translating { background: var(--lbt-accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--lbt-accent) 18%, transparent); animation: lbt-pulse 1.4s infinite; }
    .lbt-dot.complete { background: var(--lbt-success); box-shadow: 0 0 0 4px color-mix(in srgb, var(--lbt-success) 18%, transparent); }
    .lbt-dot.error { background: var(--lbt-danger); box-shadow: 0 0 0 4px color-mix(in srgb, var(--lbt-danger) 18%, transparent); }
    @keyframes lbt-pulse { 50% { transform: scale(.72); opacity: .75; } }
    .lbt-status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lbt-progress { height: 6px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--lbt-line) 70%, transparent); }
    .lbt-progress > span { display: block; width: 0; height: 100%; background: linear-gradient(90deg, var(--lbt-accent), var(--lbt-accent-2)); transition: width .25s ease; }
    .lbt-stats { display: flex; gap: 12px; color: var(--lbt-muted); font-size: 11px; }
    .lbt-stats strong { color: var(--lbt-ink); font-size: 12px; }
    .lbt-actions { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 8px; }
    .lbt-actions button, .lbt-mode-control button { border: 1px solid var(--lbt-line); border-radius: 11px; padding: 9px 10px; background: var(--lbt-card); color: var(--lbt-ink); cursor: pointer; font: inherit; font-weight: 650; }
    .lbt-actions button:hover, .lbt-mode-control button:hover { border-color: color-mix(in srgb, var(--lbt-accent) 42%, var(--lbt-line)); }
    .lbt-actions button.primary { color: #fff; border-color: transparent; background: linear-gradient(145deg, var(--lbt-accent), var(--lbt-accent-2)); box-shadow: 0 8px 20px color-mix(in srgb, var(--lbt-accent) 25%, transparent); }
    .lbt-actions button.danger { color: var(--lbt-danger); }
    .lbt-actions button:disabled { opacity: .45; cursor: default; box-shadow: none; }
    .lbt-card { display: grid; gap: 10px; }
    .lbt-row-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 9px; }
    .lbt-card-title { display: grid; gap: 3px; }
    .lbt-card-title h3 { margin: 0; font-size: 13px; line-height: 1.35; }
    .lbt-translation-card { display: grid; gap: 11px; }
    .lbt-translation-heading { display: grid; gap: 2px; }
    .lbt-translation-title { margin: 0; font-size: 14px; line-height: 1.3; }
    .lbt-translation-title::after { content: ":"; }
    .lbt-control { display: grid; gap: 6px; min-width: 0; }
    .lbt-control-label { color: var(--lbt-ink); font-size: 11px; font-weight: 700; line-height: 1.35; }
    .lbt-language-combobox { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; min-width: 0; border: 1px solid var(--lbt-line); border-radius: 10px; background: color-mix(in srgb, var(--lbt-bg) 70%, var(--lbt-card)); transition: border-color .15s ease, box-shadow .15s ease; }
    .lbt-language-combobox:focus-within { border-color: var(--lbt-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lbt-accent) 20%, transparent); }
    .lbt-language-flag { display: flex; align-items: center; justify-content: center; padding-inline-start: 10px; font-size: 17px; line-height: 1; }
    .lbt-language-input { min-width: 0; width: 100%; border: 0; border-radius: 0; background: transparent; color: var(--lbt-ink); padding: 9px 7px; font: inherit; unicode-bidi: plaintext; text-align: start; }
    .lbt-language-input:focus-visible { outline: 0; }
    .lbt-language-toggle { align-self: stretch; min-width: 38px; border: 0; border-inline-start: 1px solid var(--lbt-line); border-start-end-radius: 9px; border-end-end-radius: 9px; background: transparent; color: var(--lbt-muted); cursor: pointer; font: inherit; font-size: 15px; }
    .lbt-language-toggle:hover { background: color-mix(in srgb, var(--lbt-accent-soft) 78%, transparent); color: var(--lbt-accent); }
    .lbt-language-input:disabled, .lbt-language-toggle:disabled, .lbt-select:disabled { opacity: .5; cursor: default; }
    .lbt-language-popup { position: fixed; z-index: 2147483647; overflow: hidden; border: 1px solid var(--lbt-line); border-radius: 12px; background: var(--lbt-card); color: var(--lbt-ink); box-shadow: 0 18px 44px rgba(15,28,52,.24); font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .lbt-language-popup[hidden] { display: none; }
    .lbt-language-menu { max-height: min(260px, 42vh); overflow-y: auto; padding: 6px; overscroll-behavior: contain; }
    .lbt-language-option { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 7px; width: 100%; border: 0; border-radius: 8px; background: transparent; color: inherit; padding: 8px; text-align: start; cursor: pointer; font: inherit; }
    .lbt-language-option:hover, .lbt-language-option.active { background: var(--lbt-accent-soft); color: var(--lbt-accent); }
    .lbt-language-option-flag { display: flex; align-items: flex-start; justify-content: center; padding-top: 1px; font-size: 17px; line-height: 1.2; }
    .lbt-language-option-copy { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .lbt-language-empty { padding: 13px 10px; color: var(--lbt-muted); font-size: 12px; }
    .lbt-language-footer { border-top: 1px solid var(--lbt-line); padding: 8px 10px; color: var(--lbt-muted); font-size: 10px; line-height: 1.4; }
    .lbt-select { width: 100%; min-width: 0; border: 1px solid var(--lbt-line); border-radius: 10px; background: color-mix(in srgb, var(--lbt-bg) 70%, var(--lbt-card)); color: var(--lbt-ink); padding: 9px 10px; font: inherit; }
    .lbt-select:focus-visible { outline: 3px solid color-mix(in srgb, var(--lbt-accent) 20%, transparent); border-color: var(--lbt-accent); }
    .lbt-mode-control { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; border-radius: 12px; background: color-mix(in srgb, var(--lbt-bg) 70%, var(--lbt-card)); padding: 5px; }
    .lbt-mode-control button { padding: 8px 7px; border-color: transparent; background: transparent; font-size: 12px; }
    .lbt-mode-control button.active { background: var(--lbt-card); border-color: var(--lbt-line); box-shadow: 0 3px 10px rgba(20,30,55,.08); }
    .lbt-hint { margin: 0; color: var(--lbt-muted); font-size: 11px; line-height: 1.45; }
    .lbt-pill { background: var(--lbt-accent-soft); color: var(--lbt-accent); border-radius: 999px; padding: 4px 8px; font-size: 10px; font-weight: 750; white-space: nowrap; }
    .lbt-link-button { justify-self: start; border: 0; background: transparent; color: var(--lbt-accent); padding: 0; cursor: pointer; font: inherit; font-size: 11px; font-weight: 650; }
    .lbt-permission-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid color-mix(in srgb, var(--lbt-accent) 35%, var(--lbt-line)); border-radius: 16px; background: color-mix(in srgb, var(--lbt-accent-soft) 62%, var(--lbt-card)); padding: 12px 13px; }
    .lbt-permission-copy { display: grid; gap: 3px; min-width: 0; }
    .lbt-permission-copy strong { font-size: 12px; line-height: 1.35; }
    .lbt-permission-copy p { margin: 0; color: var(--lbt-muted); font-size: 11px; line-height: 1.4; }
    .lbt-permission-card button { flex: none; border: 0; border-radius: 10px; padding: 8px 10px; color: #fff; background: linear-gradient(145deg, var(--lbt-accent), var(--lbt-accent-2)); cursor: pointer; font: inherit; font-size: 11px; font-weight: 700; }
    .lbt-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--lbt-muted); font-size: 10px; }
    .lbt-footer-link { color: var(--lbt-accent); text-decoration: none; font-weight: 650; }
    .lbt-footer-link:hover { text-decoration: underline; }
    .lbt-sel-button, .lbt-sel-bubble { position: fixed; z-index: 2147483647; font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .lbt-sel-button { border: 1px solid rgba(148,163,184,.5); background: #111827; color: white; border-radius: 999px; padding: 8px 12px; box-shadow: 0 10px 28px rgba(15,23,42,.28); cursor: pointer; }
    .lbt-sel-bubble { width: min(360px, calc(100vw - 28px)); background: #fff; color: #172033; border: 1px solid #d8deea; border-radius: 16px; box-shadow: 0 18px 50px rgba(15,23,42,.24); padding: 14px; }
    .lbt-sel-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #7b879c; margin-bottom: 7px; }
    .lbt-sel-text { max-height: 180px; overflow: auto; white-space: pre-wrap; }
    .lbt-sel-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
    .lbt-sel-actions button { border: 1px solid #d8deea; background: #fff; border-radius: 9px; padding: 6px 10px; cursor: pointer; font: inherit; }
    .lbt-sel-actions button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  `;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function normalizedSearchText(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
  }

  function flagForTerritory(territory) {
    if (!/^[A-Z]{2}$/.test(territory)) return '🌐';
    return String.fromCodePoint(...[...territory].map((letter) => 127397 + letter.charCodeAt(0)));
  }

  function languageTerritoryForOption(value) {
    const key = String(value || '').trim().toLowerCase();
    const exact = panelLanguageOptions.find((option) => option.value.toLowerCase() === key);
    if (exact?.territory) return exact.territory;
    const region = String(value || '').split('-').slice(1).find((part) => /^[A-Za-z]{2}$/.test(part));
    if (region) return region.toUpperCase();
    const base = key.split('-')[0];
    return panelLanguageOptions.find((option) => option.value.toLowerCase() === base)?.territory || '';
  }

  function panelLocaleFromSettings(candidate = settings) {
    const configured = candidate?.appearance?.uiLocale;
    return typeof configured === 'string' && configured.trim() && configured.trim().toLowerCase() !== 'auto'
      ? configured.trim()
      : null;
  }

  function normalizePanelTranslations(response) {
    const payload = response?.translations ?? response?.strings ?? response;
    const output = Object.create(null);
    if (Array.isArray(payload)) {
      payload.forEach((item, index) => {
        if (typeof item === 'string' && PANEL_TRANSLATION_KEYS[index]) output[PANEL_TRANSLATION_KEYS[index]] = item;
        else if (item && typeof item === 'object') {
          const key = item.key ?? item.source;
          const value = item.translation ?? item.value ?? item.text;
          if (typeof key === 'string' && typeof value === 'string') output[key] = value;
        }
      });
      return output;
    }
    if (payload && typeof payload === 'object') {
      for (const [key, value] of Object.entries(payload)) {
        if (typeof value === 'string') output[key] = value;
      }
    }
    return output;
  }

  async function refreshPanelTranslations(nextSettings = settings) {
    const requestId = ++panelTranslationRequest;
    const locale = panelLocaleFromSettings(nextSettings);
    let resolvedLocale = locale;
    let translations = Object.create(null);
    try {
      const response = await sendMessage({ type: 'ui-translations-request', locale, keys: [...PANEL_TRANSLATION_KEYS] });
      if (response?.ok !== false) {
        translations = normalizePanelTranslations(response);
        if (Array.isArray(response?.languageOptions)) {
          panelLanguageOptions = Object.freeze(response.languageOptions.filter((option) => option
            && typeof option.value === 'string'
            && typeof option.name === 'string'));
        }
        if (typeof response?.locale === 'string' && response.locale.trim()) resolvedLocale = response.locale.trim();
      }
    } catch { /* English fallback is intentional when the background is unavailable. */ }
    if (requestId !== panelTranslationRequest) return false;
    panelTranslations = translations;
    panelUiLocale = resolvedLocale;
    panelRequestedLocale = locale;
    return true;
  }

  function translatePanel(source, params = {}) {
    const key = typeof source === 'string' ? source : String(source ?? '');
    const values = params && typeof params === 'object' ? params : {};
    const translated = typeof panelTranslations[key] === 'string' ? panelTranslations[key] : key;
    return translated.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_match, name) => values[name] === null || values[name] === undefined ? '{' + name + '}' : String(values[name]));
  }

  function openOptions(section) {
    const message = { type: 'open-options' };
    if (section) message.section = section;
    return sendMessage(message).catch(() => {});
  }

  function isPermissionError(value) {
    if (!value) return false;
    if (value.permissionRequired === true || value.code === 'permission-required') return true;
    const text = typeof value === 'string'
      ? value
      : String(value.error ?? value.message ?? '');
    return /website access is required|allow all sites|site access required/i.test(text);
  }

  function shadowHost(attribute) {
    const host = document.createElement('div');
    host.setAttribute(attribute, '');
    host.setAttribute('data-lbt-ui', '');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.zIndex = '2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    shadow.append(style);
    document.documentElement.append(host);
    return { host, shadow };
  }

  class PageUi {
    constructor() {
      this.translating = false;
      this.progress = { done: 0, total: 0 };
      this.host = null;
      this.shadow = null;
      this.panel = null;
      this.status = null;
      this.progressBar = null;
      this.progressDone = null;
      this.progressTotal = null;
      this.progressPercent = null;
      this.progressCache = null;
      this.statusDot = null;
      this.translationCard = null;
      this.languageInput = null;
      this.languageToggle = null;
      this.languageFlag = null;
      this.languagePopup = null;
      this.languageMenu = null;
      this.languageFooter = null;
      this.languageResults = [];
      this.languageActiveIndex = -1;
      this.displayModeSelect = null;
      this.preferencesBusy = false;
      this.preferenceSavePromise = Promise.resolve();
      this.modeControl = null;
      this.modeHint = null;
      this.allSitesPill = null;
      this.siteState = null;
      this.permissionCard = null;
      this.permissionRequired = false;
      this.modeBusy = false;
      this.statusParams = {};
      this.translationParams = new WeakMap();
      this.translateButton = null;
      this.stopButton = null;
      this.revertButton = null;
      this.fab = null;
      this.selectionButton = null;
      this.selectionBubble = null;
      this.selectionText = null;
      this.selectionRequestId = null;
      this.selectionApply = null;
      this.selectionRange = null;
      this.build();
    }

    localizeNode(node, key, params = {}) {
      node.dataset.lbtI18n = key;
      this.translationParams.set(node, params);
      node.textContent = translatePanel(key, params);
      return node;
    }

    localized(tag, className, key, params = {}) {
      return this.localizeNode(el(tag, className), key, params);
    }

    localizeAttribute(node, name, key) {
      node.dataset['lbtI18n' + name.replace(/(^|-)([a-z])/g, (_match, _dash, letter) => letter.toUpperCase())] = key;
      node.setAttribute(name, translatePanel(key));
    }

    updateTranslations() {
      if (!this.shadow) return;
      if (this.host) {
        this.host.lang = panelUiLocale;
        this.host.dir = /^(ar|fa|ur)(-|$)/i.test(panelUiLocale) ? 'rtl' : 'ltr';
      }
      for (const node of this.shadow.querySelectorAll('[data-lbt-i18n]')) {
        node.textContent = translatePanel(node.dataset.lbtI18n, this.translationParams.get(node) || {});
      }
      for (const node of this.shadow.querySelectorAll('[data-lbt-i18n-title]')) {
        node.setAttribute('title', translatePanel(node.dataset.lbtI18nTitle));
      }
      for (const node of this.shadow.querySelectorAll('[data-lbt-i18n-aria-label]')) {
        node.setAttribute('aria-label', translatePanel(node.dataset.lbtI18nAriaLabel));
      }
      for (const node of this.shadow.querySelectorAll('[data-lbt-i18n-placeholder]')) {
        node.setAttribute('placeholder', translatePanel(node.dataset.lbtI18nPlaceholder));
      }
      this.refreshTranslationControls();
      if (this.languagePopup && !this.languagePopup.hidden) this.renderLanguageMenu();
      this.renderSiteMode();
      this.updateProgressVisuals();
      this.renderPermissionNotice();
    }

    build() {
      document.querySelectorAll('[data-lbt-ui]').forEach((node) => node.remove());
      const { host, shadow } = shadowHost('data-lbt-floating-control');
      this.host = host;
      this.shadow = shadow;
      host.lang = panelUiLocale;
      host.dir = /^(ar|fa|ur)(-|$)/i.test(panelUiLocale) ? 'rtl' : 'ltr';
      const container = el('div', 'lbt-floating');
      container.dataset.corner = settings.appearance.floatingButtonCorner;
      this.container = container;

      this.fabShell = el('div', 'lbt-fab-shell');
      this.fabShell.dataset.active = 'false';
      this.fabShell.dataset.complete = 'false';
      this.fabShell.dataset.indeterminate = 'false';
      this.fab = el('button', 'lbt-fab');
      const fabLogo = el('img', 'lbt-fab-logo');
      fabLogo.src = LBT.api.runtime.getURL('src/assets/icon-128.png');
      fabLogo.alt = '';
      this.fabBadge = el('span', 'lbt-fab-badge');
      this.fabBadge.hidden = true;
      this.fab.append(fabLogo, this.fabBadge);
      this.fab.title = 'Local LLM Translator Pro';
      this.fab.addEventListener('click', () => {
        this.panel.hidden = !this.panel.hidden;
        if (!this.panel.hidden) {
          this.refreshTranslationControls();
          this.refreshSiteState().catch(() => {});
        }
      });

      this.panel = el('div', 'lbt-panel');
      this.panel.hidden = true;

      const header = el('header', 'lbt-header');
      const brand = el('div', 'lbt-brand');
      const brandMark = el('img', 'lbt-brand-mark');
      brandMark.src = LBT.api.runtime.getURL('src/assets/icon-48.png');
      brandMark.alt = '';
      const brandCopy = el('div', 'lbt-brand-copy');
      brandCopy.append(el('strong', '', 'Local LLM Translator Pro'), this.localized('span', '', 'private by design'));
      brand.append(brandMark, brandCopy);
      const settingsButton = el('button', 'lbt-icon-button', '⚙');
      this.localizeAttribute(settingsButton, 'title', 'Open settings');
      this.localizeAttribute(settingsButton, 'aria-label', 'Open settings');
      settingsButton.addEventListener('click', () => openOptions());
      header.append(brand, settingsButton);

      const pageCard = el('section', 'lbt-page-card');
      pageCard.dataset.lbtSection = 'current-page';
      pageCard.append(this.localized('div', 'lbt-eyebrow', 'CURRENT PAGE'));
      const statusRow = el('div', 'lbt-status-row');
      this.statusDot = el('span', 'lbt-dot');
      this.status = this.localized('span', 'lbt-status-text', 'Ready');
      statusRow.append(this.statusDot, this.status);
      const progress = el('div', 'lbt-progress');
      this.progressBar = el('span');
      progress.append(this.progressBar);
      const stats = el('div', 'lbt-stats');
      this.progressDone = el('span');
      this.progressTotal = el('span');
      this.progressPercent = el('span');
      this.progressCache = el('span');
      stats.append(this.progressDone, this.progressTotal, this.progressPercent, this.progressCache);
      pageCard.append(statusRow, progress, stats);

      const translationCard = this.buildTranslationCard();

      const actions = el('div', 'lbt-actions');
      this.translateButton = this.localized('button', 'primary', 'Translate page');
      this.stopButton = this.localized('button', '', 'Stop');
      this.revertButton = this.localized('button', 'danger', 'Revert');
      this.stopButton.disabled = true;
      this.translateButton.addEventListener('click', async () => {
        await this.preferenceSavePromise.catch(() => {});
        if (this.preferencesBusy) return;
        this.setStatus('Starting translation…');
        try {
          const response = await sendMessage({ type: 'translate-page', url: location.href, documentKey });
          if (response?.error) {
            if (isPermissionError(response)) {
              this.setPermissionRequired(true);
              this.setStatus('Site access required');
            } else {
              this.setStatus(response.error);
            }
          }
        } catch (error) {
          this.setStatus('Could not reach the translation service: {error}', { error: LBT.errorMessage(error) });
        }
      });
      this.stopButton.addEventListener('click', () => {
        sendMessage({ type: 'stop', url: location.href, runId: runId || lastRunId, documentKey }).catch((error) => this.setStatus(LBT.errorMessage(error)));
        sessionActive = false;
        stopObserver();
        runId = null;
        state.runId = null;
        runPaused = false;
        this.setTranslating(false);
        this.setStatus('Translation stopped.');
      });
      this.revertButton.addEventListener('click', () => {
        sendMessage({ type: 'revert', url: location.href, runId: runId || lastRunId, documentKey }).catch((error) => this.setStatus(LBT.errorMessage(error)));
        sessionActive = false;
        stopObserver();
        mutateWithoutObservation(() => renderer.revertAll());
        runId = null;
        state.runId = null;
        runPaused = false;
        this.setTranslating(false);
        this.setStatus('Original text restored.');
      });
      actions.append(this.translateButton, this.stopButton, this.revertButton);

      const modeCard = el('section', 'lbt-card');
      const modeHead = el('div', 'lbt-row-head');
      const modeTitle = el('div', 'lbt-card-title');
      modeTitle.append(this.localized('div', 'lbt-eyebrow', 'TRANSLATE MODE'), this.localized('h3', '', 'What should happen on this site?'));
      this.allSitesPill = this.localized('span', 'lbt-pill', 'All sites allowed');
      this.allSitesPill.hidden = true;
      modeHead.append(modeTitle, this.allSitesPill);
      this.modeControl = el('div', 'lbt-mode-control');
      this.modeControl.setAttribute('role', 'group');
      this.localizeAttribute(this.modeControl, 'aria-label', 'Site translation mode');
      for (const [mode, label] of [['auto', 'Automatic'], ['ask', 'Ask me'], ['never', 'Never']]) {
        const button = this.localized('button', '', label);
        button.type = 'button';
        button.dataset.mode = mode;
        button.addEventListener('click', () => this.setSiteMode(mode).catch(() => {}));
        this.modeControl.append(button);
      }
      this.modeHint = el('p', 'lbt-hint');
      const advanced = this.localized('button', 'lbt-link-button', 'Advanced site rules →');
      advanced.type = 'button';
      advanced.addEventListener('click', () => openOptions('sites'));
      modeCard.append(modeHead, this.modeControl, this.modeHint, advanced);

      this.permissionCard = el('section', 'lbt-permission-card');
      const permissionCopy = el('div', 'lbt-permission-copy');
      permissionCopy.append(
        this.localized('strong', '', 'Site access required'),
        this.localized('p', '', 'Allow access to all websites once. Nothing is read or changed until you allow it.')
      );
      const permissionButton = this.localized('button', '', 'Allow all sites');
      permissionButton.type = 'button';
      permissionButton.addEventListener('click', () => openOptions('sites'));
      this.permissionCard.append(permissionCopy, permissionButton);
      this.permissionCard.hidden = true;

      const footer = el('footer', 'lbt-footer');
      const github = this.localized('a', 'lbt-footer-link', 'GitHub');
      github.href = GITHUB_URL;
      github.target = '_blank';
      github.rel = 'noopener noreferrer';
      footer.append(el('span', '', 'v' + LBT.api.runtime.getManifest().version), github);

      this.panel.append(header, pageCard, translationCard, this.permissionCard, actions, modeCard, footer);
      this.fabShell.append(this.fab);
      container.append(this.fabShell, this.panel);
      shadow.append(container, this.languagePopup);

      this.onDocumentPointerDown = (event) => {
        if (this.panel.hidden) return;
        const path = event.composedPath?.() || [];
        if (path.includes(this.container) || path.includes(this.languagePopup)) return;
        this.commitLanguageInput();
        this.closeLanguageMenu();
        this.panel.hidden = true;
      };
      this.onDocumentKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        if (this.languagePopup && !this.languagePopup.hidden) {
          event.preventDefault();
          event.stopPropagation();
          this.commitLanguageInput();
          this.closeLanguageMenu();
          this.languageInput?.focus();
          return;
        }
        if (!this.panel.hidden) this.panel.hidden = true;
      };
      this.onLanguageViewportChange = () => {
        if (this.languagePopup && !this.languagePopup.hidden) this.positionLanguagePopup();
      };
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      document.addEventListener('keydown', this.onDocumentKeyDown, true);
      window.addEventListener('resize', this.onLanguageViewportChange, { passive: true });
      window.addEventListener('scroll', this.onLanguageViewportChange, true);
      window.addEventListener('pagehide', () => {
        document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
        document.removeEventListener('keydown', this.onDocumentKeyDown, true);
        window.removeEventListener('resize', this.onLanguageViewportChange);
        window.removeEventListener('scroll', this.onLanguageViewportChange, true);
      }, { once: true });
      this.renderSiteMode();
      this.renderPermissionNotice();
      this.updateProgressVisuals();
      this.applyAppearance();
    }

    buildTranslationCard() {
      this.translationCard = el('section', 'lbt-page-card lbt-translation-card');
      this.translationCard.dataset.lbtSection = 'translation';
      const heading = el('div', 'lbt-translation-heading');
      heading.append(
        this.localized('div', 'lbt-eyebrow', 'TRANSLATION'),
        this.localized('h3', 'lbt-translation-title', 'Translation')
      );

      const targetControl = el('div', 'lbt-control');
      const targetLabel = this.localized('label', 'lbt-control-label', 'Target language');
      targetLabel.htmlFor = 'lbt-panel-target-language';
      const combobox = el('div', 'lbt-language-combobox');
      this.languageFlag = el('span', 'lbt-language-flag');
      this.languageFlag.setAttribute('aria-hidden', 'true');
      this.languageInput = el('input', 'lbt-language-input');
      this.languageInput.id = 'lbt-panel-target-language';
      this.languageInput.type = 'text';
      this.languageInput.autocomplete = 'off';
      this.languageInput.spellcheck = false;
      this.languageInput.setAttribute('role', 'combobox');
      this.languageInput.setAttribute('aria-autocomplete', 'list');
      this.languageInput.setAttribute('aria-haspopup', 'listbox');
      this.languageInput.setAttribute('aria-controls', 'lbt-panel-language-menu');
      this.languageInput.setAttribute('aria-expanded', 'false');
      this.localizeAttribute(this.languageInput, 'placeholder', 'Search languages or enter a custom tag');
      this.languageToggle = el('button', 'lbt-language-toggle', '⌄');
      this.languageToggle.type = 'button';
      this.localizeAttribute(this.languageToggle, 'aria-label', 'Show language options');
      this.languageToggle.setAttribute('aria-controls', 'lbt-panel-language-menu');
      this.languageToggle.setAttribute('aria-expanded', 'false');
      combobox.append(this.languageFlag, this.languageInput, this.languageToggle);
      targetControl.append(targetLabel, combobox);

      this.languagePopup = el('div', 'lbt-language-popup');
      this.languagePopup.hidden = true;
      this.languageMenu = el('div', 'lbt-language-menu');
      this.languageMenu.id = 'lbt-panel-language-menu';
      this.languageMenu.setAttribute('role', 'listbox');
      this.localizeAttribute(this.languageMenu, 'aria-label', 'Language options');
      this.languageFooter = this.localized('div', 'lbt-language-footer', 'Custom values are accepted: type a language name or BCP 47 tag.');
      this.languagePopup.append(this.languageMenu, this.languageFooter);

      const displayControl = el('div', 'lbt-control');
      const displayLabel = this.localized('label', 'lbt-control-label', 'Display mode');
      displayLabel.htmlFor = 'lbt-panel-display-mode';
      this.displayModeSelect = el('select', 'lbt-select');
      this.displayModeSelect.id = 'lbt-panel-display-mode';
      for (const [value, key] of [
        ['replace', 'Replace the original'],
        ['bilingual-stacked', 'Bilingual — stacked'],
        ['replace-hover-reveal', 'Replace, hover to reveal']
      ]) {
        const option = this.localized('option', '', key);
        option.value = value;
        this.displayModeSelect.append(option);
      }
      displayControl.append(displayLabel, this.displayModeSelect);

      this.languageInput.addEventListener('focus', () => this.openLanguageMenu());
      this.languageInput.addEventListener('input', () => {
        this.syncLanguageFlag();
        this.openLanguageMenu(true);
      });
      this.languageInput.addEventListener('keydown', (event) => this.onLanguageKeyDown(event));
      this.languageInput.addEventListener('blur', () => {
        setTimeout(() => {
          const active = this.shadow?.activeElement || document.activeElement;
          if (this.languagePopup?.contains(active) || this.languageInput?.closest('.lbt-language-combobox')?.contains(active)) return;
          this.commitLanguageInput();
          this.closeLanguageMenu();
        }, 0);
      });
      this.languageToggle.addEventListener('click', () => {
        if (this.languagePopup.hidden) {
          this.languageInput.focus();
          this.openLanguageMenu();
        } else {
          this.commitLanguageInput();
          this.closeLanguageMenu();
          this.languageToggle.focus();
        }
      });
      this.displayModeSelect.addEventListener('change', () => {
        this.queueTranslationPreferenceSave({ renderMode: this.displayModeSelect.value }).catch(() => {});
      });

      this.translationCard.append(heading, targetControl, displayControl);
      this.refreshTranslationControls(true);
      return this.translationCard;
    }

    refreshTranslationControls(force = false) {
      if (!this.languageInput || !this.displayModeSelect) return;
      const focused = (this.shadow?.activeElement || document.activeElement) === this.languageInput;
      if (force || !focused) {
        this.languageInput.value = String(settings.translation.targetLang ?? '');
        this.syncLanguageFlag();
      }
      this.displayModeSelect.value = settings.translation.renderMode;
      this.syncPreferenceAvailability();
    }

    syncPreferenceAvailability() {
      const targetDisabled = this.preferencesBusy || this.translating;
      if (this.languageInput) this.languageInput.disabled = targetDisabled;
      if (this.languageToggle) this.languageToggle.disabled = targetDisabled;
      if (this.displayModeSelect) this.displayModeSelect.disabled = this.preferencesBusy;
      if (this.translateButton) this.translateButton.disabled = this.translating || this.preferencesBusy;
      if (this.translationCard) this.translationCard.setAttribute('aria-busy', String(this.preferencesBusy));
      if (targetDisabled) this.closeLanguageMenu();
    }

    setPreferenceBusy(value) {
      this.preferencesBusy = Boolean(value);
      this.syncPreferenceAvailability();
    }

    queueTranslationPreferenceSave(patch) {
      const requested = {
        targetLang: patch.targetLang ?? (this.languageInput?.value.trim() || settings.translation.targetLang),
        renderMode: patch.renderMode ?? (this.displayModeSelect?.value || settings.translation.renderMode)
      };
      this.preferenceSavePromise = this.preferenceSavePromise
        .catch(() => {})
        .then(() => this.saveTranslationPreferences(requested));
      return this.preferenceSavePromise;
    }

    async saveTranslationPreferences(requested) {
      if (!this.languageInput || !this.displayModeSelect) return false;
      if (this.translating && requested.targetLang !== settings.translation.targetLang) return false;
      this.setPreferenceBusy(true);
      try {
        const response = await sendMessage({ type: 'set-translation-preferences', preferences: requested });
        if (!response?.ok) throw new Error(response?.error || 'Could not save translation settings.');
        const applied = {
          targetLang: response.translation?.targetLang ?? requested.targetLang,
          renderMode: response.translation?.renderMode ?? requested.renderMode
        };
        settings = {
          ...settings,
          translation: { ...settings.translation, ...applied }
        };
        mutateWithoutObservation(() => renderer.setMode(applied.renderMode));
        this.refreshTranslationControls(true);
        return true;
      } catch (error) {
        this.refreshTranslationControls(true);
        this.setStatus('Save failed: {error}', { error: LBT.errorMessage(error) });
        return false;
      } finally {
        this.setPreferenceBusy(false);
      }
    }

    syncLanguageFlag() {
      if (!this.languageFlag || !this.languageInput) return;
      this.languageFlag.textContent = flagForTerritory(languageTerritoryForOption(this.languageInput.value.trim()));
    }

    openLanguageMenu(resetScroll = false) {
      if (!this.languagePopup || !this.languageInput || this.languageInput.disabled) return;
      const wasHidden = this.languagePopup.hidden;
      this.renderLanguageMenu(resetScroll || wasHidden);
      this.languagePopup.hidden = false;
      this.languageInput.setAttribute('aria-expanded', 'true');
      this.languageToggle.setAttribute('aria-expanded', 'true');
      this.languageToggle.textContent = '⌃';
      this.positionLanguagePopup();
    }

    closeLanguageMenu() {
      if (!this.languagePopup || this.languagePopup.hidden) return;
      this.languagePopup.hidden = true;
      this.languageActiveIndex = -1;
      this.languageInput?.setAttribute('aria-expanded', 'false');
      this.languageInput?.removeAttribute('aria-activedescendant');
      this.languageToggle?.setAttribute('aria-expanded', 'false');
      if (this.languageToggle) this.languageToggle.textContent = '⌄';
    }

    positionLanguagePopup() {
      if (!this.languagePopup || !this.languageInput) return;
      const anchor = this.languageInput.closest('.lbt-language-combobox');
      const rect = anchor?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const gap = 7;
      const width = Math.max(220, Math.min(rect.width, window.innerWidth - margin * 2));
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const openAbove = below < 190 && above > below;
      this.languagePopup.style.width = `${Math.round(width)}px`;
      this.languagePopup.style.left = `${Math.round(left)}px`;
      if (openAbove) {
        this.languagePopup.style.top = 'auto';
        this.languagePopup.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
      } else {
        this.languagePopup.style.bottom = 'auto';
        this.languagePopup.style.top = `${Math.round(rect.bottom + gap)}px`;
      }
    }

    renderLanguageMenu(resetScroll = false) {
      if (!this.languageMenu || !this.languageInput) return;
      const query = normalizedSearchText(this.languageInput.value).trim();
      const terms = query.split(/\s+/).filter(Boolean);
      const results = panelLanguageOptions
        .map((option) => {
          const haystack = option.searchText || normalizedSearchText(`${option.value} ${option.name} ${option.nativeName || ''}`);
          if (!terms.every((term) => haystack.includes(term))) return null;
          const values = [option.value, option.name, option.nativeName].map(normalizedSearchText);
          const score = terms.length && values.some((value) => value === query) ? 0 : terms.length && values.some((value) => value.startsWith(query)) ? 1 : 2;
          return { option, score };
        })
        .filter(Boolean)
        .sort((left, right) => left.score - right.score)
        .slice(0, 120)
        .map(({ option }) => option);
      this.languageResults = results;
      this.languageActiveIndex = -1;
      this.languageInput.removeAttribute('aria-activedescendant');
      this.languageMenu.replaceChildren();
      if (!results.length) {
        this.languageMenu.append(this.localized('div', 'lbt-language-empty', 'No built-in match. Press Enter or leave the field to use the entered value.'));
        return;
      }
      results.forEach((option, index) => {
        const entry = el('button', 'lbt-language-option');
        entry.type = 'button';
        entry.id = `lbt-panel-language-option-${index}`;
        entry.dataset.language = option.value;
        entry.setAttribute('role', 'option');
        entry.setAttribute('aria-selected', String(option.value.toLowerCase() === this.languageInput.value.trim().toLowerCase()));
        const flag = el('span', 'lbt-language-option-flag', flagForTerritory(option.territory));
        flag.setAttribute('aria-hidden', 'true');
        const meta = option.nativeName && option.nativeName.toLowerCase() !== option.name.toLowerCase()
          ? `${option.nativeName} · ${option.value}`
          : option.value;
        entry.append(flag, el('span', 'lbt-language-option-copy', `${option.name} · ${meta}`));
        entry.addEventListener('mousedown', (event) => event.preventDefault());
        entry.addEventListener('click', () => {
          this.languageInput.value = option.value;
          this.syncLanguageFlag();
          this.closeLanguageMenu();
          this.commitLanguageInput();
          this.languageInput.focus();
        });
        this.languageMenu.append(entry);
      });
      const selectedIndex = results.findIndex((option) => option.value.toLowerCase() === this.languageInput.value.trim().toLowerCase());
      if (selectedIndex >= 0) this.setLanguageActive(selectedIndex, resetScroll);
      else if (resetScroll) this.languageMenu.scrollTop = 0;
    }

    setLanguageActive(index, scroll = true) {
      if (!this.languageMenu || !this.languageInput) return;
      const entries = this.languageMenu.querySelectorAll('.lbt-language-option');
      if (!entries.length) {
        this.languageActiveIndex = -1;
        this.languageInput.removeAttribute('aria-activedescendant');
        return;
      }
      this.languageActiveIndex = (index + entries.length) % entries.length;
      entries.forEach((entry, entryIndex) => entry.classList.toggle('active', entryIndex === this.languageActiveIndex));
      const active = entries[this.languageActiveIndex];
      this.languageInput.setAttribute('aria-activedescendant', active.id);
      if (scroll) active.scrollIntoView({ block: 'nearest' });
    }

    commitLanguageInput() {
      if (!this.languageInput) return;
      const nextValue = this.languageInput.value.trim() || settings.translation.targetLang;
      this.languageInput.value = nextValue;
      this.syncLanguageFlag();
      if (nextValue && nextValue !== settings.translation.targetLang) {
        this.queueTranslationPreferenceSave({ targetLang: nextValue }).catch(() => {});
      }
    }

    onLanguageKeyDown(event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (this.languagePopup.hidden) this.openLanguageMenu();
        this.setLanguageActive(this.languageActiveIndex + 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (this.languagePopup.hidden) this.openLanguageMenu();
        this.setLanguageActive(this.languageActiveIndex < 0 ? this.languageResults.length - 1 : this.languageActiveIndex - 1);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!this.languagePopup.hidden && this.languageActiveIndex >= 0 && this.languageResults[this.languageActiveIndex]) {
          const option = this.languageResults[this.languageActiveIndex];
          this.languageInput.value = option.value;
          this.syncLanguageFlag();
        }
        this.commitLanguageInput();
        this.closeLanguageMenu();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.commitLanguageInput();
        this.closeLanguageMenu();
        return;
      }
      if (event.key === 'Tab') {
        this.commitLanguageInput();
        this.closeLanguageMenu();
      }
    }

    applyAppearance() {
      if (!this.host) return;
      this.host.style.display = settings.appearance.floatingButtonEnabled ? '' : 'none';
      this.container.dataset.corner = settings.appearance.floatingButtonCorner;
    }

    setStatus(text, params = {}) {
      if (!this.status) return;
      this.statusParams = params;
      this.localizeNode(this.status, text, params);
    }

    async refreshSiteState() {
      try {
        const response = await sendMessage({ type: 'get-site-state', url: location.href });
        if (response?.ok) {
          this.siteState = response;
          this.permissionRequired = false;
        }
      } catch { /* keep the last known site state */ }
      this.renderSiteMode();
      this.renderPermissionNotice();
    }

    setPermissionRequired(value) {
      this.permissionRequired = Boolean(value);
      this.renderPermissionNotice();
    }

    renderPermissionNotice() {
      if (!this.permissionCard) return;
      this.permissionCard.hidden = !(this.permissionRequired || this.siteState?.permissionGranted === false);
    }

    renderSiteMode() {
      if (!this.modeControl) return;
      const selected = this.siteState?.selected || settings.behaviour.autoTranslateDefault;
      this.modeControl.querySelectorAll('button[data-mode]').forEach((button) => {
        button.classList.toggle('active', button.dataset.mode === selected);
        button.disabled = this.modeBusy;
      });
      const allSites = this.siteState?.permissionGranted !== false
        && Boolean(this.siteState?.allSitesEnabled ?? settings.behaviour.allSitesEnabled);
      if (this.allSitesPill) this.allSitesPill.hidden = !allSites;
      if (!this.modeHint) return;
      const hintKey = selected === 'auto'
        ? (allSites ? 'Every allowed page translates automatically. You can still stop or revert it.' : 'Automatic applies only to sites you enable one by one.')
        : selected === 'never'
          ? 'This site is blocked. Nothing will be read or sent.'
          : 'Manual mode never sends text until you press Translate.';
      this.localizeNode(this.modeHint, hintKey);
    }

    async setSiteMode(mode) {
      if (this.modeBusy || !['auto', 'ask', 'never'].includes(mode)) return;
      this.modeBusy = true;
      this.renderSiteMode();
      try {
        const response = await sendMessage({ type: 'set-site-mode', url: location.href, mode });
        if (response?.ok) {
          this.siteState = response;
          this.permissionRequired = false;
          this.setStatus('Site translation mode updated.');
        } else {
          if (isPermissionError(response)) {
            this.setPermissionRequired(true);
            this.setStatus('Site access required');
          } else {
            this.setStatus(response?.error || 'Could not update site mode.');
          }
        }
      } catch (error) {
        this.setStatus('Could not update site mode: {error}', { error: LBT.errorMessage(error) });
      } finally {
        this.renderPermissionNotice();
        this.modeBusy = false;
        this.renderSiteMode();
      }
    }

    updateProgressVisuals() {
      const total = this.progress.total;
      const done = this.progress.done;
      const ratio = total > 0 ? Math.min(1, done / total) : 0;
      const percent = Math.round(ratio * 100);
      const complete = total > 0 && done >= total;
      if (this.progressBar) this.progressBar.style.width = percent + '%';
      if (this.progressDone) this.progressDone.textContent = translatePanel('{done} done', { done });
      if (this.progressTotal) this.progressTotal.textContent = translatePanel('{total} total', { total });
      if (this.progressPercent) this.progressPercent.textContent = total > 0 ? translatePanel('{percent}%', { percent }) : '—';
      if (this.progressCache) this.progressCache.textContent = Number.isFinite(this.progress.cacheHitRate) ? translatePanel('{percent}% cache', { percent: Math.round(this.progress.cacheHitRate * 100) }) : translatePanel('— cache');
      if (this.statusDot) this.statusDot.className = 'lbt-dot ' + (this.translating ? 'translating' : complete ? 'complete' : '');
      if (this.fabShell) {
        this.fabShell.style.setProperty('--lbt-fab-progress', percent + '%');
        this.fabShell.dataset.active = String(this.translating);
        this.fabShell.dataset.indeterminate = String(this.translating && total === 0);
        this.fabShell.dataset.complete = String(complete && !this.translating);
      }
      if (this.fab) {
        const badge = total > 0 ? (complete ? '✓' : percent + '%') : this.translating ? '…' : '';
        this.fabBadge.textContent = badge;
        this.fabBadge.hidden = !badge;
        this.fab.classList.toggle('is-progress', !complete && (this.translating || total > 0));
        const label = total > 0
          ? translatePanel('Local LLM Translator Pro — {done}/{total} ({percent}%)', { done, total, percent })
          : this.translating ? translatePanel('Local LLM Translator Pro — translating') : 'Local LLM Translator Pro';
        this.fab.title = label;
        this.fab.setAttribute('aria-label', label);
      }
    }

    setTranslating(value) {
      this.translating = Boolean(value);
      if (this.translateButton) this.translateButton.disabled = this.translating;
      if (this.stopButton) this.stopButton.disabled = !this.translating;
      this.syncPreferenceAvailability();
      this.updateProgressVisuals();
    }

    setProgress(done, total, cacheHitRate = null) {
      this.progress = { done: Number(done) || 0, total: Number(total) || 0, cacheHitRate };
      this.updateProgressVisuals();
    }

  }

  function unitPayload(unit) {
    return {
      id: unit.id,
      kind: unit.kind,
      text: unit.text,
      zone: unit.zone,
      srcLang: unit.srcLang,
      attribute: unit.attribute ?? null,
      priority: unit.priority ?? null
    };
  }

  async function reportUnits(units) {
    if (!runId || !sessionActive) return;
    if (location.href !== sessionHref) {
      handlePageContextChanged('spa-navigate');
      return;
    }
    const ceiling = Math.min(100000, Math.max(1, Number(settings.speed.runaway.pageUnitCeiling) || 100000));
    const limited = LBT.sortUnitsByPriority(units).slice(0, ceiling);
    inventoryRevision += 1;
    const payloads = limited.map(unitPayload);
    const chunkSize = 5000;
    const chunkCount = Math.max(1, Math.ceil(payloads.length / chunkSize));
    const snapshotId = `${runId}:${inventoryRevision}`;
    try {
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        await sendMessage({
          type: 'units-report',
          url: sessionHref,
          runId,
          documentKey,
          snapshot: true,
          inventoryRevision,
          snapshotId,
          chunkIndex,
          chunkCount,
          units: payloads.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize)
        });
      }
    } catch (error) {
      void error;
    }
  }

  async function extractAndReport(roots = null) {
    if (!runId || !sessionActive) return;
    if (roots === null) LBT.extractAll(false);
    else LBT.extractFromRoots(roots);
    const units = LBT.currentUnitsSnapshot();
    await reportUnits(units);
  }

  function scheduleExtraction(roots = []) {
    if (!runId || !sessionActive) return;
    for (const root of roots) extractionRoots.add(root);
    if (extractionTimer) clearTimeout(extractionTimer);
    extractionTimer = setTimeout(() => {
      extractionTimer = null;
      const pendingRoots = [...extractionRoots];
      extractionRoots = new Set();
      if (location.href !== sessionHref) {
        handlePageContextChanged('spa-navigate');
        return;
      }
      extractAndReport(pendingRoots).catch(() => {});
    }, 180);
  }

  function mutateWithoutObservation(callback) {
    const observer = mutationObserver;
    observer?.takeRecords();
    try {
      return callback();
    } finally {
      observer?.takeRecords();
    }
  }

  function installMutationObserver() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((mutations) => {
      const now = Date.now();
      if (now - mutationWindowStart > (settings.speed.runaway.mutationStormWindowMs || 3000)) {
        mutationWindowStart = now;
        mutationCount = 0;
      }
      mutationCount += mutations.length;
      if (settings.speed.runaway.mutationStormDetection && mutationCount > (settings.speed.runaway.mutationStormMaxMutations || 300)) {
        sendMessage({ type: 'run-paused', url: runUrl, runId, reason: 'mutation-storm' }).catch(() => {});
        mutationObserver?.disconnect();
        mutationObserver = null;
        ui?.setStatus('Paused: too many page mutations.');
        return;
      }
      const roots = new Set();
      let relevant = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const changed = [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE);
          if (!changed) continue;
          relevant = true;
          for (const node of mutation.addedNodes) if (node.isConnected) roots.add(node);
        } else if (mutation.type === 'characterData') {
          relevant = true;
          LBT.invalidateNodeUnit(mutation.target);
          roots.add(mutation.target);
        } else if (mutation.type === 'attributes') {
          relevant = true;
          LBT.invalidateElementUnits(mutation.target, mutation.attributeName);
          roots.add(mutation.target);
        }
      }
      if (relevant) scheduleExtraction([...roots]);
    });
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'hidden', 'aria-hidden', 'title', 'alt', 'placeholder', 'aria-label', 'value']
    });
  }

  function stopObserver() {
    mutationObserver?.disconnect();
    mutationObserver = null;
    if (extractionTimer) clearTimeout(extractionTimer);
    extractionTimer = null;
    extractionRoots = new Set();
  }

  function beginRun(message) {
    if (message.documentKey && message.documentKey !== documentKey) return;
    deliveryScheduler.reset();
    extractionRoots = new Set();
    runId = message.runId;
    state.runId = runId;
    lastRunId = message.runId;
    runUrl = message.url || location.href;
    sessionHref = runUrl;
    sessionActive = true;
    inventoryRevision = 0;
    lastPageHref = location.href;
    runPaused = false;
    mutationCount = 0;
    mutationWindowStart = Date.now();
    ui?.setProgress(0, 0);
    ui?.setTranslating(true);
    ui?.setStatus('Translating page…');
    mark('lbt:run-begin');
    installMutationObserver();
    extractAndReport().catch(() => {});
  }

  function acknowledgeSegments(unitIds) {
    if (!runId || !unitIds.length || !sessionActive) return;
    sendMessage({
      type: 'segment-applied',
      url: sessionHref,
      runId,
      documentKey,
      unitIds
    }).catch(() => {});
  }

  function applyDelivery(message) {
    if (!runId || runPaused || message.runId !== runId || !sessionActive || !Array.isArray(message.segments)) return;
    if (message.documentKey && message.documentKey !== documentKey) return;
    if (location.href !== sessionHref) return;
    deliveryScheduler.enqueue(message.segments);
  }

  function progress(message) {
    if (message.runId && runId && message.runId !== runId) return;
    if (!sessionActive) return;
    const total = Number(message.total) || 0;
    const done = Number(message.done) || 0;
    const translated = Number(message.translated) || done;
    ui?.setProgress(done, total, message.cacheHitRate);
    if (message.state === 'error') {
      deliveryScheduler.reset();
      sessionActive = false;
      stopObserver();
      runId = null;
      state.runId = null;
      runPaused = false;
      ui?.setTranslating(false);
      ui?.setStatus(message.notice?.message || 'Translation failed.');
      return;
    }
    if (message.state === 'paused') {
      deliveryScheduler.reset();
      runPaused = true;
      ui?.setTranslating(false);
      ui?.setStatus(message.notice?.message || 'Translation paused.');
      return;
    }
    if (message.state === 'translating') {
      runPaused = false;
      ui?.setTranslating(true);
      if (translated > done) ui?.setStatus('Applying translations to the page… {done} / {translated}', { done, translated });
      else if (message.pending > 0) ui?.setStatus('Translating {pending} new or remaining segments…', { pending: message.pending });
      else ui?.setStatus('Translating page…');
      return;
    }
    if (message.state === 'complete') {
      runPaused = false;
      ui?.setTranslating(false);
      if (total === 0 || done >= total) {
        ui?.setStatus('Translation complete.');
        mark('lbt:run-settled');
      } else {
        if (settings.translation.autoTranslateDynamic === false) {
          ui?.setStatus('{count} new segments waiting. Enable automatic translation or click Translate.', { count: Math.max(0, total - done) });
        } else {
          ui?.setStatus('New content detected. Preparing translation…');
        }
      }
    }
  }

  function selectionInfo() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    return { text, range, rect };
  }

  function hideSelectionUi() {
    if (ui?.selectionButton) ui.selectionButton.remove();
    if (ui?.selectionBubble) ui.selectionBubble.remove();
    ui.selectionButton = null;
    ui.selectionBubble = null;
    ui.selectionText = null;
    ui.selectionRequestId = null;
    ui.selectionRange = null;
    lastSelection = null;
    selectionRequestId = null;
  }

  function placeAt(element, rect) {
    const margin = 10;
    const left = Math.max(margin, Math.min(window.innerWidth - element.offsetWidth - margin, rect.left));
    const top = Math.max(margin, Math.min(window.innerHeight - element.offsetHeight - margin, rect.bottom + 8));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function showSelectionButton(info) {
    if (!settings.appearance.selectionButtonEnabled || !ui?.shadow) return;
    if (ui.selectionButton) ui.selectionButton.remove();
    const button = ui.localized('button', 'lbt-sel-button', 'Translate selection');
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => requestSelectionTranslation(info));
    ui.shadow.append(button);
    ui.selectionButton = button;
    ui.selectionRange = info.range;
    placeAt(button, info.rect);
  }

  async function requestSelectionTranslation(info) {
    const requestId = `sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    selectionRequestId = requestId;
    lastSelection = info;
    if (ui.selectionButton) { ui.selectionButton.remove(); ui.selectionButton = null; }
    showSelectionBubble(info.rect, 'Translating…', info.text, null, info.range);
    try {
      const response = await sendMessage({ type: 'selection-translate-request', url: location.href, requestId, text: info.text });
      if (selectionRequestId !== requestId) return;
      if (response?.status === 'done' && typeof response.text === 'string') {
        showSelectionBubble(info.rect, 'Translated', info.text, response.text, info.range);
      } else {
        showSelectionBubble(info.rect, response?.error || 'Selection translation failed.', info.text, null, info.range);
      }
    } catch (error) {
      showSelectionBubble(info.rect, `Could not reach the translation service: ${LBT.errorMessage(error)}`, info.text, null, info.range);
      void error;
    }
  }

  function showSelectionBubble(rect, statusText, sourceText, translation = null, range = null) {
    if (!ui?.shadow) return;
    if (ui.selectionBubble) ui.selectionBubble.remove();
    const bubble = el('div', 'lbt-sel-bubble');
    bubble.append(ui.localized('div', 'lbt-sel-label', 'Selection'));
    const text = el('div', 'lbt-sel-text', translation || translatePanel(statusText));
    bubble.append(text);
    const actions = el('div', 'lbt-sel-actions');
    if (translation) {
      const copy = ui.localized('button', '', 'Copy');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(translation); ui.localizeNode(copy, 'Copied'); } catch { /* noop */ }
      });
      const apply = ui.localized('button', 'primary', 'Replace selection');
      apply.addEventListener('click', () => {
        try {
          range.deleteContents();
          range.insertNode(document.createTextNode(translation));
          window.getSelection()?.removeAllRanges();
          hideSelectionUi();
        } catch { /* noop */ }
      });
      actions.append(copy, apply);
    }
    const close = ui.localized('button', '', 'Close');
    close.addEventListener('click', hideSelectionUi);
    actions.append(close);
    bubble.append(actions);
    ui.shadow.append(bubble);
    ui.selectionBubble = bubble;
    ui.selectionText = sourceText;
    ui.selectionRange = range;
    placeAt(bubble, rect);
  }

  function installSelectionUi() {
    let selectionTimer = null;
    document.addEventListener('selectionchange', () => {
      if (selectionTimer) clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => {
        const info = selectionInfo();
        if (!info) {
          if (!ui.selectionBubble) hideSelectionUi();
          return;
        }
        if (selectionRequestId || ui.selectionBubble) return;
        showSelectionButton(info);
      }, 180);
    });
    document.addEventListener('mousedown', (event) => {
      if (event.target?.closest?.('[data-lbt-ui]')) return;
      if (ui.selectionBubble) hideSelectionUi();
    }, true);
    window.addEventListener('scroll', () => {
      if (ui.selectionButton && lastSelection) placeAt(ui.selectionButton, lastSelection.range.getBoundingClientRect());
      if (ui.selectionBubble && lastSelection) placeAt(ui.selectionBubble, lastSelection.range.getBoundingClientRect());
    }, { passive: true });
  }

  function endPageSession(statusText = '', { revert = false } = {}) {
    stopObserver();
    deliveryScheduler.reset();
    sessionActive = false;
    runId = null;
    state.runId = null;
    runPaused = false;
    if (revert) mutateWithoutObservation(() => renderer.revertAll());
    ui?.setProgress(0, 0);
    ui?.setTranslating(false);
    if (statusText) ui?.setStatus(statusText);
    lastSelection = null;
    hideSelectionUi();
  }

  function handlePageContextChanged(reason = 'spa-navigate') {
    const nextHref = location.href;
    if (nextHref === lastPageHref) return;
    const previousHref = sessionHref || lastPageHref;
    const previousRunId = runId;
    lastPageHref = nextHref;
    sendMessage({
      type: 'page-context-changed',
      url: nextHref,
      previousUrl: previousHref,
      documentKey,
      runId: previousRunId,
      reason
    }).catch(() => {});
    endPageSession('Page changed. Translate again to continue.', { revert: true });
    setTimeout(() => sendMessage({ type: 'ping', url: nextHref, documentKey }).catch(() => {}), 0);
  }

  function installNavigationWatcher() {
    const check = () => {
      if (location.href !== lastPageHref) handlePageContextChanged('spa-navigate');
    };
    window.addEventListener('popstate', check);
    window.addEventListener('hashchange', check);
    window.navigation?.addEventListener?.('navigatesuccess', check);
    navTimer = setInterval(check, 400);
    window.addEventListener('pagehide', () => {
      if (!sessionActive && !runId) return;
      sendMessage({
        type: 'page-context-changed',
        url: location.href,
        previousUrl: sessionHref,
        documentKey,
        runId,
        reason: 'pagehide'
      }).catch(() => {});
      endPageSession('', { revert: false });
    }, { capture: true });
  }

  function installHoverIntent() {
    document.addEventListener('pointerover', (event) => {
      if (!settings.speed.prefetch.hoverPrefetch) return;
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor || !anchor.href) return;
      sendMessage({
        type: 'hover-intent',
        href: anchor.href,
        sourceUrl: location.href,
        rel: anchor.getAttribute('rel'),
        download: anchor.hasAttribute('download')
      }).catch(() => {});
    }, { passive: true });
  }

  function installNextNavIntent() {
    document.addEventListener('pointerup', () => {
      if (!settings.speed.prefetch.nextNavPrediction) return;
      const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 20).map((anchor) => ({
        href: anchor.href,
        rel: anchor.getAttribute('rel'),
        download: anchor.hasAttribute('download'),
        text: (anchor.textContent || '').trim().slice(0, 120)
      }));
      if (!links.length) return;
      sendMessage({ type: 'next-nav-intent', sourceUrl: location.href, picks: links }).catch(() => {});
    }, { passive: true });
  }

  async function boot() {
    settings = await getSettings();
    await refreshPanelTranslations(settings);
    renderer.mode = settings.translation.renderMode;
    ui = new PageUi();
    ui.refreshSiteState().catch(() => {});
    subscribeSettings((next) => {
      const localeChanged = panelLocaleFromSettings(next) !== panelRequestedLocale;
      const renderModeChanged = next.translation.renderMode !== renderer.mode;
      settings = next;
      if (renderModeChanged) mutateWithoutObservation(() => renderer.setMode(next.translation.renderMode));
      else renderer.mode = next.translation.renderMode;
      ui?.refreshSiteState().catch(() => {});
      ui?.applyAppearance();
      ui?.refreshTranslationControls();
      if (localeChanged) {
        refreshPanelTranslations(next).then((changed) => {
          if (changed) ui?.updateTranslations();
        }).catch(() => {});
      }
    });
    mark('lbt:content-boot-start');
    document.documentElement.setAttribute('data-lbt-loaded', 'true');
    installSelectionUi();
    installNavigationWatcher();
    installHoverIntent();
    installNextNavIntent();
    api.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'run-begin': beginRun(message); break;
        case 'segment-delivery': applyDelivery(message); break;
        case 'progress-update': progress(message); break;
        case 'permission-required':
          ui?.setPermissionRequired(true);
          break;
        case 'run-cancel':
          if (message.runId && runId && message.runId !== runId) break;
          endPageSession(message.reason === 'stop' ? 'Translation stopped.' : '', { revert: false });
          break;
        case 'run-revert':
          if (message.runId && runId && message.runId !== runId) break;
          endPageSession('Original text restored.', { revert: true });
          break;
        case 'run-settled':
          if (message.runId && runId && message.runId !== runId) break;
          if (sessionActive) ui?.setTranslating(false);
          break;
        case 'run-resume':
          if (message.runId && runId && message.runId !== runId) break;
          if (message.runId && (!message.documentKey || message.documentKey === documentKey)) {
            if (runId !== message.runId) {
              deliveryScheduler.reset();
              extractionRoots = new Set();
            }
            runId = message.runId;
            state.runId = runId;
            lastRunId = message.runId;
            runUrl = message.url || location.href;
            sessionHref = runUrl;
            sessionActive = true;
            runPaused = false;
            ui?.setTranslating(true);
            installMutationObserver();
            extractAndReport().catch(() => {});
          }
          break;
        case 'toggle-render-mode':
          ui?.setStatus('Display: {mode}', { mode: mutateWithoutObservation(() => renderer.toggleMode()) });
          break;
        case 'translate-selection': {
          const info = selectionInfo() || lastSelection;
          if (info) requestSelectionTranslation(info);
          break;
        }
        case 'selection-delivery':
          if (ui.selectionBubble && message.requestId === selectionRequestId) {
            showSelectionBubble(lastSelection?.range?.getBoundingClientRect() || { left: 20, top: 20, bottom: 40, right: 100 }, message.error || 'Translation', lastSelection?.text || '', message.status === 'error' ? null : message.text, lastSelection?.range || null);
          }
          break;
        default: break;
      }
    });
    try {
      await sendMessage({ type: 'ping', sentAt: Date.now(), url: location.href, documentKey });
      document.documentElement.setAttribute('data-lbt-background-alive', 'true');
    } catch { /* background may still be starting */ }
    try { await sendMessage({ type: 'frame-hello', url: location.href, documentKey }); } catch { /* optional */ }
    mark('lbt:content-boot-end');
    try { performance.measure('lbt:content-boot', 'lbt:content-boot-start', 'lbt:content-boot-end'); } catch { /* noop */ }
  }

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    lastPageHref = location.href;
    sendMessage({ type: 'bfcache-restore', url: location.href, documentKey, translated: false }).catch(() => {});
    setTimeout(() => sendMessage({ type: 'ping', url: location.href, documentKey }).catch(() => {}), 0);
  });

  boot().catch((error) => {
    console.error('[lbt] content boot failed', error);
      LBT.reportClientError('error', error, { phase: 'content-boot' });
  });
})();

