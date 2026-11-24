#!/usr/bin/env python3
"""Localize all-sites permission strings and remove superseded UI keys."""
from __future__ import annotations
import importlib.util, json, re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
ROOT = Path('.')
spec = importlib.util.spec_from_file_location('tr', ROOT / 'tools/translate-ui-strings.py')
tr = importlib.util.module_from_spec(spec); spec.loader.exec_module(tr)
KEYS = [
    'All-sites access is requested once from the toolbar popup. This policy decides whether translation starts automatically.',
    'Allow access to all websites once. Nothing is read or changed until you allow it.',
]
OBSOLETE = [
    'All-sites permission is enabled.',
    'Access is granted site by site unless you explicitly allow all sites.',
    'Turn off all sites',
    'This page is not enabled yet. Nothing is read or changed until you allow it.',
    'Enable on this site',
    'This page cannot be translated by a browser extension.',
    'Set the permission scope and the default startup policy.',
]
def remove_key(source, key):
    return re.sub(r"^\s*(['\"])" + re.escape(key) + r"\1\s*:\s*.*?,?\s*$", '', source, flags=re.M)
def translate(locale, language):
    for attempt in range(1, 4):
        try:
            values, _ = tr.request(locale, language, KEYS, 300, 300, 4096)
            return locale, values
        except Exception as error:
            if attempt == 3:
                values = [tr.request_single(locale, language, key, 300, 4096) for key in KEYS]
                return locale, values
def apply(locale, values):
    path = ROOT / 'src/shared/locales' / f'{locale}.js'
    source = path.read_text(encoding='utf-8')
    for key in OBSOLETE: source = remove_key(source, key)
    entries = ',\n'.join(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in zip(KEYS, values))
    path.write_text(source.replace('\n});', ',\n' + entries + '\n});', 1), encoding='utf-8')
results = {}
with ThreadPoolExecutor(max_workers=3) as executor:
    futures = {executor.submit(translate, locale, language): locale for locale, language in tr.LANGUAGES.items()}
    for future in as_completed(futures):
        locale, values = future.result(); results[locale] = values; print(locale, 'ok', flush=True)
out = ROOT / 'tools/ui-translation-results-all-sites.json'
out.write_text(json.dumps({'keys': KEYS, 'locales': results}, ensure_ascii=False, indent=2), encoding='utf-8')
for locale, values in results.items(): apply(locale, values)
print('updated', len(results), 'locales')
