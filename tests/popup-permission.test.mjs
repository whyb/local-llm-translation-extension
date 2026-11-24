import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('popup hides actions until all-sites permission is granted', async () => {
  const [html, source, css] = await Promise.all([
    read('../src/ui/popup/index.html'),
    read('../src/ui/popup/popup.js'),
    read('../src/ui/popup/popup.css')
  ]);
  assert.match(html, /<section id="actions" class="actions" hidden>/);
  assert.match(html, /data-i18n="Allow all sites"/);
  assert.match(source, /hasAllSitesPermission/);
  assert.match(source, /requestAllSitesPermission/);
  assert.match(source, /ui\.permissionCard\.hidden = !ui\.tabSupported \|\| permissionGranted/);
  assert.match(source, /ui\.actions\.hidden = !ui\.tabSupported \|\| !permissionGranted/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});
