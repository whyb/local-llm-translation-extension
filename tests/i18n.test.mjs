import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODE_PROMPT_PARAMETERS } from '../src/shared/prompt.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localeCodes = [
  'en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt', 'es', 'fr', 'de', 'it', 'el',
  'th', 'id', 'hi', 'ru', 'ar', 'tr', 'vi', 'bn', 'ur', 'fa', 'sw'
];
const localeDirectory = path.join(root, 'src/shared/locales');
const uiDirectories = [
  path.join(root, 'src/ui/options'),
  path.join(root, 'src/ui/popup')
];
const helperArguments = Object.freeze({
  card: [0, 1],
  field: [0, 2],
  check: [0, 3],
  button: [0],
  iconAction: [0],
  languageField: [0, 3]
});

function decodeQuotedLiteral(literal) {
  const quote = literal[0];
  if (!['\'', '"', '`'].includes(quote) || literal.at(-1) !== quote) return null;
  const body = literal.slice(1, -1);
  if (quote === '`' && body.includes('${')) return null;
  return body.replace(/\\(['"`\\nrt])/g, (_match, value) => ({
    '\\': '\\', '\'': '\'', '"': '"', '`': '`', n: '\n', r: '\r', t: '\t'
  })[value]);
}

function stringLiterals(fragment) {
  const values = [];
  const pattern = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
  for (const match of String(fragment).matchAll(pattern)) {
    const value = decodeQuotedLiteral(match[0]);
    if (value !== null && value.trim()) values.push(value);
  }
  return values;
}

function findBalanced(source, start, open, close) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(source, delimiter = ',') {
  const parts = [];
  let start = 0;
  let quote = null;
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') stack.push(char);
    else if (char === ')' || char === ']' || char === '}') {
      if (stack.at(-1) === pairs[char]) stack.pop();
    } else if (char === delimiter && stack.length === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function callArguments(source, name) {
  const calls = [];
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf('(', match.index);
    const close = findBalanced(source, open, '(', ')');
    if (close < 0) continue;
    calls.push(splitTopLevel(source.slice(open + 1, close)));
  }
  return calls;
}

function findAssignedObjectBody(source, name) {
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`, 'g');
  const match = declaration.exec(source);
  if (!match) return null;
  const start = source.indexOf('{', match.index + match[0].length);
  if (start < 0) return null;
  const end = findBalanced(source, start, '{', '}');
  return end < 0 ? null : source.slice(start + 1, end);
}

function topLevelPropertyParts(body) {
  const parts = splitTopLevel(body);
  const properties = [];
  for (const part of parts) {
    let quote = null;
    let stack = [];
    let colon = -1;
    for (let index = 0; index < part.length; index += 1) {
      const char = part[index];
      if (quote) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '\'' || char === '"' || char === '`') quote = char;
      else if (char === '(' || char === '[' || char === '{') stack.push(char);
      else if (char === ')' || char === ']' || char === '}') stack.pop();
      else if (char === ':' && stack.length === 0) {
        colon = index;
        break;
      }
    }
    if (colon < 0) continue;
    const rawKey = part.slice(0, colon).trim().replace(/^['"]|['"]$/g, '');
    properties.push([rawKey, part.slice(colon + 1).trim()]);
  }
  return properties;
}

function objectStringValues(body) {
  return topLevelPropertyParts(body).flatMap(([, value]) => stringLiterals(value));
}

function objectProperty(body, key) {
  return topLevelPropertyParts(body).find(([name]) => name === key)?.[1] ?? '';
}

async function loadUiSources() {
  const files = [];
  for (const directory of uiDirectories) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && /\.(?:js|html)$/.test(entry.name)) {
        files.push({ name: entry.name, source: await readFile(path.join(directory, entry.name), 'utf8') });
      }
    }
  }
  return files;
}

function decodeHtml(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function staticSourceKeys() {
  const keys = new Set();
  const files = await loadUiSources();
  for (const { name, source } of files) {
    if (name.endsWith('.html')) {
      for (const match of source.matchAll(/\bdata-i18n(?:-title|-aria-label|-placeholder)?\s*=\s*(["'])(.*?)\1/gs)) {
        const key = decodeHtml(match[2]);
        if (key.trim()) keys.add(key);
      }
      continue;
    }

    for (const args of callArguments(source, 't')) {
      for (const key of stringLiterals(args[0] ?? '')) keys.add(key);
    }
    for (const [helper, indexes] of Object.entries(helperArguments)) {
      for (const args of callArguments(source, helper)) {
        for (const index of indexes) for (const key of stringLiterals(args[index] ?? '')) keys.add(key);
      }
    }
    for (const match of source.matchAll(/\blabel\s*:\s*((?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"))/g)) {
      for (const key of stringLiterals(match[1])) keys.add(key);
    }
    for (const match of source.matchAll(/\[([^\[\]]*)\]\s*\.forEach\s*\(/g)) {
      for (const key of stringLiterals(match[1])) keys.add(key);
    }
    for (const match of source.matchAll(/\bObject\.entries\s*\(\s*\{/g)) {
      const start = source.indexOf('{', match.index);
      const end = findBalanced(source, start, '{', '}');
      if (end >= 0) for (const key of objectStringValues(source.slice(start + 1, end))) keys.add(key);
    }
    for (const match of source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*_LABELS)\s*=/g)) {
      const start = source.indexOf('{', match.index + match[0].length);
      const end = start < 0 ? -1 : findBalanced(source, start, '{', '}');
      if (end >= 0) for (const key of objectStringValues(source.slice(start + 1, end))) keys.add(key);
    }
  }

  const optionsSource = files.find((file) => file.name === 'options.js')?.source ?? '';
  const sectionMeta = findAssignedObjectBody(optionsSource, 'SECTION_META');
  if (sectionMeta) for (const key of objectStringValues(sectionMeta)) keys.add(key);

  const promptSource = files.find((file) => file.name === 'prompt-editor.js')?.source ?? '';
  const modeCopy = findAssignedObjectBody(promptSource, 'MODE_COPY');
  if (modeCopy) {
    for (const key of objectStringValues(modeCopy)) {
      if (!key.trim().startsWith('{"')) keys.add(key);
    }
  }

  const settingsSource = await readFile(path.join(root, 'src/shared/settings.js'), 'utf8');
  const rolesMatch = settingsSource.match(/\bexport\s+const\s+ROLES\s*=\s*\[([^\]]*)\]/);
  if (rolesMatch) {
    for (const role of stringLiterals(rolesMatch[1])) keys.add(role[0].toUpperCase() + role.slice(1));
  }

  for (const mode of Object.values(MODE_PROMPT_PARAMETERS)) {
    for (const parameter of Object.values(mode)) {
      if (parameter.label) keys.add(parameter.label);
      if (parameter.description) keys.add(parameter.description);
    }
  }
  return keys;
}

function placeholders(value) {
  return [...String(value).matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((match) => match[1]).sort();
}

async function loadCatalogs() {
  const catalogues = new Map();
  const available = new Set((await readdir(localeDirectory)).filter((name) => name.endsWith('.js')));
  for (const locale of localeCodes) {
    if (!available.has(`${locale}.js`)) continue;
    const module = await import(new URL(`../src/shared/locales/${locale}.js`, import.meta.url));
    catalogues.set(locale, module.default);
  }
  return catalogues;
}

function formatList(values, limit = 12) {
  const list = [...values];
  return list.slice(0, limit).join(' | ') + (list.length > limit ? ` | … (+${list.length - limit} more)` : '');
}

test('all supported UI locales are present', async () => {
  const files = new Set((await readdir(localeDirectory)).filter((name) => name.endsWith('.js')));
  const missing = localeCodes.filter((locale) => !files.has(`${locale}.js`));
  assert.deepEqual(missing, [], `missing locale files: ${missing.join(', ')}`);
});

test('source extraction covers the complete Settings and popup UI', async () => {
  const keys = await staticSourceKeys();
  assert.ok(keys.size > 360, `unexpectedly small UI key set: ${keys.size}`);
  for (const key of [
    'Target language',
    'Custom prompt additions',
    'Shared optional instructions. Include {custom_instructions} in either prompt template where this text should be inserted. Do not paste secrets.',
    'Batch / page prompt',
    'Parameters for this mode',
    'Source text',
    'Automatic on allowed sites'
  ]) assert.ok(keys.has(key), `source extraction missed: ${key}`);
  assert.ok(!keys.has('Pin custom prompt to prefix'), 'removed prompt control leaked into source keys');
});

test('source extraction excludes implementation data and prompt templates', async () => {
  const keys = await staticSourceKeys();
  for (const value of [
    'openai', 'ollama', 'lbt.settings', 'example.com', 'http://localhost:8080/v1',
    '.article-body', '.ad, .cookie-banner', 'grid', 'toggle-grid', 'primary',
    'Translate the web-page text segments below into {target_lang}.'
  ]) assert.ok(!keys.has(value), `technical value leaked into UI keys: ${value}`);
  assert.ok(![...keys].some((key) => key.includes('{"r":[{"i":0')), 'batch response example leaked into UI keys');
});

test('every dynamic t() argument has a statically covered key source', async () => {
  const allowed = new Set([
    'labelText', 'hintText', 'titleText', 'label',
    'entry.label ?? entry.value', 'small', 'heading', 'copy', 'val',
    'parameter.label', 'parameter.description', 'copy.example',
    'copy.returnTitle', 'copy.returnDescription', 'copy.returnNote', 'copy.explanation',
    'profile.role[0].toUpperCase() + profile.role.slice(1)'
  ]);
  const unknown = [];
  for (const { name, source } of await loadUiSources()) {
    if (name.endsWith('.html')) continue;
    for (const args of callArguments(source, 't')) {
      const expression = (args[0] ?? '').replace(/\s+/g, ' ').trim();
      if (!expression || stringLiterals(expression).length) continue;
      if (!allowed.has(expression)) unknown.push(`${name}: ${expression}`);
    }
  }
  assert.deepEqual(unknown, [], `uncovered dynamic t() calls:\n${unknown.join('\n')}`);
});

test('Settings shell localizes visible initial header text', async () => {
  const html = await readFile(path.join(root, 'src/ui/options/index.html'), 'utf8');
  const documentTitle = html.match(/<title[^>]*>/i)?.[0] ?? '';
  assert.match(documentTitle, /\bdata-i18n=/, '<title> shows English before settings finish loading');
  for (const id of ['eyebrow', 'title', 'subtitle']) {
    const tag = html.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`))?.[0] ?? '';
    assert.match(tag, /\bdata-i18n=/, `#${id} shows English before settings finish loading`);
  }
});

test('locale catalogs do not declare duplicate keys', async () => {
  const failures = [];
  for (const locale of localeCodes) {
    const file = path.join(localeDirectory, `${locale}.js`);
    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const seen = new Set();
    for (const match of source.matchAll(/^\s*('(?:\\.|[^'\\])*')\s*:/gm)) {
      const key = decodeQuotedLiteral(match[1]);
      if (key === null) continue;
      if (seen.has(key)) failures.push(`${locale} duplicate key: ${key}`);
      seen.add(key);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('placeholder extraction matches the i18n runtime identifier syntax', () => {
  assert.deepEqual(placeholders('{"i":0,"t":"source text"}'), []);
  assert.deepEqual(placeholders('{source_text} {done} {i,t} {"r":[]}'), ['done', 'source_text']);
});

test('every non-English locale covers every UI source key with matching placeholders', async () => {
  const keys = await staticSourceKeys();
  const catalogues = await loadCatalogs();
  const failures = [];
  for (const [locale, catalogue] of catalogues) {
    if (locale === 'en') continue;
    assert.ok(catalogue && typeof catalogue === 'object', `${locale} must default-export an object`);
    const missing = [...keys].filter((key) => !Object.prototype.hasOwnProperty.call(catalogue, key));
    if (missing.length) failures.push(`${locale} missing ${missing.length}: ${formatList(missing)}`);
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(catalogue, key)) continue;
      const translated = catalogue[key];
      if (typeof translated !== 'string' || !translated.trim()) {
        failures.push(`${locale} empty translation for: ${key}`);
        continue;
      }
      const expected = placeholders(key);
      const actual = placeholders(translated);
      if (expected.join('\u0000') !== actual.join('\u0000')) {
        failures.push(`${locale} placeholder mismatch for "${key}" expected {${expected.join('},{')}} got {${actual.join('},{')}}`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('locale catalogs have matching key sets and no obsolete entries', async () => {
  const keys = await staticSourceKeys();
  const catalogues = await loadCatalogs();
  const union = new Set();
  for (const [locale, catalogue] of catalogues) {
    if (locale === 'en') continue;
    for (const key of Object.keys(catalogue ?? {})) union.add(key);
  }
  const failures = [];
  for (const [locale, catalogue] of catalogues) {
    if (locale === 'en') continue;
    const catalogueKeys = new Set(Object.keys(catalogue ?? {}));
    const missingFromUnion = [...union].filter((key) => !catalogueKeys.has(key));
    const obsolete = [...catalogueKeys].filter((key) => !keys.has(key));
    if (missingFromUnion.length) failures.push(`${locale} missing ${missingFromUnion.length} union keys: ${formatList(missingFromUnion)}`);
    if (obsolete.length) failures.push(`${locale} has ${obsolete.length} obsolete keys: ${formatList(obsolete)}`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});
