#!/usr/bin/env python3
"""Standalone prompt reliability lab for a local llama.cpp server.

No project imports and no third-party packages. The script sends real requests
to an OpenAI-compatible endpoint, parses each protocol, and records every raw
response. Use it before changing the extension's production prompt contract.

Examples:
  python tools/prompt-lab.py --runs 3
  python tools/prompt-lab.py --mode single --runs 5
  python tools/prompt-lab.py --protocols current-json,indexed-markers,shared-delimiter
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import sys
import time
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

DEFAULT_BASE_URL = "http://127.0.0.1:9931/v1"
DEFAULT_MODEL = "gemma4_26b_a4b"
DEFAULT_PROTOCOLS = "current-json,indexed-markers,compact-markers,shared-delimiter,start-end-markers"

BATCH_CASES = [
    {
        "name": "product-page",
        "target_lang": "Simplified Chinese (zh-CN)",
        "segments": [
            "Local LLM Translator Pro",
            "Translate pages privately with your own model.",
            "Open settings",
            "Your changes are saved automatically.",
            "Read the documentation",
            "No account is required. Configure an endpoint to begin.",
            "Models: gemma4_26b_a4b",
            "Fast, private translation - on your device.",
            "Learn more",
            "Version 2.0.1",
        ],
    },
    {
        "name": "mixed-technical",
        "target_lang": "Simplified Chinese (zh-CN)",
        "segments": [
            "Use {name} to open the dashboard.",
            "Run `npm run check` before packaging.",
            "Visit https://example.com/docs?lang=en for details.",
            "The <strong>selected</strong> text is translated separately.",
            "Line one.\nLine two keeps its line break.",
            "File not found: C:\\Users\\demo\\config.json",
            "Export includes keys only when explicitly selected.",
            "Warning: this operation cannot be undone.",
            "Temperature controls sampling randomness (0.0-2.0).",
            "Saved",
        ],
    },
]

SINGLE_CASE = {
    "name": "selection",
    "target_lang": "Simplified Chinese (zh-CN)",
    "text": 'The <strong>selected</strong> passage says: "Do not translate {name} or `npm run check`."\nVisit https://example.com for details.',
}


@dataclass
class Attempt:
    mode: str
    protocol: str
    case: str
    run: int
    ok: bool
    parsed_count: int
    expected_count: int
    issue: str
    clean_output: bool
    duration_s: float
    prompt_tokens: int | None
    completion_tokens: int | None
    finish_reason: str | None
    output: str
    parsed: list[str]
    error: str | None = None


@dataclass
class Protocol:
    name: str
    messages: list[dict[str, str]]
    parse: Callable[[str], tuple[list[str], str, bool]]
    response_format: str | None = None


def stable_token(value: Any, protocol: str) -> str:
    raw = json.dumps([value, protocol], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8].upper()


def strip_outer_fence(text: str) -> tuple[str, bool]:
    source = text.strip()
    clean = re.sub(r"^```(?:json|text)?\s*", "", source, flags=re.I)
    clean = re.sub(r"\s*```$", "", clean).strip()
    return clean, clean == source


def batch_expected(case: dict[str, Any]) -> list[str]:
    return case["segments"]


def single_expected() -> list[str]:
    return [SINGLE_CASE["text"]]


def parse_json(text: str, expected: int) -> tuple[list[str], str, bool]:
    clean, clean_input = strip_outer_fence(text)
    parsed = None
    try:
        parsed = json.loads(clean)
    except Exception:
        start, end = clean.find("{"), clean.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(clean[start:end + 1])
            except Exception:
                parsed = None
    if isinstance(parsed, list):
        rows = parsed
    elif isinstance(parsed, dict) and isinstance(parsed.get("r"), list):
        rows = parsed["r"]
    else:
        return [], "JSON object/list with r[] not found", clean_input
    recovered: dict[int, str] = {}
    bad_rows = 0
    for row in rows:
        if not isinstance(row, dict):
            bad_rows += 1
            continue
        index = row.get("i", row.get("index"))
        value = row.get("t", row.get("text", row.get("translation")))
        if isinstance(index, int) and isinstance(value, str):
            recovered[index] = value
        else:
            bad_rows += 1
    issues = []
    missing = [str(i) for i in range(expected) if i not in recovered]
    extras = sorted(i for i in recovered if i < 0 or i >= expected)
    if missing:
        issues.append("missing=" + ",".join(missing))
    if extras:
        issues.append("extra=" + ",".join(map(str, extras)))
    if bad_rows:
        issues.append(f"bad_rows={bad_rows}")
    return [recovered.get(i, "") for i in range(expected)], "; ".join(issues), clean_input


def parse_indexed(text: str, expected: int, token: str) -> tuple[list[str], str, bool]:
    clean, clean_input = strip_outer_fence(text)
    markers = [f"⟦LBT:{token}:{i + 1}⟧" for i in range(expected)]
    positions = [(marker, clean.find(marker), clean.count(marker)) for marker in markers]
    bad = [str(i + 1) for i, (_, pos, count) in enumerate(positions) if pos < 0 or count != 1]
    result = [""] * expected
    for i, (_, pos, count) in enumerate(positions):
        if pos >= 0 and count == 1:
            start = pos + len(markers[i])
            later = [p for _, p, _ in positions[i + 1:] if p > start]
            result[i] = clean[start:min(later) if later else len(clean)].strip()
    issue = "marker_problem=" + ",".join(bad) if bad else ""
    return result, issue, clean_input


def parse_shared(text: str, expected: int, token: str) -> tuple[list[str], str, bool]:
    clean, clean_input = strip_outer_fence(text)
    separator = f"⟦LBT:{token}:SEP⟧"
    parts = [part.strip() for part in clean.split(separator)]
    issue = "" if len(parts) == expected else f"parts={len(parts)} expected={expected}"
    parts = parts[:expected] + [""] * max(0, expected - len(parts))
    return parts, issue, clean_input


def parse_start_end(text: str, expected: int, token: str) -> tuple[list[str], str, bool]:
    clean, clean_input = strip_outer_fence(text)
    start = f"⟦LBT:{token}:START⟧"
    separator = f"⟦LBT:{token}:NEXT⟧"
    end = f"⟦LBT:{token}:END⟧"
    start_pos, end_pos = clean.find(start), clean.find(end)
    if start_pos < 0 or end_pos <= start_pos:
        return [""] * expected, "START/END marker missing", clean_input
    inner = clean[start_pos + len(start):end_pos].strip()
    parts = [part.strip() for part in inner.split(separator)]
    issue = "" if len(parts) == expected else f"parts={len(parts)} expected={expected}"
    parts = parts[:expected] + [""] * max(0, expected - len(parts))
    return parts, issue, clean_input


def parse_plain(text: str, expected: int) -> tuple[list[str], str, bool]:
    clean, clean_input = strip_outer_fence(text)
    return ([clean] if clean else [""]), ("" if clean else "empty response"), clean_input


def parse_single_marked(text: str, token: str) -> tuple[list[str], str, bool]:
    clean, clean_input = strip_outer_fence(text)
    start = f"⟦LBT:{token}:START⟧"
    end = f"⟦LBT:{token}:END⟧"
    start_pos, end_pos = clean.find(start), clean.find(end)
    if start_pos < 0 or end_pos <= start_pos:
        return [""], "START/END marker missing", clean_input
    value = clean[start_pos + len(start):end_pos].strip()
    return [value], "" if value else "empty inner text", clean_input


def batch_protocols(case: dict[str, Any]) -> dict[str, Protocol]:
    segments = case["segments"]
    target = case["target_lang"]
    token = stable_token(case, "batch")
    indexed_markers = [f"⟦LBT:{token}:{i + 1}⟧" for i in range(len(segments))]
    separator = f"⟦LBT:{token}:SEP⟧"
    start = f"⟦LBT:{token}:START⟧"
    next_marker = f"⟦LBT:{token}:NEXT⟧"
    end = f"⟦LBT:{token}:END⟧"
    rows = [{"i": i, "t": text} for i, text in enumerate(segments)]

    json_system = (
        "You are a translation engine. Return exactly one JSON object of the form "
        '{"r":[{"i":0,"t":"translated text"}]}. Preserve every supplied segment index. '
        "Return JSON only; no prose or code fences."
    )
    json_prompt = "\n".join([
        f"Translate the web-page text segments below into {target}.",
        f"- Translate every segment faithfully into {target}.",
        "- Preserve meaning, tone, numbers, punctuation, whitespace, and inline markers.",
        "- Never merge, split, reorder, or omit segments.",
        '- Preserve each segment index ("i") exactly as supplied.',
        '- Return exactly one JSON object shaped {"r":[{"i":0,"t":"translated text"}]} with one result for every source index.',
        "- Return JSON only; do not add prose, labels, Markdown fences, or extra top-level keys.",
        "",
        'Segments to translate (JSON array; each item is {"i": index, "t": text}):',
        json.dumps(rows, ensure_ascii=False, indent=2),
    ])

    indexed_source: list[str] = []
    for marker, text in zip(indexed_markers, segments):
        indexed_source.extend([marker, text])
    indexed_prompt = "\n".join([
        f"Translate each block below into {target}.",
        "A line containing a marker in the form ⟦LBT:...:N⟧ is not text.",
        "Copy every marker line exactly as supplied, then write only that block's translation.",
        "Keep the original block order. Do not merge, split, omit, or add blocks.",
        "Do not output JSON, lists, labels, explanations, or code fences.",
        "",
        *indexed_source,
    ])

    compact_prompt = "\n".join([
        f"Translate each block below into {target}. Keep the original block order.",
        "A line shaped like ⟦LBT:...:N⟧ is a segment marker, not text.",
        "Copy each marker line exactly, then output only its translation. Do not merge, omit, or add blocks.",
        "Do not output JSON, lists, labels, explanations, or code fences.",
        "",
        *indexed_source,
    ])

    shared_source = f"\n{separator}\n".join(segments)
    shared_prompt = "\n".join([
        f"Translate each block below into {target}.",
        f"The line {separator} is a separator, not text.",
        "Copy this separator line exactly between translated blocks. Do not translate, escape, remove, or change it.",
        "Keep the original block order. Do not merge, split, omit, or add blocks.",
        "Output only the translated blocks separated by that exact line. Do not output JSON, lists, labels, explanations, or code fences.",
        "",
        shared_source,
    ])

    start_end_source = f"{start}\n" + f"\n{next_marker}\n".join(segments) + f"\n{end}"
    start_end_prompt = "\n".join([
        f"Translate each block below into {target}.",
        f"Copy the marker lines {start}, {next_marker}, and {end} exactly.",
        f"Put translated blocks between them and use {next_marker} between blocks.",
        "Do not translate, escape, remove, or change any marker. Keep the original block order.",
        "Output nothing outside the START and END markers. Do not output JSON, lists, labels, explanations, or code fences.",
        "",
        start_end_source,
    ])

    return {
        "current-json": Protocol(
            "current-json",
            [{"role": "system", "content": json_system}, {"role": "user", "content": json_prompt}],
            lambda text: parse_json(text, len(segments)),
            "json_object",
        ),
        "indexed-markers": Protocol(
            "indexed-markers",
            [
                {"role": "system", "content": "You are a translation engine. Follow the marker format exactly. Output only marked translated blocks, with no explanation."},
                {"role": "user", "content": indexed_prompt},
            ],
            lambda text: parse_indexed(text, len(segments), token),
        ),
        "compact-markers": Protocol(
            "compact-markers",
            [
                {"role": "system", "content": "You are a translation engine. Copy segment marker lines exactly and output only translated blocks."},
                {"role": "user", "content": compact_prompt},
            ],
            lambda text: parse_indexed(text, len(segments), token),
        ),
        "shared-delimiter": Protocol(
            "shared-delimiter",
            [
                {"role": "system", "content": "You are a translation engine. Preserve the provided separator lines exactly and output only translated blocks."},
                {"role": "user", "content": shared_prompt},
            ],
            lambda text: parse_shared(text, len(segments), token),
        ),
        "start-end-markers": Protocol(
            "start-end-markers",
            [
                {"role": "system", "content": "You are a translation engine. Copy START, NEXT, and END marker lines exactly and output only the enclosed translated blocks."},
                {"role": "user", "content": start_end_prompt},
            ],
            lambda text: parse_start_end(text, len(segments), token),
        ),
    }


def single_protocols() -> dict[str, Protocol]:
    target = SINGLE_CASE["target_lang"]
    text = SINGLE_CASE["text"]
    token = stable_token(SINGLE_CASE, "single")
    start = f"⟦LBT:{token}:START⟧"
    end = f"⟦LBT:{token}:END⟧"
    system = "You are a translation engine. Return only the translated text in plain text. Do not return JSON, labels, explanations, quotation marks around the whole result, or code fences."
    current_prompt = "\n".join([
        f"Translate the single text below into {target}.",
        "- Translate exactly one text passage faithfully and idiomatically.",
        "- Preserve meaning, tone, numbers, punctuation, whitespace, and inline markers.",
        "- Return only the translated text in plain text.",
        "- Do not return JSON, segment indexes, labels, explanations, quotation marks around the whole result, or Markdown fences.",
        "",
        "Text to translate:",
        text,
    ])
    simple_prompt = "\n".join([
        f"Translate this text into {target}.",
        "Output only the translation. Do not add a label, explanation, JSON, quotes around the whole result, or a code fence.",
        "",
        text,
    ])
    marked_prompt = "\n".join([
        f"Translate the text between the two marker lines into {target}.",
        "Copy both marker lines exactly. Put only the translated text between them and output nothing else.",
        "Do not translate, escape, remove, or change either marker. Do not return JSON or a code fence.",
        "",
        start,
        text,
        end,
    ])
    return {
        "single-current": Protocol(
            "single-current",
            [{"role": "system", "content": system}, {"role": "user", "content": current_prompt}],
            lambda value: parse_plain(value, 1),
        ),
        "single-simple": Protocol(
            "single-simple",
            [{"role": "system", "content": system}, {"role": "user", "content": simple_prompt}],
            lambda value: parse_plain(value, 1),
        ),
        "single-marked": Protocol(
            "single-marked",
            [
                {"role": "system", "content": "You are a translation engine. Copy the START and END marker lines exactly and output only the enclosed translated text."},
                {"role": "user", "content": marked_prompt},
            ],
            lambda value: parse_single_marked(value, token),
        ),
    }


def post_json(url: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_message(payload: dict[str, Any]) -> tuple[str, str | None, int | None, int | None]:
    choice = (payload.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    content = message.get("content") or ""
    if isinstance(content, list):
        content = "".join(part.get("text", "") if isinstance(part, dict) else "" for part in content)
    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else None
    prompt_tokens = int(usage.get("prompt_tokens") or 0) if usage else None
    completion_tokens = int(usage.get("completion_tokens") or 0) if usage else None
    return str(content), choice.get("finish_reason"), prompt_tokens, completion_tokens


def run_attempt(args: argparse.Namespace, mode: str, label: str, protocol: Protocol, run: int, expected_count: int) -> Attempt:
    payload: dict[str, Any] = {
        "model": args.model,
        "messages": protocol.messages,
        "temperature": args.temperature,
        "max_tokens": args.max_tokens,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    if protocol.response_format:
        payload["response_format"] = {"type": protocol.response_format}
    started = time.perf_counter()
    try:
        response = post_json(args.base_url.rstrip("/") + "/chat/completions", payload, args.timeout)
        duration = time.perf_counter() - started
        output, finish_reason, prompt_tokens, completion_tokens = extract_message(response)
        parsed, issue, clean = protocol.parse(output)
        ok = not issue and len(parsed) == expected_count and all(value.strip() for value in parsed)
        return Attempt(
            mode, protocol.name, label, run, ok,
            sum(bool(value.strip()) for value in parsed), expected_count, issue, clean,
            round(duration, 3), prompt_tokens, completion_tokens, finish_reason,
            output, parsed,
        )
    except Exception as error:
        return Attempt(
            mode, protocol.name, label, run, False, 0, expected_count,
            "request failed", False, round(time.perf_counter() - started, 3),
            None, None, None, "", [], str(error),
        )


def summarize(attempts: list[Attempt]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for mode, protocol, case in sorted({(a.mode, a.protocol, a.case) for a in attempts}):
        subset = [a for a in attempts if a.mode == mode and a.protocol == protocol and a.case == case]
        durations = [a.duration_s for a in subset]
        rows.append({
            "mode": mode,
            "protocol": protocol,
            "case": case,
            "runs": len(subset),
            "success": sum(a.ok for a in subset),
            "rate": round(sum(a.ok for a in subset) / len(subset), 3),
            "avg_s": round(statistics.mean(durations), 3),
            "issues": sorted({a.issue for a in subset if a.issue}),
        })
    return rows


def print_summary(rows: list[dict[str, Any]], attempts: list[Attempt]) -> None:
    print("Mode    Protocol                 Case            Runs  OK   Rate   Avg s")
    print("-" * 80)
    for row in rows:
        print(f"{row['mode']:<7} {row['protocol']:<24} {row['case']:<15} {row['runs']:>4} {row['success']:>3}  {row['rate']:>5.1%}  {row['avg_s']:>6.2f}")
    failures = [a for a in attempts if not a.ok]
    if failures:
        print("\nFailures:")
        for item in failures[:12]:
            print(f"- {item.mode}/{item.protocol}/{item.case} run {item.run}: {item.error or item.issue or 'empty output'}")
        if len(failures) > 12:
            print(f"- ... {len(failures) - 12} more in JSON output")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--mode", choices=["batch", "single", "both"], default="both")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--max-tokens", type=int, default=2048)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--protocols", default=DEFAULT_PROTOCOLS + ",single-current,single-simple,single-marked")
    parser.add_argument("--cases", default="product-page,mixed-technical,selection")
    parser.add_argument("--out", default="tools/prompt-lab-results.json")
    args = parser.parse_args()
    selected_protocols = {item.strip() for item in args.protocols.split(",") if item.strip()}
    selected_cases = {item.strip() for item in args.cases.split(",") if item.strip()}
    attempts: list[Attempt] = []

    if args.mode in ("batch", "both"):
        for case in BATCH_CASES:
            if case["name"] not in selected_cases:
                continue
            protocols = batch_protocols(case)
            for protocol_name, protocol in protocols.items():
                if protocol_name not in selected_protocols:
                    continue
                for run in range(1, args.runs + 1):
                    print(f"running {protocol_name}/{case['name']} #{run} ...", flush=True)
                    attempt = run_attempt(args, "batch", case["name"], protocol, run, len(case["segments"]))
                    attempts.append(attempt)
                    print(f"  {'OK' if attempt.ok else 'FAIL'} {attempt.parsed_count}/{attempt.expected_count} {attempt.duration_s:.2f}s {attempt.issue}", flush=True)

    if args.mode in ("single", "both") and SINGLE_CASE["name"] in selected_cases:
        for protocol_name, protocol in single_protocols().items():
            if protocol_name not in selected_protocols:
                continue
            for run in range(1, args.runs + 1):
                print(f"running {protocol_name}/{SINGLE_CASE['name']} #{run} ...", flush=True)
                attempt = run_attempt(args, "single", SINGLE_CASE["name"], protocol, run, 1)
                attempts.append(attempt)
                print(f"  {'OK' if attempt.ok else 'FAIL'} {attempt.parsed_count}/{attempt.expected_count} {attempt.duration_s:.2f}s {attempt.issue}", flush=True)

    rows = summarize(attempts)
    result = {
        "base_url": args.base_url,
        "model": args.model,
        "temperature": args.temperature,
        "runs": args.runs,
        "protocols": sorted(selected_protocols),
        "cases": sorted(selected_cases),
        "summary": rows,
        "attempts": [asdict(item) for item in attempts],
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n" + "-" * 80)
    print_summary(rows, attempts)
    print(f"\nRaw results: {out_path.resolve()}")
    return 0 if all(item.ok for item in attempts) else 1


if __name__ == "__main__":
    raise SystemExit(main())
