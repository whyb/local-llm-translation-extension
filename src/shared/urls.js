import { domainMatches } from './settings.js';

export const RESTRICTED_PROTOCOLS = new Set([
  'about:', 'chrome:', 'chrome-extension:', 'edge:', 'moz-extension:', 'resource:', 'view-source:', 'devtools:'
]);

const ACTION_URL = /(?:^|[\/_.-])(?:logout|signout|sign-out|delete|remove|unsubscribe|purchase|checkout|cart|add-to-cart|login|signin|sign-in|reset|confirm|send|submit|edit)(?:[\/_.?=-]|$)/i;
const NOFOLLOW_REL = new Set(['nofollow', 'ugc', 'sponsored']);

export function normalizeDomain(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSupportedPageUrl(value) {
  try {
    const url = new URL(value);
    return !RESTRICTED_PROTOCOLS.has(url.protocol) && (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:');
  } catch {
    return false;
  }
}

export function hostPatternForUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.hostname.includes('*')) return null;
    return `*://${url.hostname}/*`;
  } catch {
    return null;
  }
}

export function domainFromUrl(value) {
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return '';
  }
}

export function sameSite(a, b) {
  let left;
  let right;
  try {
    left = new URL(a);
    right = new URL(b);
  } catch {
    return false;
  }
  return domainMatches(left.hostname, right.hostname) || domainMatches(right.hostname, left.hostname);
}

export function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function isNofollow(rel) {
  if (typeof rel !== 'string' || !rel.trim()) return false;
  return rel.toLowerCase().split(/\s+/).some((token) => NOFOLLOW_REL.has(token));
}

export function isActionLikeUrl(value) {
  try {
    const url = new URL(value);
    return ACTION_URL.test(`${url.pathname}${url.search}`.toLowerCase());
  } catch {
    return true;
  }
}

export function validatePrefetchUrl({ href, sourceUrl, rel = null, download = false }) {
  if (typeof href !== 'string' || href.trim() === '') return { ok: false, reason: 'empty-href' };
  let source;
  let target;
  try {
    source = new URL(sourceUrl);
    target = new URL(href, source);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (download) return { ok: false, reason: 'download' };
  if (isNofollow(rel)) return { ok: false, reason: 'nofollow' };
  if (target.origin === source.origin && target.pathname === source.pathname && target.search === source.search) {
    return { ok: false, reason: 'same-page' };
  }
  if (!sameSite(source.href, target.href)) return { ok: false, reason: 'not-same-site' };
  if (isActionLikeUrl(target.href)) return { ok: false, reason: 'action-url' };
  return { ok: true, url: target };
}

function paramName(part) {
  const index = part.indexOf('=');
  const name = index === -1 ? part : part.slice(0, index);
  try {
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}

function matchesParam(name, patterns) {
  return patterns.some((pattern) => {
    const normalized = String(pattern).trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.endsWith('*')) return name.startsWith(normalized.slice(0, -1));
    return name === normalized;
  });
}

export function normalizeUrl(value, options = {}) {
  const enabled = options?.enabled ?? true;
  if (!enabled) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  const overrides = Array.isArray(options.domainOverrides) ? options.domainOverrides : [];
  const keep = [];
  let keepFragment = false;
  for (const override of overrides) {
    if (!domainMatches(url.hostname, override.domain)) continue;
    if (override.keepFragment) keepFragment = true;
    keep.push(...(override.keepParams ?? []));
  }
  const stripParams = Array.isArray(options.stripParams) ? options.stripParams : [];
  if (url.search) {
    const retained = [];
    for (const part of url.search.slice(1).split('&')) {
      if (!part) continue;
      const name = paramName(part);
      if (matchesParam(name, keep) || !matchesParam(name, stripParams)) retained.push(part);
    }
    url.search = retained.length ? retained.join('&') : '';
  }
  if ((options.stripFragment ?? true) && !keepFragment && !url.hash.startsWith('#/') && !url.hash.startsWith('#!')) {
    url.hash = '';
  }
  return url.toString();
}

export function normalizeLanguage(value) {
  if (typeof value !== 'string') return null;
  const match = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{1,8})*$/.exec(value.trim());
  if (!match) return null;
  return value.trim().split('-')[0].toLowerCase();
}

export function siteStateFromSettings(settings, url, permissionGranted = false) {
  const domain = domainFromUrl(url);
  const rule = domain
    ? settings.behaviour.siteRules.find((candidate) => domainMatches(domain, candidate.domain)) ?? null
    : null;
  const policy = rule?.neverSend ? 'never' : rule?.policy ?? settings.behaviour.autoTranslateDefault;
  const enabled = Boolean(settings.behaviour.allSitesEnabled
    || (domain && settings.behaviour.enabledSites.some((site) => domainMatches(domain, site))));
  const blocked = policy === 'never';
  return {
    url,
    domain,
    selected: policy,
    modePerSite: Boolean(rule?.policy || rule?.neverSend),
    blocked,
    globalPolicy: settings.behaviour.autoTranslateDefault,
    allSitesEnabled: settings.behaviour.allSitesEnabled,
    enabled,
    permissionGranted,
    autoTranslateAllowed: permissionGranted && enabled && !blocked && policy === 'auto'
  };
}
