#!/usr/bin/env python3
"""Localize appearance preview strings and remove the old section title."""
from __future__ import annotations
import importlib.util, json, re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
ROOT = Path('.')
spec = importlib.util.spec_from_file_location('tr', ROOT / 'tools/translate-ui-strings.py')
tr = importlib.util.module_from_spec(spec); spec.loader.exec_module(tr)
KEYS = [
    'Show a compact translation action next to selected page text.',
    'Display live run details while translating.',
]
OBSOLETE = ['In-page controls']
def translate(locale, language):
    for attempt in range(1, 4):
        try:
            values, _ = tr.request(locale, language, KEYS, 500, 300, 2048)
            return locale, values
        except Exception:
            if attempt == 3:
                return locale, [tr.request_single(locale, language, key, 300, 1024) for key in KEYS]
def apply(locale, values):
    path = ROOT / 'src/shared/locales' / f'{locale}.js'
    source = path.read_text(encoding='utf-8')
    for key in OBSOLETE:
        source = re.sub(r"^\s*(['\"])" + re.escape(key) + r"\1\s*:\s*.*?,?\s*$", '', source, flags=re.M)
    entries = ',\n'.join(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in zip(KEYS, values))
    path.write_text(source.replace('\n});', ',\n' + entries + '\n});', 1), encoding='utf-8')
results = {}
with ThreadPoolExecutor(max_workers=3) as executor:
    futures = {executor.submit(translate, locale, language): locale for locale, language in tr.LANGUAGES.items()}
    for future in as_completed(futures):
        locale, values = future.result(); results[locale] = values; print(locale, 'ok', flush=True)
out = ROOT / 'tools/ui-translation-results-appearance.json'
out.write_text(json.dumps({'keys': KEYS, 'locales': results}, ensure_ascii=False, indent=2), encoding='utf-8')
for locale, values in results.items(): apply(locale, values)
print('updated', len(results), 'locales')
