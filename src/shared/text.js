const ENTITY_MAP = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
  ['ndash', '–'], ['mdash', '—'], ['hellip', '…'], ['copy', '©'], ['reg', '®']
]);

export function decodeHtmlEntities(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(number) && number > 0 && number <= 0x10ffff) {
        try { return String.fromCodePoint(number); } catch { return whole; }
      }
      return whole;
    }
    return ENTITY_MAP.get(entity.toLowerCase()) ?? whole;
  });
}

export function normalizeForLookup(value, rules = {}) {
  let text = String(value ?? '');
  if (rules.decodeEntities !== false) text = decodeHtmlEntities(text);
  if (rules.stripNbspAndZeroWidth !== false) text = text.replace(/[\u00a0\u200b-\u200f\u2060\ufeff]/g, ' ');
  if (rules.foldQuotesAndDashes !== false) {
    text = text.replace(/[\u2018\u2019\u201a\u201b]/g, "'").replace(/[\u201c\u201d\u201e\u201f]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, '-');
  }
  if (rules.collapseWhitespace !== false) text = text.replace(/\s+/g, ' ').trim();
  if (rules.tolerateTrailingPunctuation !== false) text = text.replace(/[\s.!?,;:。！？，；：]+$/u, '');
  if (Number(rules.caseFoldMaxLength) > 0 && text.length <= Number(rules.caseFoldMaxLength)) {
    text = text.toLowerCase();
  }
  return text;
}

export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function splitOuterWhitespace(value) {
  const raw = String(value ?? '');
  const leading = raw.match(/^\s*/u)?.[0] ?? '';
  const trailing = raw.match(/\s*$/u)?.[0] ?? '';
  return {
    text: raw.slice(leading.length, raw.length - trailing.length),
    leading,
    trailing
  };
}

export function fnv1a(value, seed = 2166136261) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function stableHash(value) {
  const text = String(value ?? '');
  return fnv1a(text, 0).toString(16).padStart(8, '0') + fnv1a(text, 2654435769).toString(16).padStart(8, '0');
}

export function estimateTokens(value) {
  const text = String(value ?? '');
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? []).length;
  return Math.max(1, Math.ceil((text.length - cjk) / 4) + cjk);
}

export function hasMeaningfulText(value) {
  return /[\p{L}\p{N}]/u.test(String(value ?? ''));
}

export function detectLanguage(value, fallback = null) {
  const text = String(value ?? '');
  const sample = text.slice(0, 4000);
  if ((sample.match(/[\u3040-\u30ff]/g) ?? []).length >= 2) return 'ja';
  if ((sample.match(/[\uac00-\ud7af]/g) ?? []).length >= 2) return 'ko';
  if ((sample.match(/[\u0400-\u04ff]/g) ?? []).length >= 4) return 'ru';
  if ((sample.match(/[\u0600-\u06ff]/g) ?? []).length >= 4) return 'ar';
  if ((sample.match(/[\u0590-\u05ff]/g) ?? []).length >= 4) return 'he';
  if ((sample.match(/[\u4e00-\u9fff]/g) ?? []).length >= 2) return 'zh';
  const latin = (sample.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) ?? []).length;
  if (!latin) return fallback;
  const lower = sample.toLowerCase();
  const scores = {
    en: /\b(the|and|of|to|in|is|that|for|with|this|you|are|on|as|be|at|or)\b/g,
    es: /\b(el|la|los|las|de|que|y|en|un|una|por|para|con|del|se|es|como)\b/g,
    fr: /\b(le|la|les|des|de|et|en|un|une|pour|avec|dans|est|que|du|au)\b/g,
    de: /\b(der|die|das|und|ist|zu|den|von|ein|eine|mit|für|auf|dem|des)\b/g,
    pt: /\b(o|a|os|as|de|que|e|em|um|uma|para|com|do|da|se|é|como)\b/g,
    it: /\b(il|lo|la|gli|le|di|che|e|in|un|una|per|con|del|della|è|come)\b/g
  };
  let best = null;
  let bestScore = 0;
  for (const [language, regex] of Object.entries(scores)) {
    const score = (lower.match(regex) ?? []).length;
    if (score > bestScore) { best = language; bestScore = score; }
  }
  return best ?? fallback;
}

export function classifyZone({ tagName = '', role = '', className = '' } = {}) {
  const tag = String(tagName).toLowerCase();
  const roleName = String(role).toLowerCase();
  const classes = String(className).toLowerCase();
  if (/cookie|consent|gdpr|cookiebot|onetrust/.test(classes) || /cookie|consent/.test(roleName)) return 'boilerplate';
  if (/advert|sponsor|promo|adslot|adsbygoogle/.test(classes) || roleName === 'advertisement') return 'ad';
  if (roleName === 'navigation' || ['nav', 'menu'].includes(tag)) return 'nav';
  if (roleName === 'complementary' || tag === 'aside') return 'aside';
  if (roleName === 'contentinfo' || tag === 'footer' || /footer/.test(classes)) return 'footer';
  if (roleName === 'banner' || tag === 'header') return 'nav';
  if (/related|recommend|more-stories|read-next/.test(classes)) return 'related';
  if (/^h[1-6]$/.test(tag) || roleName === 'heading') return 'heading';
  if (/boilerplate/.test(classes)) return 'boilerplate';
  return 'main';
}

export function zoneWeight(zone, weights = {}) {
  return Number(weights[zone] ?? weights.main ?? 1);
}

export function glossaryHash(glossary) {
  const entries = Array.isArray(glossary)
    ? glossary.map((entry) => [String(entry.source ?? ''), entry.replacement === null ? null : String(entry.replacement ?? '')])
    : [];
  entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return stableHash(JSON.stringify(entries));
}

export function makeTmKey({ text, targetLang, profileId, model, promptVersion, glossaryFingerprint, normalized = true, normalizeRules = {} }) {
  const source = normalized ? normalizeForLookup(text, normalizeRules) : String(text ?? '');
  return stableHash(JSON.stringify(['lbt-tm-v2', source, targetLang, profileId, model ?? '', promptVersion, glossaryFingerprint ?? '']));
}

export function htmlToTextUnits(html, { limit = 300 } = {}) {
  let text = String(html ?? '');
  text = text.replace(/<(script|style|noscript|template|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(br|hr)\b[^>]*>/gi, '\n');
  text = text.replace(/<\/(?:p|div|section|article|header|footer|li|h[1-6]|tr|td|th|blockquote|pre|nav|aside)\s*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  const chunks = text.split(/\n+/).map(cleanText).filter((entry) => entry.length >= 2 && hasMeaningfulText(entry));
  return chunks.slice(0, limit).map((entry, index) => ({
    id: `prefetch-${index}`,
    text: entry,
    zone: 'main',
    priority: { zoneWeight: 1, viewportProximity: 0.1, visibilityFactor: 1 },
    srcLang: detectLanguage(entry)
  }));
}

export function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? text.slice(0, max) : text;
}
