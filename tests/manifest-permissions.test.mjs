import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const file of ['manifest.json', 'manifest.chrome.json', 'manifest.firefox.json']) {
  test(`${file} requests activeTab instead of the broader tabs permission`, async () => {
    const manifest = JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
    assert.ok(manifest.permissions.includes('activeTab'));
    assert.ok(!manifest.permissions.includes('tabs'));
  });
}
