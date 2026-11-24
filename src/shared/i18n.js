/**
 * Framework-free UI localisation.
 *
 * English source strings are the stable translation keys used by the UI. A
 * locale catalogue only needs entries whose translated text differs from the
 * English source text; missing entries fall back to English automatically.
 */

import en from './locales/en.js';
import zhTW from './locales/zh-TW.js';
import zhCN from './locales/zh-CN.js';
import ja from './locales/ja.js';
import ko from './locales/ko.js';
import pt from './locales/pt.js';
import es from './locales/es.js';
import fr from './locales/fr.js';
import de from './locales/de.js';
import it from './locales/it.js';
import el from './locales/el.js';
import th from './locales/th.js';
import id from './locales/id.js';
import hi from './locales/hi.js';
import ru from './locales/ru.js';
import ar from './locales/ar.js';
import tr from './locales/tr.js';
import vi from './locales/vi.js';
import bn from './locales/bn.js';
import ur from './locales/ur.js';
import fa from './locales/fa.js';
import sw from './locales/sw.js';

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

const CATALOGS = Object.freeze({
  en,
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  ja,
  ko,
  pt,
  es,
  fr,
  de,
  it,
  el,
  th,
  id,
  hi,
  ru,
  ar,
  tr,
  vi,
  bn,
  ur,
  fa,
  sw
});

const SUPPORTED_LOCALE_SET = new Set(SUPPORTED_LOCALES);
const RTL_LOCALES = new Set(['ar', 'fa', 'ur']);
const PLACEHOLDER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

function browserLanguageCandidates() {
  if (typeof navigator === 'undefined') return [];
  const candidates = [];
  const languages = navigator.languages;

  if (languages && typeof languages.length === 'number') {
    for (const language of Array.from(languages)) candidates.push(language);
  }
  if (typeof navigator.language === 'string') candidates.push(navigator.language);
  return candidates;
}

function resolveLocale(candidate) {
  if (typeof candidate !== 'string') return null;

  const subtags = candidate.trim().replace(/_/g, '-').split('-').filter(Boolean);
  if (!subtags.length) return null;

  const language = subtags[0].toLowerCase();
  if (language === 'zh') {
    const modifiers = subtags.slice(1).map((subtag) => subtag.toLowerCase());
    if (modifiers.some((subtag) => subtag === 'hant' || ['tw', 'hk', 'mo'].includes(subtag))) {
      return 'zh-TW';
    }
    if (modifiers.some((subtag) => subtag === 'hans' || ['cn', 'sg'].includes(subtag))) {
      return 'zh-CN';
    }
    return 'zh-CN';
  }

  return SUPPORTED_LOCALE_SET.has(language) ? language : null;
}

function resolveUiLocale() {
  for (const candidate of browserLanguageCandidates()) {
    const locale = resolveLocale(candidate);
    if (locale) return locale;
  }
  return 'en';
}

export const UI_LOCALE = resolveUiLocale();

function replaceParameters(message, params) {
  const values = params && typeof params === 'object' ? params : {};
  return message.replace(PLACEHOLDER_PATTERN, (_match, name) => values[name] === null || values[name] === undefined ? `{${name}}` : String(values[name]));
}

/**
 * Translate an English source string for the active UI locale.
 *
 * Missing catalogues and missing entries both fall back to English (which is
 * represented by the source string itself). Parameter values are converted to
 * strings; missing parameter values remain visible as {placeholders}.
 */
export function t(source, params = {}) {
  const key = typeof source === 'string' ? source : String(source ?? '');
  const catalogue = CATALOGS[UI_LOCALE];
  const translated = catalogue && typeof catalogue === 'object' ? catalogue[key] : undefined;
  const englishCatalogue = CATALOGS.en;
  const english = englishCatalogue && typeof englishCatalogue === 'object' ? englishCatalogue[key] : undefined;
  const message = typeof translated === 'string'
    ? translated
    : typeof english === 'string'
      ? english
      : key;

  return replaceParameters(message, params);
}

function elementsIn(root) {
  if (!root) return [];

  const elements = [];
  if (typeof root.matches === 'function' && root.matches('[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder]')) {
    elements.push(root);
  }
  if (typeof root.querySelectorAll === 'function') {
    elements.push(...root.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder]'));
  }
  return elements;
}

/**
 * Apply declarative translations to a document or subtree.
 *
 * Supported attributes:
 * - data-i18n: element textContent
 * - data-i18n-title: title attribute
 * - data-i18n-aria-label: aria-label attribute
 * - data-i18n-placeholder: placeholder attribute
 */
export function applyI18n(root = document) {
  for (const element of elementsIn(root)) {
    const textKey = element.getAttribute('data-i18n');
    if (textKey !== null) element.textContent = t(textKey);

    const titleKey = element.getAttribute('data-i18n-title');
    if (titleKey !== null) element.setAttribute('title', t(titleKey));

    const ariaLabelKey = element.getAttribute('data-i18n-aria-label');
    if (ariaLabelKey !== null) element.setAttribute('aria-label', t(ariaLabelKey));

    const placeholderKey = element.getAttribute('data-i18n-placeholder');
    if (placeholderKey !== null) element.setAttribute('placeholder', t(placeholderKey));
  }
}

/** Set the document language and text direction metadata. */
export function localizeDocument(root = document) {
  const documentElement = root?.documentElement
    ?? (root?.nodeType === 1 && root.matches?.('html') ? root : null);
  if (!documentElement) return;

  documentElement.lang = UI_LOCALE;
  documentElement.dir = RTL_LOCALES.has(UI_LOCALE) ? 'rtl' : 'ltr';
}



