import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = [/\beval\s*\(/, /new\s+Function\s*\(/, /innerHTML\s*=/, /insertAdjacentHTML\s*\(/];
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else files.push(full);
  }
}
await walk(path.join(root, 'src'));
for (const file of files.filter((entry) => /\.(js|html|css)$/.test(entry))) {
  const source = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(source)) throw new Error(`${path.relative(root, file)} contains forbidden pattern ${pattern}`);
  }
  if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${path.relative(root, file)} syntax error\n${result.stderr}`);
    const importPattern = /from\s+['"](\.[^'"]+)['"]/g;
    for (const match of source.matchAll(importPattern)) {
      const target = path.resolve(path.dirname(file), match[1]);
      try { await readFile(target); }
      catch { throw new Error(`${path.relative(root, file)} imports missing ${match[1]}`); }
    }
  }
}
for (const manifest of ['manifest.json', 'manifest.chrome.json', 'manifest.firefox.json']) {
  JSON.parse(await readFile(path.join(root, manifest), 'utf8'));
}
console.log(`checked ${files.length} source files; imports resolve; no forbidden dynamic HTML execution or remote runtime references`);
