/* iframe translator. Loaded after content/common.js in every frame. */
(() => {
  'use strict';
  const LBT = globalThis.LBT;
  if (!LBT || window.top === window) return;
  const { state, Renderer, sendMessage, getSettings, subscribeSettings, sameSite, debugLog } = LBT;
  const renderer = new Renderer();
  let settings = state.settings;
  let runId = null;
  let runUrl = location.href;
  let timer = null;
  let observer = null;
  const framePrefix = `f${Math.random().toString(36).slice(2, 10)}-`;
  const documentKey = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let inventoryRevision = 0;

  function payload(unit) {
    return { id: framePrefix + unit.id, kind: unit.kind, text: unit.text, zone: unit.zone, srcLang: unit.srcLang, attribute: unit.attribute ?? null, priority: unit.priority ?? null };
  }

  async function report() {
    if (!runId) return;
    const units = LBT.extractAll(false);
    inventoryRevision += 1;
    try {
      await sendMessage({
        type: 'units-report',
        url: runUrl,
        runId,
        documentKey,
        snapshot: true,
        inventoryRevision,
        units: units.slice(0, Math.min(5000, Math.max(1, Number(settings.speed.runaway.pageUnitCeiling) || 5000))).map(payload)
      });
    } catch (error) {
      debugLog('frame units report failed', LBT.errorMessage(error));
    }
  }

  function schedule() {
    if (!runId) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; report().catch(() => {}); }, 300);
  }

  function installObserver() {
    if (observer) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'hidden', 'aria-hidden', 'title', 'alt', 'placeholder', 'aria-label', 'value'] });
  }

  function skipFrame(url) {
    if (!(innerWidth > 0 && innerHeight > 0)) return true;
    if (settings.exclusions?.zones?.thirdPartyIframes && !sameSite(location.href, url)) return true;
    return false;
  }

  function begin(message) {
    if (skipFrame(message.url || location.href)) return;
    runId = message.runId;
    runUrl = message.url || location.href;
    LBT.keepAlivePort(runId, runUrl);
    installObserver();
    report().catch(() => {});
  }

  function delivery(message) {
    if (message.runId !== runId || !Array.isArray(message.segments)) return;
    const applied = [];
    for (const segment of message.segments) {
      if (renderer.apply(segment.unitId, segment.text)) applied.push(segment.unitId);
    }
    if (applied.length) {
      sendMessage({ type: 'segment-applied', url: runUrl, runId, documentKey, unitIds: applied }).catch(() => {});
    }
  }

  async function boot() {
    settings = await getSettings();
    renderer.mode = settings.translation.renderMode;
    subscribeSettings((next) => { settings = next; renderer.mode = next.translation.renderMode; });
    try { await sendMessage({ type: 'frame-hello', url: location.href, documentKey }); } catch { /* background may be starting */ }
    document.documentElement.setAttribute('data-lbt-frame-loaded', 'true');
    LBT.api.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'run-begin': begin(message); break;
        case 'segment-delivery': delivery(message); break;
        case 'progress-update': break;
        case 'run-cancel':
          runId = null; observer?.disconnect(); observer = null; break;
        case 'run-revert':
          runId = null; renderer.revertAll(); observer?.disconnect(); observer = null; break;
        case 'run-resume':
          if (message.runId && message.runId !== runId) begin(message);
          break;
        case 'run-settled':
          break;
        case 'toggle-render-mode': renderer.toggleMode(); break;
        default: break;
      }
    });
  }

  boot().catch((error) => console.error('[lbt] frame boot failed', error));
})();


