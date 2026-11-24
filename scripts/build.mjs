import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') throw new Error('Refusing to clean an unexpected output path');
await rm(dist, { recursive: true, force: true });

const variants = [
  ['chrome', 'manifest.chrome.json'],
  ['edge', 'manifest.chrome.json'],
  ['firefox', 'manifest.firefox.json']
];

for (const [name, manifestName] of variants) {
  const target = path.join(dist, name);
  await mkdir(target, { recursive: true });
  await cp(path.join(root, 'src'), path.join(target, 'src'), { recursive: true });
  await cp(path.join(root, 'README.md'), path.join(target, 'README.md'));
  const manifest = JSON.parse(await readFile(path.join(root, manifestName), 'utf8'));
  await writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`built dist/${name}`);
}
