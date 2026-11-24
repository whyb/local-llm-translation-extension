/* Early cache painter. Loaded after content/common.js at document_start. */
(() => {
  'use strict';
  const LBT = globalThis.LBT;
  if (!LBT) return;
  const { mark, sendMessage, extractTextUnits, applyEarlyTranslation, debugLog } = LBT;
  let stopped = false;
  let observer = null;
  let timer = null;
  const seen = new Set();

  mark('lbt:early-start');
  document.documentElement?.setAttribute('data-lbt-early-loaded', 'true');

  function ready() {
    if (document.readyState === 'loading') {
      return new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    return Promise.resolve();
  }

  function queryUnits() {
    if (stopped) return [];
    const units = extractTextUnits(document.documentElement, { onlyNew: false })
      .filter((unit) => !seen.has(unit.id) && unit.text.length >= 2)
      .slice(0, 256);
    return units;
  }

  function setStatus(status, detail = '') {
    document.documentElement?.setAttribute('data-lbt-early-status', status);
    document.documentElement?.setAttribute('data-lbt-early-detail', String(detail));
  }

  async function lookup() {
    if (stopped) return;
    setStatus('settings');
    await LBT.getSettings();
    if (stopped) return;

    let siteState;
    try {
      siteState = await sendMessage({ type: 'get-site-state', url: location.href });
    } catch (error) {
      setStatus('policy-error', LBT.errorMessage(error));
      return;
    }
    if (stopped) return;
    if (!siteState?.ok || !siteState.autoTranslateAllowed) {
      setStatus('policy-skip', siteState?.selected ?? 'unavailable');
      return;
    }

    const renderMode = LBT.state?.settings?.translation?.renderMode ?? 'replace';
    if (renderMode !== 'replace') {
      // The full run applies hover/bilingual wrappers and all related settings.
      // A bare text replacement here would bypass the selected display mode.
      setStatus('mode-deferred', renderMode);
      return;
    }

    let snapshot;
    try {
      snapshot = await sendMessage({ type: 'page-snapshot-request', url: location.href });
    } catch (error) {
      setStatus('snapshot-error', LBT.errorMessage(error));
      return;
    }
    if (stopped) return;
    if (!snapshot?.ok || !Array.isArray(snapshot.snapshot?.hashes)) {
      setStatus('no-snapshot');
      return;
    }
    const units = queryUnits();
    if (!units.length) {
      setStatus('no-units');
      return;
    }
    for (const unit of units) seen.add(unit.id);
    setStatus('lookup', units.length);
    try {
      const response = await sendMessage({
        type: 'tm-lookup-request',
        url: location.href,
        queries: units.map((unit) => ({ id: unit.id, text: unit.text, zone: unit.zone, srcLang: unit.srcLang }))
      });
      if (stopped || !response?.ok || !Array.isArray(response.results)) {
        setStatus('lookup-failed');
        return;
      }
      let hits = 0;
      for (const result of response.results) {
        if (result.status !== 'hit' || typeof result.translation !== 'string') continue;
        const unit = units.find((candidate) => candidate.id === result.id);
        if (unit?.node?.isConnected) {
          applyEarlyTranslation(unit.node, result.translation);
          hits += 1;
        }
      }
      setStatus('done', `${hits}/${units.length}`);
      mark('lbt:early-first-paint');
      debugLog('early cache lookup', { units: units.length, hits });
    } catch (error) {
      setStatus('lookup-error', LBT.errorMessage(error));
      debugLog('early lookup failed', LBT.errorMessage(error));
    }
  }

  function startObserver() {
    if (stopped) return;
    try {
      observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { lookup().catch(() => {}); }, 160);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { observer?.disconnect(); observer = null; }, 3000);
    } catch { /* optional */ }
  }

  ready().then(() => {
    if (stopped) return;
    lookup().catch(() => {});
    startObserver();
  });

  const stop = () => {
    stopped = true;
    observer?.disconnect();
    observer = null;
    if (timer) clearTimeout(timer);
  };
  window.addEventListener('pagehide', (event) => { if (!event.persisted) stop(); });
})();
