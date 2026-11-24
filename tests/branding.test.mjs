import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('product branding is applied consistently', async () => {
  const [chromeManifest, firefoxManifest, popup, options, content] = await Promise.all([
    read('../manifest.chrome.json'),
    read('../manifest.firefox.json'),
    read('../src/ui/popup/index.html'),
    read('../src/ui/options/index.html'),
    read('../src/content/main.js')
  ]);
  assert.match(chromeManifest, /"name": "Local LLM Translator"/);
  assert.match(firefoxManifest, /"name": "Local LLM Translator"/);
  assert.match(popup, /Local LLM Translator/);
  assert.match(options, /Local LLM Translator/);
  assert.match(content, /Local LLM Translator/);
});

test('settings brand mark sizing does not override the logo itself', async () => {
  const css = await read('../src/ui/options/options.css');
  assert.match(css, /\.brand-mark\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.brand > div > span\s*\{/);
  assert.doesNotMatch(css, /\.brand span\s*\{/);
});

test('floating button exposes a circular progress track and percentage state', async () => {
  const source = await read('../src/content/main.js');
  assert.match(source, /lbt-fab-shell/);
  assert.match(source, /--lbt-fab-progress/);
  assert.match(source, /conic-gradient/);
  assert.match(source, /is-progress/);
  assert.match(source, /setProgress\(0, 0\)/);
});

test('hover reveal mode uses a tooltip without changing page layout', async () => {
  const [renderer, css, preview] = await Promise.all([
    read('../src/content/common.js'),
    read('../src/content/content.css'),
    read('../src/ui/options/options.css')
  ]);
  assert.match(renderer, /data-lbt-original/);
  assert.match(renderer, /tabIndex = 0/);
  assert.match(renderer, /parent\.insertBefore\(wrapper, node\)/);
  assert.match(renderer, /originalSpan\.append\(node\)/);
  assert.match(renderer, /`\$\{leading\}\$\{translated\}\$\{trailing\}`/);
  assert.match(renderer, /unit\.leading \?\? ''/);
  assert.doesNotMatch(renderer, /parent\.replaceChild\(wrapper, node\)/);
  assert.match(css, /content: attr\(data-lbt-original\)/);
  assert.match(css, /\.lbt-bilingual-stacked\s*\{\s*display:\s*inline-block/);
  assert.match(css, /\.lbt-replace-hover-reveal\s*\{\s*display:\s*inline/);
  assert.doesNotMatch(css, /\.lbt-replace-hover-reveal:hover \.lbt-original\s*\{\s*display:\s*block/);
  assert.match(preview, /data-preview-original/);
});

test('README exposes collapsed browser debugging and release workflow packages all targets', async () => {
  const [readme, workflow] = await Promise.all([
    read('../README.md'),
    read('../.github/workflows/release.yml')
  ]);
  assert.equal((readme.match(/<details>/g) || []).length >= 3, true);
  assert.match(readme, /Chrome: load, reload and inspect/);
  assert.match(readme, /Edge: load, reload and inspect/);
  assert.match(readme, /Firefox: temporary load, reload and inspect/);
  assert.match(workflow, /tags:\s*\n\s*- 'v\*\.\*\.\*'/);
  assert.match(workflow, /prerelease: true/);
  assert.match(workflow, /dist\/chrome/);
  assert.match(workflow, /dist\/edge/);
  assert.match(workflow, /dist\/firefox/);
});


test('mutation storm detection ignores extension-owned DOM mutations', async () => {
  const source = await read('../src/content/main.js');
  assert.match(source, /function mutateWithoutObservation/);
  assert.match(source, /observer\?\.takeRecords\(\)/);
  assert.match(source, /mutationCount = 0/);
  assert.match(source, /runPaused \|\| message\.runId !== runId/);
});


test('floating panel closes on outside pointer input', async () => {
  const source = await read('../src/content/main.js');
  assert.match(source, /event\.composedPath\?\.\(\)/);
  assert.match(source, /path\.includes\(this\.container\)/);
  assert.match(source, /this\.panel\.hidden = true/);
});

test('appearance page has four preview sections and keeps glow style controls', async () => {
  const source = await read('../src/ui/options/appearance.js');
  for (const title of ['Floating button', 'Selection button', 'Performance HUD', 'Glow feedback']) {
    assert.equal(source.includes(`card('${title}'`), true);
  }
  assert.match(source, /Pending style/);
  assert.match(source, /Fresh style/);
  assert.match(source, /appearance-preview/);
  assert.match(source, /import \{ t \}/);
});



test('speed settings omit engine and local engine cards', async () => {
  const [speed, sites] = await Promise.all([
    read('../src/ui/options/speed.js'),
    read('../src/ui/options/sites.js')
  ]);
  assert.doesNotMatch(speed, /card\('Engine'/);
  assert.doesNotMatch(speed, /card\('Local engine'/);
  assert.doesNotMatch(speed, /Engine mode/);
  assert.doesNotMatch(sites, /Engine mode/);
});

test('hover reveal tooltip renders in a top-level fixed shadow host to avoid clipping and stacking occlusion', async () => {
  const renderer = await read('../src/content/common.js');
  assert.match(renderer, /data-lbt-tooltip-host/);
  assert.match(renderer, /lbt-hover-tooltip/);
  assert.match(renderer, /positionHoverTooltip/);
  assert.match(renderer, /zIndex = '2147483647'/);
});
