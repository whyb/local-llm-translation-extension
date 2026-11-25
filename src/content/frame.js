/* iframe translator. Loaded after content/common.js in every frame. */
(() => {
  'use strict';
  const LBT = globalThis.LBT;
  if (!LBT || window.top === window) return;
  const { state, Renderer, createDeliveryScheduler, sendMessage, getSettings, subscribeSettings, sameSite } = LBT;
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
  state.documentKey = documentKey;
  let inventoryRevision = 0;
  let extractionRoots = new Set();

  function mutateWithoutObservation(callback) {
    const current = observer;
    current?.takeRecords();
    try {
      return callback();
    } finally {
      current?.takeRecords();
    }
  }

  const deliveryScheduler = createDeliveryScheduler({
    applySegment: (segment) => mutateWithoutObservation(() => renderer.apply(segment.unitId, segment.text)),
    onAck: (unitIds) => {
      if (!runId || !unitIds.length) return;
      sendMessage({ type: 'segment-applied', url: runUrl, runId, documentKey, unitIds }).catch(() => {});
    },
    isActive: () => Boolean(runId)
  });

  function payload(unit) {
    return { id: framePrefix + unit.id, kind: unit.kind, text: unit.text, zone: unit.zone, srcLang: unit.srcLang, attribute: unit.attribute ?? null, priority: unit.priority ?? null };
  }

  async function report(roots = null) {
    if (!runId) return;
    if (roots === null) LBT.extractAll(false);
    else LBT.extractFromRoots(roots);
    const units = LBT.sortUnitsByPriority(LBT.currentUnitsSnapshot());
    inventoryRevision += 1;
    const payloads = units
      .slice(0, Math.min(100000, Math.max(1, Number(settings.speed.runaway.pageUnitCeiling) || 100000)))
      .map(payload);
    const chunkSize = 5000;
    const chunkCount = Math.max(1, Math.ceil(payloads.length / chunkSize));
    const snapshotId = `${runId}:${inventoryRevision}`;
    try {
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        await sendMessage({
          type: 'units-report',
          url: runUrl,
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

  function schedule(roots = []) {
    if (!runId) return;
    for (const root of roots) extractionRoots.add(root);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const pendingRoots = [...extractionRoots];
      extractionRoots = new Set();
      report(pendingRoots).catch(() => {});
    }, 180);
  }

  function installObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
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
      if (relevant) schedule([...roots]);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'hidden', 'aria-hidden', 'title', 'alt', 'placeholder', 'aria-label', 'value'] });
  }

  function skipFrame(url) {
    if (!(innerWidth > 0 && innerHeight > 0)) return true;
    if (settings.exclusions?.zones?.thirdPartyIframes && !sameSite(location.href, url)) return true;
    return false;
  }

  function begin(message) {
    if (skipFrame(message.url || location.href)) return;
    deliveryScheduler.reset();
    extractionRoots = new Set();
    runId = message.runId;
    state.runId = runId;
    runUrl = message.url || location.href;
    installObserver();
    report().catch(() => {});
  }

  function delivery(message) {
    if (message.runId !== runId || !Array.isArray(message.segments)) return;
    deliveryScheduler.enqueue(message.segments);
  }

  async function boot() {
    settings = await getSettings();
    renderer.mode = settings.translation.renderMode;
    subscribeSettings((next) => {
      const renderModeChanged = next.translation.renderMode !== settings.translation.renderMode;
      settings = next;
      if (renderModeChanged) mutateWithoutObservation(() => renderer.setMode(next.translation.renderMode));
      else renderer.mode = next.translation.renderMode;
    });
    try { await sendMessage({ type: 'frame-hello', url: location.href, documentKey }); } catch { /* background may be starting */ }
    document.documentElement.setAttribute('data-lbt-frame-loaded', 'true');
    LBT.api.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'run-begin': begin(message); break;
        case 'segment-delivery': delivery(message); break;
        case 'progress-update': break;
        case 'run-cancel':
          deliveryScheduler.reset(); extractionRoots = new Set(); runId = null; state.runId = null; observer?.disconnect(); observer = null; break;
        case 'run-revert':
          deliveryScheduler.reset(); extractionRoots = new Set(); runId = null; state.runId = null; mutateWithoutObservation(() => renderer.revertAll()); observer?.disconnect(); observer = null; break;
        case 'run-resume':
          if (message.runId && message.runId !== runId) begin(message);
          break;
        case 'run-settled':
          break;
        case 'toggle-render-mode': mutateWithoutObservation(() => renderer.toggleMode()); break;
        default: break;
      }
    });
  }

  boot().catch((error) => {
    console.error('[lbt] frame boot failed', error);
    LBT.reportClientError('error', error, { phase: 'frame-boot' });
  });
})();


