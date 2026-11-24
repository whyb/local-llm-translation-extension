/* Main page translator. Loaded after content/common.js at document_idle. */
(() => {
  'use strict';
  const LBT = globalThis.LBT;
  if (!LBT) return;
  const { api, state, Renderer, sendMessage, getSettings, subscribeSettings, normalizePageKey, mark, debugLog } = LBT;
  const renderer = new Renderer();
  let settings = state.settings;
  let runId = null;
  let runUrl = location.href;
  let extractionTimer = null;
  let mutationObserver = null;
  let navTimer = null;
  let lastPageKey = normalizePageKey(location.href);
  let mutationCount = 0;
  let mutationWindowStart = Date.now();
  let lastSelection = null;
  let selectionRequestId = null;
  let runPaused = false;
  let ui = null;

  const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .lbt-floating { position: fixed; z-index: 2147483646; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; }
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
    .lbt-panel { width: min(280px, calc(100vw - 36px)); border: 1px solid rgba(120,132,160,.25); border-radius: 18px; background: rgba(255,255,255,.94); box-shadow: 0 18px 55px rgba(15,23,42,.2); padding: 14px; backdrop-filter: blur(18px); }
    .lbt-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-weight: 750; margin-bottom: 6px; }
    .lbt-status { color: #61708b; font-size: 12px; min-height: 18px; margin-bottom: 12px; }
    .lbt-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .lbt-actions button { border: 1px solid #d8deea; background: #fff; color: #24324a; border-radius: 10px; padding: 9px 10px; cursor: pointer; font: inherit; }
    .lbt-actions button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
    .lbt-actions button.danger { color: #b42318; }
    .lbt-actions button:disabled { opacity: .45; cursor: default; }
    .lbt-progress { height: 6px; background: #e9edf5; border-radius: 99px; overflow: hidden; margin-top: 10px; }
    .lbt-progress > span { display: block; width: 0; height: 100%; background: linear-gradient(90deg,#2563eb,#7c3aed); transition: width .2s ease; }
    .lbt-hud { position: fixed; z-index: 2147483645; left: 14px; bottom: 14px; background: rgba(15,23,42,.9); color: #fff; border-radius: 12px; padding: 8px 11px; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow: 0 10px 28px rgba(0,0,0,.24); white-space: pre; }
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
      this.translateButton = null;
      this.stopButton = null;
      this.revertButton = null;
      this.fab = null;
      this.hud = null;
      this.selectionButton = null;
      this.selectionBubble = null;
      this.selectionText = null;
      this.selectionRequestId = null;
      this.selectionApply = null;
      this.selectionRange = null;
      this.build();
    }

    build() {
      document.querySelectorAll('[data-lbt-ui]').forEach((node) => node.remove());
      const { host, shadow } = shadowHost('data-lbt-floating-control');
      this.host = host;
      this.shadow = shadow;
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
      });
      this.panel = el('div', 'lbt-panel');
      this.panel.hidden = true;
      const title = el('div', 'lbt-title');
      title.append(el('span', '', 'Local LLM Translator Pro'));
      const close = el('button', 'lbt-close', '×');
      close.style.border = '0'; close.style.background = 'transparent'; close.style.cursor = 'pointer'; close.style.fontSize = '18px';
      close.addEventListener('click', () => { this.panel.hidden = true; });
      title.append(close);
      this.status = el('div', 'lbt-status', 'Ready');
      const actions = el('div', 'lbt-actions');
      this.translateButton = el('button', 'primary', 'Translate');
      this.stopButton = el('button', '', 'Stop');
      this.revertButton = el('button', 'danger', 'Revert');
      const settingsButton = el('button', '', 'Settings');
      this.stopButton.disabled = true;
      this.translateButton.addEventListener('click', async () => {
        this.setStatus('Starting translation…');
        try {
          const response = await sendMessage({ type: 'translate-page', url: location.href });
          if (response?.error) this.setStatus(response.error);
        } catch (error) {
          this.setStatus(`Could not reach the translation service: ${LBT.errorMessage(error)}`);
        }
      });
      this.stopButton.addEventListener('click', () => {
        sendMessage({ type: 'stop', url: location.href }).catch((error) => this.setStatus(LBT.errorMessage(error)));
        this.setTranslating(false);
      });
      this.revertButton.addEventListener('click', () => {
        sendMessage({ type: 'revert', url: location.href }).catch((error) => this.setStatus(LBT.errorMessage(error)));
        mutateWithoutObservation(() => renderer.revertAll());
        runId = null;
        runPaused = false;
        this.setTranslating(false);
        this.setStatus('Original text restored.');
      });
      settingsButton.addEventListener('click', () => {
        sendMessage({ type: 'open-options' }).catch(() => {});
      });
      actions.append(this.translateButton, this.stopButton, this.revertButton, settingsButton);
      const progress = el('div', 'lbt-progress');
      this.progressBar = el('span');
      progress.append(this.progressBar);
      this.panel.append(title, this.status, actions, progress);
      this.fabShell.append(this.fab);
      container.append(this.fabShell, this.panel);
      shadow.append(container);
      this.onDocumentPointerDown = (event) => {
        if (this.panel.hidden) return;
        const path = event.composedPath?.() || [];
        if (path.includes(this.container)) return;
        this.panel.hidden = true;
      };
      this.onDocumentKeyDown = (event) => {
        if (event.key === 'Escape' && !this.panel.hidden) this.panel.hidden = true;
      };
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      document.addEventListener('keydown', this.onDocumentKeyDown, true);
      window.addEventListener('pagehide', () => {
        document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
        document.removeEventListener('keydown', this.onDocumentKeyDown, true);
      }, { once: true });
      this.applyAppearance();
    }

    applyAppearance() {
      if (!this.host) return;
      this.host.style.display = settings.appearance.floatingButtonEnabled ? '' : 'none';
      this.container.dataset.corner = settings.appearance.floatingButtonCorner;
      if (!settings.appearance.hudEnabled) this.removeHud();
      else this.ensureHud();
    }

    setStatus(text) {
      if (this.status) this.status.textContent = text;
    }

    setTranslating(value) {
      this.translating = Boolean(value);
      if (this.translateButton) this.translateButton.disabled = this.translating;
      if (this.stopButton) this.stopButton.disabled = !this.translating;
      if (!this.fab || !this.fabShell) return;
      const complete = this.progress.total > 0 && this.progress.done >= this.progress.total;
      this.fabShell.dataset.active = String(this.translating);
      this.fabShell.dataset.indeterminate = String(this.translating && this.progress.total === 0);
      this.fabShell.dataset.complete = String(complete && !this.translating);
      this.fab.classList.remove('is-progress');
      this.fabBadge.textContent = this.translating ? '…' : complete ? '✓' : '';
      this.fabBadge.hidden = !this.fabBadge.textContent;
      this.fab.title = this.translating ? 'Local LLM Translator Pro — translating' : complete ? 'Local LLM Translator Pro — complete' : 'Local LLM Translator Pro';
      this.fab.setAttribute('aria-label', this.fab.title);
      if (this.translating) this.fabShell.style.setProperty('--lbt-fab-progress', '0%');
    }

    setProgress(done, total) {
      this.progress = { done: Number(done) || 0, total: Number(total) || 0 };
      const ratio = this.progress.total > 0 ? Math.min(1, this.progress.done / this.progress.total) : 0;
      const percent = Math.round(ratio * 100);
      if (this.progressBar) this.progressBar.style.width = `${percent}%`;
      if (this.fabShell) {
        this.fabShell.style.setProperty('--lbt-fab-progress', `${percent}%`);
        this.fabShell.dataset.active = String(this.translating);
        this.fabShell.dataset.indeterminate = String(this.translating && this.progress.total === 0);
        this.fabShell.dataset.complete = String(this.progress.total > 0 && this.progress.done >= this.progress.total);
      }
      if (this.fab && this.progress.total > 0) {
        const complete = this.progress.done >= this.progress.total;
        this.fabBadge.textContent = complete ? '✓' : `${percent}%`;
        this.fabBadge.hidden = false;
        this.fab.classList.toggle('is-progress', !complete);
        const label = `Local LLM Translator Pro — ${this.progress.done}/${this.progress.total} (${percent}%)`;
        this.fab.title = label;
        this.fab.setAttribute('aria-label', label);
      } else if (this.fab && this.translating) {
        this.fabBadge.textContent = '…';
        this.fabBadge.hidden = false;
        this.fab.classList.remove('is-progress');
      }
      if (this.progress.total > 0) this.setStatus(`${this.progress.done} / ${this.progress.total} segments`);
      this.updateHud();
    }

    ensureHud() {
      if (this.hud || !this.shadow) return;
      this.hud = el('div', 'lbt-hud', 'LLMT\nidle');
      this.shadow.append(this.hud);
    }

    removeHud() {
      this.hud?.remove();
      this.hud = null;
    }

    updateHud() {
      if (!settings.appearance.hudEnabled) return;
      this.ensureHud();
      if (!this.hud) return;
      const ratio = this.progress.total ? Math.round((this.progress.done / this.progress.total) * 100) : 0;
      this.hud.textContent = `LLMT ${this.translating ? 'translating' : 'idle'}\n${this.progress.done}/${this.progress.total} (${ratio}%)\n${runId ? runId.slice(0, 18) : 'no run'}`;
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
    if (!runId || !units.length) return;
    const ceiling = Number(settings.speed.runaway.pageUnitCeiling) || 500;
    const limited = units.slice(0, ceiling);
    try {
      await sendMessage({
        type: 'units-report',
        url: runUrl,
        runId,
        units: limited.map(unitPayload)
      });
    } catch (error) {
      debugLog('units-report failed', LBT.errorMessage(error));
    }
  }

  async function extractAndReport(onlyNew = true) {
    const units = LBT.extractAll(onlyNew);
    if (!units.length) return;
    await reportUnits(units);
  }

  function scheduleExtraction() {
    if (!runId) return;
    if (extractionTimer) clearTimeout(extractionTimer);
    extractionTimer = setTimeout(() => {
      extractionTimer = null;
      extractAndReport(true).catch(() => {});
    }, 300);
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
      const relevant = mutations.some((mutation) => {
        if (mutation.type === 'childList') return [...mutation.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE);
        return mutation.type === 'characterData' || mutation.type === 'attributes';
      });
      if (relevant) scheduleExtraction();
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'aria-hidden'] });
  }

  function stopObserver() {
    mutationObserver?.disconnect();
    mutationObserver = null;
    if (extractionTimer) clearTimeout(extractionTimer);
    extractionTimer = null;
  }

  function beginRun(message) {
    runId = message.runId;
    runUrl = message.url || location.href;
    runPaused = false;
    mutationCount = 0;
    mutationWindowStart = Date.now();
    ui?.setProgress(0, 0);
    ui?.setTranslating(true);
    ui?.setStatus('Translating page…');
    LBT.keepAlivePort(runId, runUrl);
    mark('lbt:run-begin');
    installMutationObserver();
    extractAndReport(false).catch(() => {});
  }

  function applyDelivery(message) {
    if (!runId || runPaused || message.runId !== runId || !Array.isArray(message.segments)) return;
    mutateWithoutObservation(() => {
      for (const segment of message.segments) renderer.apply(segment.unitId, segment.text);
    });
    mark('lbt:first-segment-committed');
  }

  function progress(message) {
    if (message.runId && runId && message.runId !== runId) return;
    const total = Number(message.total) || 0;
    const done = Number(message.done) || 0;
    ui?.setProgress(done, total);
    if (message.state === 'error') {
      runId = null;
      runPaused = false;
      ui?.setTranslating(false);
      ui?.setStatus(message.notice?.message || 'Translation failed.');
      return;
    }
    if (message.state === 'paused') {
      runPaused = true;
      ui?.setTranslating(false);
      ui?.setStatus(message.notice?.message || 'Translation paused.');
      return;
    }
    if (total > 0 && done >= total) {
      runPaused = false;
      ui?.setTranslating(false);
      ui?.setStatus('Translation complete.');
      mark('lbt:run-settled');
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
    const button = el('button', 'lbt-sel-button', 'Translate selection');
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
      debugLog('selection request failed', LBT.errorMessage(error));
    }
  }

  function showSelectionBubble(rect, statusText, sourceText, translation = null, range = null) {
    if (!ui?.shadow) return;
    if (ui.selectionBubble) ui.selectionBubble.remove();
    const bubble = el('div', 'lbt-sel-bubble');
    bubble.append(el('div', 'lbt-sel-label', 'Selection'));
    const text = el('div', 'lbt-sel-text', translation || statusText);
    bubble.append(text);
    const actions = el('div', 'lbt-sel-actions');
    if (translation) {
      const copy = el('button', '', 'Copy');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(translation); copy.textContent = 'Copied'; } catch { /* noop */ }
      });
      const apply = el('button', 'primary', 'Replace selection');
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
    const close = el('button', '', 'Close');
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

  function installNavigationWatcher() {
    const check = () => {
      const key = normalizePageKey(location.href);
      if (key === lastPageKey) return;
      const previous = lastPageKey;
      lastPageKey = key;
      sendMessage({ type: 'spa-navigate', url: location.href, key, previousKey: previous }).catch(() => {});
      renderer.revertAll();
      stopObserver();
      runId = null;
      ui?.setTranslating(false);
      ui?.setStatus('Page changed. Translate again to continue.');
      lastSelection = null;
      hideSelectionUi();
    };
    window.addEventListener('popstate', check);
    window.addEventListener('hashchange', check);
    navTimer = setInterval(check, 800);
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
    renderer.mode = settings.translation.renderMode;
    ui = new PageUi();
    subscribeSettings((next) => {
      settings = next;
      renderer.mode = next.translation.renderMode;
      ui?.applyAppearance();
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
        case 'run-cancel':
          stopObserver();
          runId = null;
          runPaused = false;
          ui?.setProgress(0, 0);
          ui?.setTranslating(false);
          ui?.setStatus('Translation stopped.');
          state.keepAlive?.close?.();
          break;
        case 'run-revert':
          stopObserver();
          mutateWithoutObservation(() => renderer.revertAll());
          runId = null;
          runPaused = false;
          ui?.setProgress(0, 0);
          ui?.setTranslating(false);
          ui?.setStatus('Original text restored.');
          state.keepAlive?.close?.();
          break;
        case 'run-settled':
          if (!settings.speed.prefetch.idleFill) stopObserver();
          ui?.setTranslating(false);
          break;
        case 'run-resume':
          if (message.runId && runId !== message.runId) {
            runId = message.runId;
            runUrl = message.url || location.href;
            ui?.setTranslating(true);
            installMutationObserver();
            extractAndReport(false).catch(() => {});
          }
          break;
        case 'toggle-render-mode':
          ui?.setStatus(`Display: ${mutateWithoutObservation(() => renderer.toggleMode())}`);
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
      await sendMessage({ type: 'ping', sentAt: Date.now() });
      document.documentElement.setAttribute('data-lbt-background-alive', 'true');
    } catch { /* background may still be starting */ }
    try { await sendMessage({ type: 'frame-hello' }); } catch { /* optional */ }
    mark('lbt:content-boot-end');
    try { performance.measure('lbt:content-boot', 'lbt:content-boot-start', 'lbt:content-boot-end'); } catch { /* noop */ }
  }

  window.addEventListener('pagehide', (event) => { if (!event.persisted) state.keepAlive?.close?.(); });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) sendMessage({ type: 'bfcache-restore', url: location.href, translated: Boolean(runId) }).catch(() => {});
  });

  boot().catch((error) => {
    console.error('[lbt] content boot failed', error);
  });
})();

