import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('manifests no longer expose translate-page or revert-page commands', async () => {
  for (const file of ['manifest.json', 'manifest.chrome.json', 'manifest.firefox.json']) {
    const manifest = JSON.parse(await read(`../${file}`));
    const commands = manifest.commands ?? {};
    assert.equal('translate-page' in commands, false, `${file} still exposes translate-page`);
    assert.equal('revert-page' in commands, false, `${file} still exposes revert-page`);
    assert.ok(commands['translate-selection'], `${file} should retain selection translation`);
    assert.ok(commands['toggle-render-mode'], `${file} should retain render mode switching`);
  }
});

test('floating panel removes privacy and hotkey copy and links to GitHub', async () => {
  const source = await read('../src/content/main.js');
  assert.doesNotMatch(source, /Page text only goes to your endpoint/);
  assert.doesNotMatch(source, /No telemetry or analytics\./);
  assert.doesNotMatch(source, /Alt\+Shift\+T translate/);
  assert.doesNotMatch(source, /Alt\+Shift\+R revert/);
  assert.match(source, /https:\/\/github\.com\/whyb\/local-llm-translation-extension/);
  assert.match(source, /target\s*[:=]\s*['"]_blank['"]/);
});

test('popup opens the Sites section while retaining its privacy card', async () => {
  const [html, source] = await Promise.all([
    read('../src/ui/popup/index.html'),
    read('../src/ui/popup/popup.js')
  ]);
  assert.match(source, /openSiteSettings\.addEventListener\('click',\s*\(\)\s*=>\s*openOptionsPage\(['"]sites['"]\)\)/);
  assert.match(html, /data-i18n="Advanced site rules →"/);
  assert.match(html, /data-i18n="PRIVACY"/);
  assert.match(html, /data-i18n="Page text only goes to your endpoint"/);
  assert.match(html, /data-i18n="No telemetry or analytics\."/);
  assert.doesNotMatch(html, /Alt\+Shift\+T translate/);
  assert.doesNotMatch(html, /Alt\+Shift\+R revert/);
  assert.match(html, /href="https:\/\/github\.com\/whyb\/local-llm-translation-extension"/);
  assert.match(html, /target="_blank"/);
});

test('appearance.uiLocale defaults to browser language and normalizes explicit choices', () => {
  assert.equal(DEFAULT_SETTINGS.appearance.uiLocale, null);
  assert.equal(normalizeSettings(null).appearance.uiLocale, null);
  assert.equal(normalizeSettings({ appearance: { uiLocale: null } }).appearance.uiLocale, null);
  assert.equal(normalizeSettings({ appearance: { uiLocale: 'zh-TW' } }).appearance.uiLocale, 'zh-TW');
});

test('i18n exposes locale override and locale-specific translation APIs', async () => {
  const i18n = await import('../src/shared/i18n.js');
  assert.equal(typeof i18n.setUiLocale, 'function');
  assert.equal(typeof i18n.translateForLocale, 'function');
  assert.equal(typeof i18n.getUiLocale, 'function');
});

test('Sites settings expose the all-sites permission request', async () => {
  const source = await read('../src/ui/options/sites.js');
  assert.match(source, /hasAllSitesPermission/);
  assert.match(source, /requestAllSitesPermission/);
});

test('options page routes the Sites hash and responds to hash changes', async () => {
  const [html, source] = await Promise.all([
    read('../src/ui/options/index.html'),
    read('../src/ui/options/options.js')
  ]);
  assert.match(html, /data-section="sites"/);
  assert.match(source, /\bsites:\s*renderSites\b/);
  assert.match(source, /location\.hash\.replace\(\/\^#\/,\s*''\)/);
  assert.match(source, /addEventListener\('hashchange'/);
});
