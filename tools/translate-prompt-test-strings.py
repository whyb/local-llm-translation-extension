#!/usr/bin/env python3
"""Localize the Settings prompt-test controls using the local llama.cpp model."""
from __future__ import annotations

import importlib.util
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path('.')
spec = importlib.util.spec_from_file_location('tr', ROOT / 'tools/translate-ui-strings.py')
tr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tr)
KEYS = [
    'Prompt test',
    'Test-only batch size. The primary provider and current unsaved settings are used; no cache is written. Batch uses the first N non-empty lines; single uses the first line.',
    'Test batch',
    'Test single',
    'Ready to test.',
    'Source text is required.',
    'Testing batch…',
    'Testing single…',
    'Test passed · {provider} · {duration} ms · {count}/{requested} segments',
    'Test failed: {error}',
]
CHUNKS = [KEYS[start:start + 4] for start in range(0, len(KEYS), 4)]

def translate_locale(locale: str, language: str):
    values = []
    for chunk_index, keys in enumerate(CHUNKS):
        for attempt in range(1, 4):
            try:
                chunk_values, _ = tr.request(locale, language, keys, 100 + chunk_index, 300, 4096)
                values.extend(chunk_values)
                break
            except Exception as error:
                if attempt == 3:
                    print(f'{locale} chunk {chunk_index + 1} fallback: {error}', flush=True)
                    for key in keys:
                        for single_attempt in range(1, 4):
                            try:
                                values.append(tr.request_single(locale, language, key, 300, 4096))
                                break
                            except Exception as single_error:
                                if single_attempt == 3:
                                    raise RuntimeError(f'{locale} failed for {key!r}: {single_error}')
                else:
                    print(f'{locale} chunk {chunk_index + 1} retry {attempt}: {error}', flush=True)
    if len(values) != len(KEYS):
        raise RuntimeError(f'{locale}: got {len(values)} values for {len(KEYS)} keys')
    return locale, values

def js_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)

def apply(locale: str, values: list[str]) -> None:
    path = ROOT / 'src/shared/locales' / f'{locale}.js'
    source = path.read_text(encoding='utf-8')
    entries = ',\n'.join(f'  {js_string(key)}: {js_string(value)}' for key, value in zip(KEYS, values))
    if '\n});' not in source:
        raise RuntimeError(f'{path}: final locale marker not found')
    path.write_text(source.replace('\n});', ',\n' + entries + '\n});', 1), encoding='utf-8')

results = {}
with ThreadPoolExecutor(max_workers=3) as executor:
    futures = {executor.submit(translate_locale, locale, language): locale for locale, language in tr.LANGUAGES.items()}
    for future in as_completed(futures):
        locale, values = future.result()
        results[locale] = values
        print(f'{locale} ok', flush=True)
out = ROOT / 'tools/ui-translation-results-prompt-test.json'
out.write_text(json.dumps({'keys': KEYS, 'locales': results}, ensure_ascii=False, indent=2), encoding='utf-8')
for locale, values in results.items():
    apply(locale, values)
print(f'updated {len(results)} locales')
