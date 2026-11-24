import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings.js';
import { normalizeUrl, siteStateFromSettings, validatePrefetchUrl } from '../src/shared/urls.js';
import { MESSAGE, validateContentMessage } from '../src/shared/messages.js';
import { DEFAULT_TARGET_LANGUAGE, getLanguageOptions, languageFlagFor, preferredBrowserLanguage, searchLanguageOptions } from '../src/shared/languages.js';
import { htmlToTextUnits, makeTmKey, normalizeForLookup } from '../src/shared/text.js';
import { primaryProfile } from '../src/background/providers/index.js';

test('defaults are valid and have no secret', () => {
  const settings = normalizeSettings(DEFAULT_SETTINGS);
  assert.equal(settings.providers.profiles[0].apiKey, null);
  assert.equal(settings.behaviour.autoTranslateDefault, 'ask');
  assert.equal(settings.behaviour.allSitesEnabled, false);
  assert.equal(settings.speed.prefetch.hoverPrefetch, false);
});

test('provider selection defaults to first profile and empty lists are preserved', () => {
  const profile = (id, role = 'fallback') => ({
    id,
    name: id,
    role,
    adapter: 'openai',
    baseUrl: 'http://localhost:8080/v1'
  });
  const empty = normalizeSettings({ providers: { profiles: [] } });
  assert.deepEqual(empty.providers.profiles, []);
  assert.equal(empty.providers.selectedProfileId, null);

  const settings = normalizeSettings({
    providers: {
      profiles: [profile('first', 'primary'), profile('second')],
      selectedProfileId: 'second'
    }
  });
  assert.equal(primaryProfile(settings, 'primary').id, 'second');
  settings.providers.selectedProfileId = null;
  assert.equal(primaryProfile(settings, 'primary').id, 'first');
  settings.providers.selectedProfileId = 'missing';
  assert.equal(primaryProfile(settings, 'primary').id, 'first');
});

test('tracking params and fragments are stripped', () => {
  const result = normalizeUrl('https://example.com/a?utm_source=x&id=7#section', DEFAULT_SETTINGS.cache.urlNormalisation);
  assert.equal(result, 'https://example.com/a?id=7');
});

test('prefetch refuses cross-site and action links', () => {
  assert.equal(validatePrefetchUrl({ href: 'https://other.example/x', sourceUrl: 'https://example.com/' }).ok, false);
  assert.equal(validatePrefetchUrl({ href: 'https://example.com/logout', sourceUrl: 'https://example.com/' }).ok, false);
  assert.equal(validatePrefetchUrl({ href: 'https://www.example.com/article', sourceUrl: 'https://example.com/' }).ok, true);
});

test('TM key is stable across domains and whitespace variants', () => {
  const rules = DEFAULT_SETTINGS.cache.normalizeRules;
  assert.equal(normalizeForLookup('  Hello   world. ', rules), normalizeForLookup('Hello world.', rules));
  const base = { targetLang: 'en', profileId: 'p', model: 'm', promptVersion: 1, glossaryFingerprint: 'g', normalizeRules: rules };
  assert.equal(makeTmKey({ text: 'Hello   world.', ...base }), makeTmKey({ text: 'Hello world.', ...base }));
});

test('HTML prefetch extraction strips scripts', () => {
  const units = htmlToTextUnits('<style>x</style><script>alert(1)</script><article>Hello world</article>');
  assert.equal(units.length, 1);
  assert.equal(units[0].text, 'Hello world');
});

test('site state distinguishes permission from explicit enablement', () => {
  const settings = normalizeSettings(DEFAULT_SETTINGS);
  const disabled = siteStateFromSettings(settings, 'https://www.cnbc.com/', true);
  assert.equal(disabled.permissionGranted, true);
  assert.equal(disabled.enabled, false);
  settings.behaviour.enabledSites = ['cnbc.com'];
  const enabled = siteStateFromSettings(settings, 'https://www.cnbc.com/', true);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.autoTranslateAllowed, false);

  settings.behaviour.autoTranslateDefault = 'auto';
  const automatic = siteStateFromSettings(settings, 'https://www.cnbc.com/', true);
  assert.equal(automatic.autoTranslateAllowed, true);
  const unpermitted = siteStateFromSettings(settings, 'https://www.cnbc.com/', false);
  assert.equal(unpermitted.autoTranslateAllowed, false);

  settings.behaviour.siteRules = [{ domain: 'cnbc.com', policy: 'ask' }];
  const perSiteAsk = siteStateFromSettings(settings, 'https://www.cnbc.com/', true);
  assert.equal(perSiteAsk.selected, 'ask');
  assert.equal(perSiteAsk.autoTranslateAllowed, false);
});
test('popup action messages accept an explicit tab id', () => {
  assert.equal(validateContentMessage({ type: MESSAGE.TRANSLATE_PAGE, url: 'https://example.com/', tabId: 7 }), true);
  assert.equal(validateContentMessage({ type: MESSAGE.GET_PROGRESS, url: 'https://example.com/', tabId: 7 }), true);
  assert.equal(validateContentMessage({ type: MESSAGE.TRANSLATE_PAGE, url: 'https://example.com/', tabId: '7' }), false);
});
test('language catalogue covers global languages and supports local search', () => {
  const options = getLanguageOptions('en');
  const codes = new Set(options.map((option) => option.value));
  assert.ok(options.length >= 350);
  for (const code of ['en-US', 'en-GB', 'zh-CN', 'zh-TW', 'ar-EG', 'hi-IN', 'es-MX', 'pt-BR', 'yue', 'ckb', 'fil', 'sw-KE']) {
    assert.ok(codes.has(code), `missing ${code}`);
  }
  assert.equal(languageFlagFor('de-CH'), '🇨🇭');
  assert.equal(searchLanguageOptions('Cantonese', 'en')[0]?.value, 'yue');
  assert.ok(searchLanguageOptions('中文', 'zh-CN').some((option) => option.value === 'zh-TW'));
  const territories = new Set(options.map((option) => option.territory).filter(Boolean));
  for (const territory of territories) {
    assert.ok(existsSync(new URL(`../src/assets/flags/${territory}.svg`, import.meta.url)), `missing flag ${territory}`);
  }
});

test('new installs follow the browser request language', () => {
  assert.equal(preferredBrowserLanguage(['zh-TW', 'en-US']), 'zh-TW');
  assert.equal(preferredBrowserLanguage([null, '', 'de-DE'], 'en'), 'de-DE');
  assert.equal(normalizeSettings(null).translation.targetLang, DEFAULT_TARGET_LANGUAGE);
});


test('legacy local-mt engineMode in saved settings migrates to llm-only', () => {
  const settings = normalizeSettings({
    speed: { engineMode: 'local-mt-only' },
    behaviour: {
      siteRules: [
        { domain: 'example.com', policy: 'ask', engineMode: 'local-mt-only' },
        { domain: 'sub.example.com', policy: 'auto', engineMode: 'local-first-llm-refines' }
      ]
    }
  });
  assert.equal(settings.speed.engineMode, 'llm-only');
  assert.equal(settings.behaviour.siteRules[0].engineMode, null);
  assert.equal(settings.behaviour.siteRules[1].engineMode, null);
});
