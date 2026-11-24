/* global globalThis, document, window, Node, NodeFilter, Element, HTMLInputElement, HTMLTextAreaElement */
(() => {
  'use strict';

  const contentIsFirefox = /Firefox/i.test(navigator.userAgent);
  const api = contentIsFirefox
    ? globalThis.browser ?? globalThis.chrome
    : globalThis.chrome ?? globalThis.browser;
  const SETTINGS_KEY = 'lbt.settings';
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed', 'select', 'option', 'textarea']);
  const SKIP_ANCESTOR_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'select', 'textarea']);
  const ATTRIBUTE_NAMES = ['title', 'alt', 'placeholder', 'aria-label', 'value'];
  const TRACKING_PARAMS = [
    'utm_*', 'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid',
    'twclid', 'ttclid', 'mc_cid', 'mc_eid', 'igshid', '_ga', '_gl', '_hsenc', '_hsmi',
    'hsctatracking', 'mkt_tok', 's_cid', 'vero_id', 'wickedid', 'oly_anon_id', 'oly_enc_id',
    'jsessionid', 'phpsessid', 'aspsessionid*', 'sid', 'sessid', 'session', 'sessionid', 'session_id'
  ];

  const DEFAULT_CONTENT_SETTINGS = {
    translation: {
      targetLang: 'en', renderMode: 'replace', formality: 'default', glossary: [], customPromptAdditions: '',
      pinCustomPromptToPrefix: false, layoutGuards: { whitespace: true, bidi: true, clippedExpansion: true, rubyWbr: true, maxExpansionRatio: 1.5 }
    },
    speed: {
      engineMode: 'llm-only',
      prefetch: { hoverPrefetch: false, idleFill: true, nextNavPrediction: false },
      runaway: { pageUnitCeiling: 500, mutationStormDetection: true, mutationStormWindowMs: 3000, mutationStormMaxMutations: 300 },
      contentMemory: { maxRetainedOriginals: 5000 }
    },
    appearance: {
      glow: { enabled: true, pendingColor: '#7aa2f7', freshColor: '#9ece6a', cooldownMs: 1200, pendingStyle: 'text-glow', freshStyle: 'pop', reducedIntensity: false },
      floatingButtonEnabled: true, floatingButtonCorner: 'bottom-right', selectionButtonEnabled: true, hudEnabled: false
    },
    behaviour: { autoTranslateDefault: 'ask', allSitesEnabled: false, hotkeys: {}, siteRules: [], enabledSites: [] },
    exclusions: {
      structural: true, perSegmentLanguage: true, nonLinguistic: true,
      zones: { ads: false, cookieBanners: true, editableFields: true, thirdPartyIframes: false, hiddenContent: true },
      domainSelectorRules: [], attributes: { enabled: true, title: false, alt: false, placeholder: true, ariaLabel: false, buttonValue: true },
      language: { inheritPageLanguage: true }
    },
    robustness: { hostilePage: { enabled: true }, runKeepAlive: { enabled: true, intervalMs: 12000 }, verboseLogging: false },
    cache: { urlNormalisation: { enabled: true, stripParams: TRACKING_PARAMS, stripFragment: true, domainOverrides: [] } }
  };

  const state = {
    settings: DEFAULT_CONTENT_SETTINGS,
    unitSeq: 0,
    unitIdByNode: new WeakMap(),
    unitByNode: new WeakMap(),
    attributeUnitByElement: new WeakMap(),
    unitById: new Map(),
    originals: new Map(),
    earlyNodeIds: new WeakMap(),
    translationByUnit: new Map(),
    runId: null,
    runUrl: '',
    processedNodes: new WeakSet(),
    processedAttributes: new WeakSet(),
    observer: null,
    debounceTimer: null,
    lastHref: location.href,
    keepAlive: null
  };

  function clone(value) {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
  }

  function merge(target, source) {
    if (!source || typeof source !== 'object') return target;
    const output = Array.isArray(target) ? target.slice() : { ...target };
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object') {
        output[key] = merge(output[key], value);
      } else {
        output[key] = value;
      }
    }
    return output;
  }

  function normalizeContentSettings(raw) {
    return merge(clone(DEFAULT_CONTENT_SETTINGS), raw && typeof raw === 'object' ? raw : {});
  }

  async function getSettings() {
    try {
      const values = await api.storage.local.get(SETTINGS_KEY);
      state.settings = normalizeContentSettings(values?.[SETTINGS_KEY]);
    } catch {
      state.settings = clone(DEFAULT_CONTENT_SETTINGS);
    }
    return state.settings;
  }

  function subscribeSettings(handler) {
    const listener = (changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      state.settings = normalizeContentSettings(changes[SETTINGS_KEY].newValue);
      handler?.(state.settings);
    };
    api.storage.onChanged.addListener(listener);
    return () => api.storage.onChanged.removeListener(listener);
  }

  async function sendMessage(message) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await api.runtime.sendMessage(message);
      } catch (error) {
        lastError = error;
        const text = error instanceof Error ? error.message : String(error);
        const transient = /Receiving end does not exist|Could not establish connection/i.test(text);
        if (!transient || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function normalizeDomain(hostname) {
    return String(hostname || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  }

  function domainMatches(hostname, domain) {
    const host = normalizeDomain(hostname);
    const candidate = normalizeDomain(domain);
    return Boolean(host && candidate && (host === candidate || host.endsWith(`.${candidate}`)));
  }

  function sameSite(a, b) {
    try {
      const left = new URL(a);
      const right = new URL(b);
      return domainMatches(left.hostname, right.hostname) || domainMatches(right.hostname, left.hostname);
    } catch {
      return false;
    }
  }

  function normalizeLanguage(value) {
    if (typeof value !== 'string') return null;
    const match = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{1,8})*$/.exec(value.trim());
    return match ? value.trim().split('-')[0].toLowerCase() : null;
  }

  function detectLanguage(value, fallback = null) {
    const sample = String(value || '').slice(0, 4000);
    if ((sample.match(/[\u3040-\u30ff]/g) || []).length >= 2) return 'ja';
    if ((sample.match(/[\uac00-\ud7af]/g) || []).length >= 2) return 'ko';
    if ((sample.match(/[\u0400-\u04ff]/g) || []).length >= 4) return 'ru';
    if ((sample.match(/[\u0600-\u06ff]/g) || []).length >= 4) return 'ar';
    if ((sample.match(/[\u4e00-\u9fff]/g) || []).length >= 2) return 'zh';
    return normalizeLanguage(fallback);
  }

  function classifyZone(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return 'main';
    let current = element;
    while (current && current !== document.documentElement) {
      const tag = current.tagName?.toLowerCase() || '';
      const role = (current.getAttribute?.('role') || '').toLowerCase();
      const className = current.getAttribute?.('class') || '';
      if (/cookie|consent|gdpr|cookiebot|onetrust/i.test(className) || /cookie|consent/i.test(role)) return 'boilerplate';
      if (/advert|sponsor|promo|adslot|adsbygoogle/i.test(className) || role === 'advertisement') return 'ad';
      if (role === 'navigation' || tag === 'nav' || tag === 'menu') return 'nav';
      if (role === 'complementary' || tag === 'aside') return 'aside';
      if (role === 'contentinfo' || tag === 'footer' || /footer/i.test(className)) return 'footer';
      if (/related|recommend|more-stories|read-next/i.test(className)) return 'related';
      if (/^h[1-6]$/.test(tag) || role === 'heading') return 'heading';
      current = current.parentElement;
    }
    return 'main';
  }

  function zoneWeight(zone) {
    return Number(state.settings.speed?.zoneWeights?.[zone] ?? state.settings.speed?.zoneWeights?.main ?? 1);
  }

  function isManaged(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(element.closest?.('[data-lbt-ui], [data-lbt-managed]'));
  }

  function isHidden(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.hasAttribute('hidden')) return true;
    if (element.getAttribute('aria-hidden') === 'true') return true;
    const inline = element.getAttribute('style') || '';
    if (/(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(inline)) return true;
    return false;
  }

  function isEditable(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.isContentEditable) return true;
    const tag = element.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      return type !== 'button' && type !== 'submit' && type !== 'reset' && type !== 'image';
    }
    return false;
  }

  function isSensitiveInput(element) {
    return element?.tagName?.toLowerCase() === 'input' && (element.getAttribute('type') || '').toLowerCase() === 'password';
  }

  function shouldSkipElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
    if (isManaged(element)) return true;
    const settings = state.settings;
    const tag = element.tagName.toLowerCase();
    if (SKIP_ANCESTOR_TAGS.has(tag)) return true;
    if (isSensitiveInput(element)) return true;
    if (isEditable(element)) return true;
    if (settings.exclusions?.zones?.hiddenContent && isHidden(element)) return true;
    if (settings.exclusions?.zones?.cookieBanners && classifyZone(element) === 'boilerplate') return true;
    if (settings.exclusions?.zones?.ads && classifyZone(element) === 'ad') return true;
    if (settings.exclusions?.domainSelectorRules) {
      const domain = location.hostname;
      for (const rule of settings.exclusions.domainSelectorRules) {
        if (!domainMatches(domain, rule.domain)) continue;
        for (const selector of rule.deny || []) {
          try { if (element.matches(selector)) return true; } catch { /* invalid selector */ }
        }
      }
    }
    return false;
  }

  function meaningfulText(value) {
    return /[\p{L}\p{N}]/u.test(String(value || ''));
  }

  function splitWhitespace(value) {
    const raw = String(value || '');
    const leading = raw.match(/^\s*/u)?.[0] || '';
    const trailing = raw.match(/\s*$/u)?.[0] || '';
    return { text: raw.slice(leading.length, raw.length - trailing.length), leading, trailing };
  }

  function originalTextFor(node) {
    const original = state.originals.get(node);
    return original?.kind === 'text' ? original.original : node.nodeValue;
  }

  function nextUnitId(prefix) {
    state.unitSeq += 1;
    return `${prefix}-u${state.unitSeq}`;
  }

  function shouldSkipTextNode(node) {
    const element = node.parentElement;
    if (!element) return true;
    let current = element;
    while (current && current !== document.documentElement) {
      if (SKIP_TAGS.has(current.tagName?.toLowerCase() || '')) return true;
      if (shouldSkipElement(current)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function extractTextUnits(root = document.documentElement, { onlyNew = true } = {}) {
    const units = [];
    if (!root) return units;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (shouldSkipTextNode(node)) return NodeFilter.FILTER_REJECT;
        const value = originalTextFor(node);
        return meaningfulText(value) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (onlyNew && state.processedNodes.has(node)) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const source = originalTextFor(node);
      const parts = splitWhitespace(source);
      if (!meaningfulText(parts.text)) continue;
      let id = state.unitIdByNode.get(node);
      if (!id) {
        id = nextUnitId('lbt');
        state.unitIdByNode.set(node, id);
      }
      const zone = classifyZone(parent);
      const unit = {
        id,
        kind: 'text',
        text: parts.text,
        leading: parts.leading,
        trailing: parts.trailing,
        zone,
        srcLang: detectLanguage(parts.text, parent.closest?.('[lang]')?.getAttribute('lang') || document.documentElement.getAttribute('lang')),
        priority: { zoneWeight: zoneWeight(zone), viewportProximity: 1, visibilityFactor: 1 },
        node
      };
      state.unitByNode.set(node, unit);
      state.unitById.set(id, unit);
      state.processedNodes.add(node);
      units.push(unit);
    }
    return units;
  }

  function attributeIsEnabled(attribute) {
    const attrs = state.settings.exclusions?.attributes;
    if (!attrs?.enabled) return false;
    if (attribute === 'title') return attrs.title;
    if (attribute === 'alt') return attrs.alt;
    if (attribute === 'placeholder') return attrs.placeholder;
    if (attribute === 'aria-label') return attrs.ariaLabel;
    if (attribute === 'value') return attrs.buttonValue;
    return false;
  }

  function attributeApplies(element, attribute) {
    const tag = element.tagName.toLowerCase();
    if (attribute === 'alt') return tag === 'img' || tag === 'area' || (tag === 'input' && (element.getAttribute('type') || '').toLowerCase() === 'image');
    if (attribute === 'placeholder') return tag === 'input' || tag === 'textarea';
    if (attribute === 'value') return tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes((element.getAttribute('type') || 'text').toLowerCase()));
    return true;
  }

  function extractAttributeUnits(root = document.documentElement, { onlyNew = true } = {}) {
    const units = [];
    if (!root) return units;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        return shouldSkipElement(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const elements = [];
    if (root.nodeType === Node.ELEMENT_NODE) elements.push(root);
    while (walker.nextNode()) elements.push(walker.currentNode);
    for (const element of elements) {
      if (shouldSkipElement(element)) continue;
      for (const attribute of ATTRIBUTE_NAMES) {
        if (!attributeIsEnabled(attribute) || !attributeApplies(element, attribute)) continue;
        const value = element.getAttribute(attribute);
        if (value === null || !meaningfulText(value)) continue;
        let set = state.attributeUnitByElement.get(element);
        if (!set) { set = new Set(); state.attributeUnitByElement.set(element, set); }
        const key = `${attribute}:${value}`;
        if (onlyNew && set.has(key)) continue;
        set.add(key);
        const zone = classifyZone(element);
        const id = nextUnitId('lbt-a');
        const unit = {
          id,
          kind: 'attribute',
          text: value,
          attribute,
          zone,
          srcLang: detectLanguage(value, element.closest?.('[lang]')?.getAttribute('lang') || document.documentElement.getAttribute('lang')),
          priority: { zoneWeight: zoneWeight(zone), viewportProximity: 1, visibilityFactor: 1 },
          element
        };
        state.unitById.set(id, unit);
        units.push(unit);
      }
    }
    return units;
  }

  function extractAll(onlyNew = true) {
    return [...extractTextUnits(document.documentElement, { onlyNew }), ...extractAttributeUnits(document.documentElement, { onlyNew })];
  }


  let hoverTooltip = null;
  let hoverTarget = null;
  let hoverListenersInstalled = false;

  function ensureHoverTooltip() {
    if (hoverTooltip?.host?.isConnected) return hoverTooltip;
    const host = document.createElement('div');
    host.setAttribute('data-lbt-ui', '');
    host.setAttribute('data-lbt-tooltip-host', '');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .lbt-hover-tooltip {
        position: fixed;
        z-index: 2147483647;
        left: 0;
        top: 0;
        width: max-content;
        max-width: min(420px, calc(100vw - 20px));
        padding: 8px 10px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 9px;
        background: rgba(17,24,39,.96);
        color: #fff;
        box-shadow: 0 12px 32px rgba(15,23,42,.34);
        font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: start;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        pointer-events: none;
        box-sizing: border-box;
      }
      .lbt-hover-tooltip[hidden] { display: none !important; }
      .lbt-hover-arrow {
        position: absolute;
        width: 8px;
        height: 8px;
        background: rgba(17,24,39,.96);
        transform: translateX(-50%) rotate(45deg);
      }
      .lbt-hover-tooltip[data-placement="top"] .lbt-hover-arrow {
        bottom: -4px;
        border-right: 1px solid rgba(255,255,255,.16);
        border-bottom: 1px solid rgba(255,255,255,.16);
      }
      .lbt-hover-tooltip[data-placement="bottom"] .lbt-hover-arrow {
        top: -4px;
        border-left: 1px solid rgba(255,255,255,.16);
        border-top: 1px solid rgba(255,255,255,.16);
      }
    `;
    const box = document.createElement('div');
    box.className = 'lbt-hover-tooltip';
    box.hidden = true;
    const text = document.createElement('div');
    const arrow = document.createElement('span');
    arrow.className = 'lbt-hover-arrow';
    box.append(text, arrow);
    shadow.append(style, box);
    (document.documentElement || document.body)?.append(host);
    hoverTooltip = { host, box, text, arrow };
    return hoverTooltip;
  }

  function hideHoverTooltip() {
    hoverTarget = null;
    if (hoverTooltip?.box) hoverTooltip.box.hidden = true;
  }

  function positionHoverTooltip(target) {
    if (!target?.isConnected) {
      hideHoverTooltip();
      return;
    }
    const original = target.getAttribute('data-lbt-original');
    if (!original) {
      hideHoverTooltip();
      return;
    }
    const ui = ensureHoverTooltip();
    if (!ui?.box) return;
    ui.text.textContent = original;
    ui.box.hidden = false;

    const rects = target.getClientRects();
    const targetRect = rects.length ? rects[0] : target.getBoundingClientRect();
    if (targetRect.width === 0 && targetRect.height === 0) {
      hideHoverTooltip();
      return;
    }
    const tipRect = ui.box.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const vw = window.innerWidth || document.documentElement.clientWidth || 800;
    const vh = window.innerHeight || document.documentElement.clientHeight || 600;

    let placement = 'top';
    let top = targetRect.top - tipRect.height - gap;
    if (top < margin && targetRect.bottom + tipRect.height + gap <= vh - margin) {
      placement = 'bottom';
      top = targetRect.bottom + gap;
    } else if (top < margin) {
      placement = 'bottom';
      top = Math.min(vh - tipRect.height - margin, Math.max(margin, targetRect.bottom + gap));
    }

    const centerX = targetRect.left + targetRect.width / 2;
    const left = Math.min(
      Math.max(margin, centerX - tipRect.width / 2),
      Math.max(margin, vw - tipRect.width - margin)
    );
    const arrowLeft = Math.min(Math.max(12, centerX - left), Math.max(12, tipRect.width - 12));

    ui.box.dataset.placement = placement;
    ui.box.style.left = `${Math.round(left)}px`;
    ui.box.style.top = `${Math.round(top)}px`;
    ui.arrow.style.left = `${Math.round(arrowLeft)}px`;
  }

  function resolveHoverTarget(node) {
    if (!node || typeof node.closest !== 'function') return null;
    return node.closest('.lbt-replace-hover-reveal .lbt-translated[data-lbt-original]');
  }

  function installHoverTooltipListeners() {
    if (hoverListenersInstalled) return;
    hoverListenersInstalled = true;
    document.addEventListener('pointerover', (event) => {
      const target = resolveHoverTarget(event.target);
      if (!target) return;
      hoverTarget = target;
      positionHoverTooltip(target);
    }, true);
    document.addEventListener('pointerout', (event) => {
      if (!hoverTarget) return;
      const related = resolveHoverTarget(event.relatedTarget);
      if (related === hoverTarget) return;
      if (related) {
        hoverTarget = related;
        positionHoverTooltip(related);
      } else {
        hideHoverTooltip();
      }
    }, true);
    document.addEventListener('focusin', (event) => {
      const target = resolveHoverTarget(event.target);
      if (!target) return;
      hoverTarget = target;
      positionHoverTooltip(target);
    }, true);
    document.addEventListener('focusout', (event) => {
      if (hoverTarget && event.target === hoverTarget) hideHoverTooltip();
    }, true);
    window.addEventListener('scroll', () => {
      if (hoverTarget) positionHoverTooltip(hoverTarget);
    }, { capture: true, passive: true });
    window.addEventListener('resize', () => {
      if (hoverTarget) positionHoverTooltip(hoverTarget);
    }, { passive: true });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && hoverTarget) hideHoverTooltip();
    }, true);
  }

  function setNodeText(node, translated, unit, mode) {
    const existing = state.originals.get(node);
    if (existing?.wrapper) {
      const translation = existing.wrapper.querySelector('.lbt-translated');
      if (translation) {
        translation.textContent = `${unit.leading ?? ''}${translated}${unit.trailing ?? ''}`;
        if (translation.dataset.lbtOriginal !== undefined) translation.setAttribute('data-lbt-original', existing.original);
      }
      return;
    }
    const original = existing?.original ?? originalTextFor(node);
    const leading = unit.leading ?? '';
    const trailing = unit.trailing ?? '';
    if (mode === 'replace') {
      if (!existing) state.originals.set(node, { kind: 'text', node, original, wrapper: null, unitId: unit.id });
      node.nodeValue = `${leading}${translated}${trailing}`;
      return;
    }
    const parent = node.parentElement;
    if (!parent) return;
    const wrapper = document.createElement('span');
    wrapper.className = mode === 'bilingual-stacked' ? 'lbt-bilingual-stacked' : 'lbt-replace-hover-reveal';
    wrapper.setAttribute('data-lbt-managed', '');
    const originalSpan = document.createElement('span');
    originalSpan.className = 'lbt-original';
    const translatedSpan = document.createElement('span');
    translatedSpan.className = 'lbt-translated';
    translatedSpan.textContent = `${leading}${translated}${trailing}`;
    if (mode === 'replace-hover-reveal') {
      translatedSpan.setAttribute('data-lbt-original', original);
      translatedSpan.tabIndex = 0;
      installHoverTooltipListeners();
    }
    node.nodeValue = `${leading}${original}${trailing}`;
    parent.insertBefore(wrapper, node);
    wrapper.append(originalSpan, translatedSpan);
    originalSpan.append(node);
    state.originals.set(node, { kind: 'text', node, original, wrapper, unitId: unit.id });
  }

  function setAttributeText(element, attribute, translated, unit) {
    if (!state.originals.has(element)) state.originals.set(element, { kind: 'attributes', element, values: new Map() });
    const entry = state.originals.get(element);
    if (!entry.values.has(attribute)) entry.values.set(attribute, element.getAttribute(attribute));
    element.setAttribute(attribute, translated);
    entry.unitId = unit.id;
  }

  class Renderer {
    constructor() {
      this.mode = state.settings.translation.renderMode;
      this.translations = state.translationByUnit;
    }

    setMode(mode) {
      if (mode === this.mode) return;
      this.mode = mode;
      const entries = [...this.translations.entries()];
      this.revertAll(false);
      for (const [unitId, payload] of entries) this.apply(unitId, payload.translated ?? payload.translation, payload.unit);
    }

    toggleMode() {
      const modes = ['replace', 'bilingual-stacked', 'replace-hover-reveal'];
      const index = modes.indexOf(this.mode);
      this.setMode(modes[(index + 1) % modes.length]);
      return this.mode;
    }

    apply(unitId, translated, unit = state.unitById.get(unitId)) {
      if (!unit || typeof translated !== 'string') return false;
      this.translations.set(unitId, { translated, unit });
      if (unit.kind === 'attribute') {
        setAttributeText(unit.element, unit.attribute, translated, unit);
        return true;
      }
      if (!unit.node?.isConnected) return false;
      setNodeText(unit.node, translated, unit, this.mode);
      return true;
    }

    revertText(entry) {
      if (entry.wrapper) {
        try {
          const parent = entry.wrapper.parentNode;
          if (parent) {
            parent.insertBefore(entry.node, entry.wrapper);
            parent.removeChild(entry.wrapper);
          }
          entry.node.nodeValue = entry.original;
        } catch { /* noop */ }
      } else if (entry.node?.isConnected) {
        entry.node.nodeValue = entry.original;
      }
    }

    revertAttribute(entry) {
      for (const [attribute, value] of entry.values || []) {
        try {
          if (value === null) entry.element.removeAttribute(attribute);
          else entry.element.setAttribute(attribute, value);
        } catch { /* noop */ }
      }
    }

    revertAll(clearTranslations = true) {
      for (const entry of state.originals.values()) {
        if (entry.kind === 'text') this.revertText(entry);
        else if (entry.kind === 'attributes') this.revertAttribute(entry);
      }
      state.originals.clear();
      state.processedNodes = new WeakSet();
      state.processedAttributes = new WeakSet();
      state.unitByNode = new WeakMap();
      state.unitIdByNode = new WeakMap();
      state.attributeUnitByElement = new WeakMap();
      state.unitById.clear();
      hideHoverTooltip();
      if (clearTranslations) this.translations.clear();
    }
  }

  function applyEarlyTranslation(node, translation) {
    const unit = state.unitByNode.get(node);
    const original = originalTextFor(node);
    if (!state.originals.has(node)) {
      state.originals.set(node, { kind: 'text', node, original, wrapper: null, unitId: unit?.id ?? '' });
    }
    const parts = splitWhitespace(original);
    node.nodeValue = `${parts.leading}${translation}${parts.trailing}`;
  }

  function keepAlivePort(runId, url) {
    state.keepAlive?.close?.();
    const settings = state.settings.robustness?.runKeepAlive;
    if (!settings?.enabled || !api.runtime.connect) return null;
    let port;
    try { port = api.runtime.connect({ name: 'lbt.run.keepalive' }); } catch { return null; }
    const timer = setInterval(() => {
      try { port.postMessage({ type: 'run-port-keepalive', runId, url }); } catch { /* disconnected */ }
    }, Math.max(1000, Number(settings.intervalMs) || 12000));
    const close = () => { clearInterval(timer); try { port.disconnect(); } catch { /* noop */ } };
    state.keepAlive = { port, close };
    return state.keepAlive;
  }

  function normalizePageKey(value) {
    try {
      const url = new URL(value);
      const config = state.settings.cache?.urlNormalisation || {};
      if (config.enabled !== false) {
        const keep = [];
        for (const override of config.domainOverrides || []) {
          if (!domainMatches(url.hostname, override.domain)) continue;
          keep.push(...(override.keepParams || []));
        }
        if (url.search) {
          const retained = [];
          for (const part of url.search.slice(1).split('&')) {
            if (!part) continue;
            const name = decodeURIComponent(part.split('=')[0] || '').toLowerCase();
            if (keep.some((pattern) => pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern)
              || !(config.stripParams || TRACKING_PARAMS).some((pattern) => pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern)) {
              retained.push(part);
            }
          }
          url.search = retained.join('&');
        }
        if (config.stripFragment !== false && !url.hash.startsWith('#/') && !url.hash.startsWith('#!')) url.hash = '';
      }
      return url.toString();
    } catch {
      return value;
    }
  }

  function debugLog(...args) {
    if (!state.settings.robustness?.verboseLogging) return;
    try { console.info('[lbt]', ...args); } catch { /* noop */ }
  }

  function mark(name) {
    try { performance.mark(name); } catch { /* noop */ }
  }

  globalThis.LBT = {
    api,
    state,
    Renderer,
    getSettings,
    subscribeSettings,
    sendMessage,
    errorMessage,
    domainMatches,
    sameSite,
    normalizeLanguage,
    detectLanguage,
    classifyZone,
    zoneWeight,
    extractTextUnits,
    extractAttributeUnits,
    extractAll,
    originalTextFor,
    applyEarlyTranslation,
    keepAlivePort,
    normalizePageKey,
    debugLog,
    mark,
    TRACKING_PARAMS,
    DEFAULT_CONTENT_SETTINGS
  };
})();
