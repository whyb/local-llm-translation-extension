# Prompt and UI verification tools

These scripts are development utilities, not extension files bundled at runtime.

## `prompt-lab.py`

Standalone real-endpoint lab for comparing translation protocols. It has no
third-party dependencies and records raw responses, parsed segments, marker
issues, latency and token usage as JSON.

```powershell
python tools/prompt-lab.py --runs 3
python tools/prompt-lab.py --mode single --runs 10 --temperature 0.7
```

## `production-prompt-smoke.mjs`

Exercises the exact production `TranslationService` path against a local
llama.cpp endpoint:

```powershell
node tools/production-prompt-smoke.mjs http://127.0.0.1:9931/v1 gemma4_26b_a4b
```

## `translate-ui-strings.py`

Maintenance helper for localizing newly added Settings strings. It sends
marker-delimited batches, validates marker counts and placeholders, falls back
to single-string requests when a batch is malformed, and can write the results
back to locale catalogs with `--apply`.

```powershell
python tools/translate-ui-strings.py --batch-size 4 --workers 3
python tools/translate-ui-strings.py --batch-size 4 --workers 3 --apply
```
