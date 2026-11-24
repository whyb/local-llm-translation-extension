import { htmlToTextUnits } from '../shared/text.js';
import { normalizeUrl, validatePrefetchUrl } from '../shared/urls.js';
import { resolveSiteTargetLang } from '../shared/settings.js';

const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 15_000;

export class PrefetchService {
  constructor({ getSettings, translator, onError = null }) {
    this.getSettings = getSettings;
    this.translator = translator;
    this.onError = onError;
    this.inFlight = new Map();
    this.recentKeys = new Set();
    this.metrics = { pagesWarmed: 0, requests: 0, hits: 0, tokensSpent: 0, saved: 0 };
  }

  remember(key) {
    this.recentKeys.add(key);
    while (this.recentKeys.size > 64) {
      const first = this.recentKeys.values().next().value;
      this.recentKeys.delete(first);
    }
  }

  async fetchHtml(url, signal) {
    this.metrics.requests += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Prefetch timed out', 'TimeoutError')), FETCH_TIMEOUT_MS);
    const forwarded = () => controller.abort(signal?.reason);
    signal?.addEventListener?.('abort', forwarded, { once: true });
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      if (!response.ok) throw new Error(`Prefetch HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) throw new Error('Prefetch response is over the size budget');
      const text = await response.text();
      return text.slice(0, MAX_HTML_BYTES);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', forwarded);
    }
  }

  async warm({ href, sourceUrl, rel = null, download = false, limit = 1 }) {
    const settings = this.getSettings();
    const candidates = validatePrefetchUrl({ href, sourceUrl, rel, download });
    if (!candidates.ok) return { ok: false, reason: candidates.reason };
    const url = candidates.url.href;
    const key = normalizeUrl(url, settings.cache.urlNormalisation);
    if (this.recentKeys.has(key) || this.inFlight.has(key)) return { ok: false, reason: 'duplicate' };
    if (this.inFlight.size >= Math.max(1, Number(settings.speed.prefetch.maxPagesInFlight) || 1)) {
      return { ok: false, reason: 'page-budget' };
    }
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    this.remember(key);
    try {
      const html = await this.fetchHtml(url, controller.signal);
      const units = htmlToTextUnits(html, { limit: 300 });
      if (!units.length) return { ok: false, reason: 'empty' };
      const targetLang = resolveSiteTargetLang(settings, new URL(url).hostname);
      let done = 0;
      await this.translator.translateUnits(units, {
        url,
        domain: new URL(url).hostname.toLowerCase(),
        targetLang,
        profileRole: 'prefetch',
        signal: controller.signal,
        onSegment: () => { done += 1; },
        onProgress: () => {}
      });
      this.metrics.pagesWarmed += 1;
      this.metrics.tokensSpent += units.reduce((sum, unit) => sum + Math.ceil(unit.text.length / 4), 0);
      return { ok: true, units: units.length, translated: done, limit };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, reason: 'aborted' };
      this.onError?.(error);
      return { ok: false, reason: 'fetch-or-translate-failed' };
    } finally {
      this.inFlight.delete(key);
    }
  }

  async onHover(message) {
    const settings = this.getSettings();
    if (!settings.speed.prefetch.hoverPrefetch) return { ok: false, reason: 'disabled' };
    return this.warm({ ...message, limit: settings.speed.prefetch.hoverPrefetchMaxPages });
  }

  async onNextNav(message) {
    const settings = this.getSettings();
    if (!settings.speed.prefetch.nextNavPrediction) return { ok: false, reason: 'disabled' };
    const picks = Array.isArray(message.picks) ? message.picks.slice(0, Math.max(1, settings.speed.prefetch.nextNavMaxLinks)) : [];
    const results = [];
    for (const pick of picks) {
      results.push(await this.warm({
        href: pick.href,
        sourceUrl: message.sourceUrl,
        rel: pick.rel ?? null,
        download: Boolean(pick.download)
      }));
    }
    return { ok: true, results };
  }

  snapshot() {
    return {
      ...this.metrics,
      inFlight: this.inFlight.size,
      recentKeys: this.recentKeys.size
    };
  }
}
