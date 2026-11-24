#!/usr/bin/env python3
"""Translate newly introduced Settings UI strings with the local llama.cpp model.

The source keys are passed as marker-delimited blocks, using the same protocol
the extension now uses for production batch translation. Results are validated
for block count and placeholders before being written to locale files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE_URL = 'http://127.0.0.1:9931/v1'
MODEL = 'gemma4_26b_a4b'
LOCALE_DIR = Path('src/shared/locales')
OUT = Path('tools/ui-translation-results.json')

KEYS = [
    'Highlight translated content without changing page text or layout.',
    'Where the floating translate button is anchored.',
    'Use subtler highlights for photosensitivity or visual preference.',
    'Import TM',
    'No URL overrides yet.',
    'Choose which changes must create a new cache key.',
    'Export, import, refresh or selectively remove stored translations.',
    'Maximum on-disk translation-memory size.',
    'Entries kept in the fast access tier.',
    'Leave empty for no expiry.',
    'Import settings',
    'No selector rules yet.',
    'No model selected',
    'Request overrides',
    'Each profile can serve a different role. Connection and generation controls are grouped per profile; keys stay on this machine unless you explicitly send them to an endpoint.',
    'These options apply to every provider profile.',
    'Checks model availability and endpoint capabilities after settings are saved.',
    'Stops a translation run after this many consecutive hard failures.',
    'OpenAI-compatible root or provider-specific API root.',
    'Leave empty for local servers that do not require authentication.',
    'Page segments merged into one marker-delimited request.',
    'Off sends the most direct request. Custom uses the effort level below.',
    'Used only when Thinking mode is set to Custom.',
    'Marker batch requests always use prompt-only output. This remains available for compatible custom templates and provider probes.',
    'Show completed batches as soon as the provider returns them.',
    'Set the permission scope and the default startup policy.',
    'Run limits',
    'Limits protect memory and token budgets during unusually large or rapidly changing pages.',
    'Choose whether users see partial batches or wait for a complete translation batch.',
    'Keep translated pages readable without changing the source text sent to the model.',
    'The preview updates immediately. Choose whether the page keeps the source text visible.',
    'Passed into both the batch and single-text prompts.',
    'Prevents translated text from expanding beyond this ratio before the page layout is adjusted.',
    'Used for page, iframe and large-text batch translation. Each block begins with a unique marker so translations can be matched back to the correct DOM node without JSON parsing.',
    '{source_text} contains marker-delimited blocks. The model must copy each marker line exactly and return only its translated text.',
    'Every marker must appear exactly once. Do not add commentary, labels, JSON or Markdown fences.',
    '⟦LBT:A1B2C3D4:1⟧\nTranslated text',
    'Used for translating one selected passage or one text segment. The model receives plain text and returns only its translation, with no markers or JSON wrapper.',
    'Return no JSON, labels, explanations, quotes or Markdown fences. Marker and index requirements do not apply to this mode.',
    'Batch marker token',
    'A request-specific marker value. Keep this placeholder when customizing the default template so the model sees the exact marker example.',
    'Marker-delimited page blocks. Each block begins with a unique ⟦LBT:token:N⟧ line and must be returned with the same marker unchanged.',
]

OBSOLETE = [
    'Each profile can serve a different role. Keys stay on this machine unless you explicitly send them to an endpoint.',
    'OpenAI-compatible root or provider-specific root.',
    'Stored in plain text by browser extension storage.',
    'Advanced tuning',
    'Choose the translation path and how completed work is committed.',
    'One tracking parameter per line. Supports a trailing * wildcard.',
    'Adaptive tuning',
    'Used for page, iframe and large-text batch translation. The model receives indexed segments so every translation can be returned to the matching DOM node.',
    'An indexed JSON array of page segments. Each item has an integer index "i" and source text "t"; the model must preserve every "i" unchanged.',
    'Used for translating one selected passage or one text segment. The model receives plain text and returns only its translation, without segment indexes or wrapper JSON.',
    'Every source index must appear exactly once. Do not add commentary, labels, Markdown fences or extra keys.',
    'Return no JSON, labels, explanations, quotes or Markdown fences. Segment and index requirements do not apply to this mode.',
    '{source_text} is an indexed JSON array. The model must return one JSON object containing one translation for every source index.',
]

LANGUAGES = {
    'zh-TW': 'Traditional Chinese',
    'zh-CN': 'Simplified Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'pt': 'Portuguese',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'el': 'Greek',
    'th': 'Thai',
    'id': 'Indonesian',
    'hi': 'Hindi',
    'ru': 'Russian',
    'ar': 'Arabic',
    'tr': 'Turkish',
    'vi': 'Vietnamese',
    'bn': 'Bengali',
    'ur': 'Urdu',
    'fa': 'Persian',
    'sw': 'Swahili',
}


def placeholders(value: str) -> list[str]:
    return sorted(re.findall(r'\{([a-zA-Z][a-zA-Z0-9_]*)\}', value))


def token_for(locale: str, chunk_index: int) -> str:
    return hashlib.sha256(f'{locale}:ui-strings-v2:{chunk_index}'.encode()).hexdigest()[:8].upper()


def request(locale: str, language: str, keys: list[str], chunk_index: int, timeout: int, max_tokens: int) -> tuple[list[str], str]:
    token = token_for(locale, chunk_index)
    markers = [f'⟦LBT:{token}:{index + 1}⟧' for index in range(len(keys))]
    source = '\n'.join(f'{marker}\n{key}' for marker, key in zip(markers, keys))
    prompt = '\n'.join([
        f'Translate each UI string below into {language}.',
        'These are labels and help text for a browser translation-extension settings page.',
        'Keep the wording concise and natural. Preserve product names, technical terms, placeholders such as {source_text}, JSON/Markdown terms, and marker examples exactly where appropriate.',
        'Copy every marker line exactly, then put only that string translation after it.',
        'Do not merge, omit, reorder, or add blocks. Do not output JSON, explanations, labels, or code fences.',
        '',
        source,
    ])
    payload = {
        'model': MODEL,
        'messages': [
            {'role': 'system', 'content': 'You are a precise UI localizer. Copy segment markers exactly and return only marked translations.'},
            {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.1,
        'max_tokens': max_tokens,
        'chat_template_kwargs': {'enable_thinking': False},
    }
    req = urllib.request.Request(
        BASE_URL + '/chat/completions',
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        data = json.loads(response.read().decode('utf-8'))
    content = data['choices'][0]['message']['content']
    pattern = re.compile(rf'⟦LBT:{token}:(\d+)⟧')
    matches = list(pattern.finditer(content))
    if len(matches) != len(keys):
        raise ValueError(f'{locale} chunk {chunk_index}: expected {len(keys)} markers, got {len(matches)}')
    values = []
    for position, match in enumerate(matches):
        end = matches[position + 1].start() if position + 1 < len(matches) else len(content)
        values.append(content[match.end():end].strip())
    indexes = [int(match.group(1)) for match in matches]
    if sorted(indexes) != list(range(1, len(keys) + 1)):
        raise ValueError(f'{locale} chunk {chunk_index}: marker indexes invalid: {indexes}')
    for key, value in zip(keys, values):
        if placeholders(key) != placeholders(value):
            raise ValueError(f'{locale} chunk {chunk_index}: placeholder mismatch for {key!r}: {value!r}')
        if not value.strip():
            raise ValueError(f'{locale} chunk {chunk_index}: empty translation for {key!r}')
    return values, content

def request_single(locale: str, language: str, key: str, timeout: int, max_tokens: int) -> str:
    prompt = '\n'.join([
        f'Translate this browser-extension UI string into {language}.',
        'Keep it concise and natural. Preserve placeholders such as {source_text}, technical terms, JSON/Markdown names, and marker examples where appropriate.',
        'Output only the translation in plain text. Do not add JSON, labels, explanations, quotes around the whole result, or code fences.',
        '',
        key,
    ])
    payload = {
        'model': MODEL,
        'messages': [
            {'role': 'system', 'content': 'You are a precise UI localizer. Return only the translated plain text.'},
            {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.1,
        'max_tokens': max_tokens,
        'chat_template_kwargs': {'enable_thinking': False},
    }
    req = urllib.request.Request(
        BASE_URL + '/chat/completions',
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        data = json.loads(response.read().decode('utf-8'))
    value = data['choices'][0]['message']['content'].strip()
    if placeholders(key) != placeholders(value):
        raise ValueError(f'{locale}: single placeholder mismatch for {key!r}: {value!r}')
    if not value:
        raise ValueError(f'{locale}: empty single translation for {key!r}')
    return value


def js_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def apply_results(results: dict[str, list[str]], path: Path) -> None:
    source = path.read_text(encoding='utf-8')
    for key in OBSOLETE:
        for quoted in (json.dumps(key, ensure_ascii=False), json.dumps(key, ensure_ascii=False).replace('"', "'")):
            source = re.sub(rf'^\s*{re.escape(quoted)}\s*:\s*.*?,?\s*$', '', source, flags=re.M)
    entries = ',\n'.join(f'  {js_string(key)}: {js_string(value)}' for key, value in zip(KEYS, results[path.stem]))
    if '\n});' not in source:
        raise ValueError(f'{path}: final locale marker not found')
    source = source.replace('\n});', ',\n' + entries + '\n});', 1)
    path.write_text(source, encoding='utf-8')


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write validated translations into locale files')
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('--max-tokens', type=int, default=4096)
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--out', default=str(OUT))
    args = parser.parse_args()
    results: dict[str, list[str]] = {}
    raw_attempts = {}
    chunks = [KEYS[start:start + args.batch_size] for start in range(0, len(KEYS), args.batch_size)]

    def translate_locale(locale: str, language: str) -> tuple[str, list[str], list[str]]:
        print(f'translating {locale} ({language}) in {len(chunks)} chunk(s) ...', flush=True)
        values: list[str] = []
        raws: list[str] = []
        for chunk_index, keys in enumerate(chunks):
            last_error = None
            completed = False
            for attempt in range(1, 4):
                try:
                    chunk_values, raw = request(locale, language, keys, chunk_index, args.timeout, args.max_tokens)
                    values.extend(chunk_values)
                    raws.append(raw)
                    print(f'  {locale} chunk {chunk_index + 1}/{len(chunks)} ok ({len(chunk_values)} strings)', flush=True)
                    completed = True
                    break
                except Exception as error:
                    last_error = error
                    print(f'  {locale} chunk {chunk_index + 1} attempt {attempt} failed: {error}', flush=True)
                    time.sleep(1)
            if not completed:
                print(f'  {locale} chunk {chunk_index + 1} using single-string fallback: {last_error}', flush=True)
                for key in keys:
                    single_error = None
                    for single_attempt in range(1, 4):
                        try:
                            values.append(request_single(locale, language, key, args.timeout, args.max_tokens))
                            break
                        except Exception as error:
                            single_error = error
                            time.sleep(1)
                    else:
                        raise RuntimeError(f'{locale} single fallback failed for {key!r}: {single_error}')
                raws.append('[single fallback]')
        return locale, values, raws

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(translate_locale, locale, language): locale
            for locale, language in LANGUAGES.items()
        }
        for future in as_completed(futures):
            locale, values, raws = future.result()
            results[locale] = values
            raw_attempts[locale] = raws
    payload = {'keys': KEYS, 'locales': results, 'raw': raw_attempts}
    out_path = Path(args.out)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'wrote {out_path}')
    if args.apply:
        for locale in LANGUAGES:
            apply_results(results, LOCALE_DIR / f'{locale}.js')
        print('locale files updated')
    else:
        print('dry run only; pass --apply to update locale files')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
