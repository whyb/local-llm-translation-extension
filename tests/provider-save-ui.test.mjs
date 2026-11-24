import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('provider editor closes before optional endpoint probing', async () => {
  const source = await read('../src/ui/options/providers.js');
  const start = source.indexOf("const save = button('Save changes'");
  const end = source.indexOf('footer.append(error, cancel, save)', start);
  assert.ok(start >= 0 && end > start);
  const saveHandler = source.slice(start, end);
  assert.match(saveHandler, /closeDialog\(\);\s*render\(\);\s*if \(shouldProbe\)/s);
  assert.match(saveHandler, /void Promise\.resolve\(\)[\s\S]*?probe-profile-request/);
  assert.doesNotMatch(saveHandler, /await sendRuntimeMessage\(\{\s*type: 'refresh-models-request'/);
});

test('options save writes locally before notifying the background', async () => {
  const source = await read('../src/ui/options/options.js');
  const directWrite = source.indexOf('settings = normalizeSettings(await saveSettings(settings));');
  const backgroundNotify = source.indexOf("sendRuntimeMessage({ type: 'save-settings', settings })", directWrite);
  assert.ok(directWrite >= 0);
  assert.ok(backgroundNotify > directWrite);
  assert.match(source, /void Promise\.resolve\(\)[\s\S]*?\.catch\(\(\) => \{\}\);/);
});