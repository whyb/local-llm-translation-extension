import { stableHash } from './text.js';

/**
 * Bump this whenever a fixed system contract or prompt template syntax changes
 * in a way that must invalidate cached translations.
 */
export const PROMPT_CONTRACT_VERSION = 4;

export const PROMPT_MODES = Object.freeze(['batch', 'single']);

const TOKEN_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

const BATCH_PROMPT_TEMPLATE = [
  'Translate every block below into {target_lang}. Keep the original order.',
  '',
  'Source language: {source_lang}',
  'Requested tone/formality: {tone}',
  'Glossary (JSON): {glossary_json}',
  'Additional instructions: {custom_instructions}',
  '',
  'Each block starts with a marker line such as ⟦LBT:{batch_token}:1⟧.',
  'Copy each marker line exactly and put only its translated text after it.',
  'Do not change markers, merge blocks, add labels, use JSON, or add explanations.',
  '',
  'Blocks:',
  '{source_text}'
].join('\n');

const SINGLE_PROMPT_TEMPLATE = [
  'Translate the text below into {target_lang}.',
  '',
  'Source language: {source_lang}',
  'Requested tone/formality: {tone}',
  'Glossary (JSON): {glossary_json}',
  'Additional instructions: {custom_instructions}',
  '',
  'Output only the translation in plain text. Do not add JSON, labels, explanations, quotation marks around the whole result, or code fences.',
  '',
  'Text:',
  '{source_text}'
].join('\n');

export const DEFAULT_PROMPT_TEMPLATES = Object.freeze({
  batch: BATCH_PROMPT_TEMPLATE,
  single: SINGLE_PROMPT_TEMPLATE
});
export const LEGACY_PROMPT_TEMPLATES = Object.freeze({
  batch: [
    'Translate the web-page text segments below into {target_lang}.',
    '',
    'Source language: {source_lang}',
    'Requested tone/formality: {tone}',
    'Glossary (JSON): {glossary_json}',
    'Additional instructions: {custom_instructions}',
    '',
    'Requirements:',
    '- Translate every segment faithfully and idiomatically into {target_lang}.',
    '- Preserve meaning, tone, numbers, punctuation, whitespace, and inline markers.',
    '- Never merge, split, reorder, or omit segments.',
    '- Preserve each segment index ("i") exactly as supplied.',
    '- Apply glossary replacements when they are relevant.',
    '- Return exactly one JSON object shaped {"r":[{"i":0,"t":"translated text"}]} with one result for every source index.',
    '- Return JSON only; do not add prose, labels, Markdown fences, or extra top-level keys.',
    '',
    'Segments to translate (JSON array; each item is {"i": index, "t": text}):',
    '{source_text}'
  ].join('\n'),
  single: [
    'Translate the single text below into {target_lang}.',
    '',
    'Source language: {source_lang}',
    'Requested tone/formality: {tone}',
    'Glossary (JSON): {glossary_json}',
    'Additional instructions: {custom_instructions}',
    '',
    'Requirements:',
    '- Translate exactly one text passage faithfully and idiomatically into {target_lang}.',
    '- Preserve meaning, tone, numbers, punctuation, whitespace, and inline markers.',
    '- Apply glossary replacements when they are relevant.',
    '- Return only the translated text in plain text.',
    '- Do not return JSON, segment indexes, labels, explanations, quotation marks around the whole result, or Markdown fences.',
    '',
    'Text to translate:',
    '{source_text}'
  ].join('\n')
});


// Backward-compatible alias for callers that still import the original export.
export const DEFAULT_PROMPT_TEMPLATE = DEFAULT_PROMPT_TEMPLATES.batch;

export const PROMPT_MODE_CONTRACTS = Object.freeze({
  batch: Object.freeze({
    mode: 'batch',
    sourceTextKind: 'marker-delimited-blocks',
    responseKind: 'marker-delimited-text',
    responseFormat: '⟦LBT:<token>:1⟧\nTranslated text\n⟦LBT:<token>:2⟧\nTranslated text',
    description: 'The model receives marker-delimited blocks and must copy every marker line exactly, followed by only that block translation.'
  }),
  single: Object.freeze({
    mode: 'single',
    sourceTextKind: 'plain-string',
    responseKind: 'plain-text',
    responseFormat: 'Translated text',
    description: 'The model receives one plain-text string and must return only its translated plain text, with no JSON wrapper or segment index.'
  })
});

const COMMON_PARAMETERS = Object.freeze({
  source_lang: Object.freeze({
    token: '{source_lang}',
    required: false,
    label: 'Source language',
    description: 'The detected or user-supplied source language. It is "auto-detect" when the source language is unknown.',
    example: 'English (en) or auto-detect'
  }),
  tone: Object.freeze({
    token: '{tone}',
    required: false,
    label: 'Tone / formality',
    description: 'The requested translation tone, normally "default", "informal", or "formal".',
    example: 'formal'
  }),
  glossary_json: Object.freeze({
    token: '{glossary_json}',
    required: false,
    label: 'Glossary',
    description: 'A JSON array of glossary entries with "source" and "replacement" fields, or an empty array when no glossary is configured.',
    example: '[{"source":"API","replacement":"API"}]'
  }),
  custom_instructions: Object.freeze({
    token: '{custom_instructions}',
    required: false,
    label: 'Custom instructions',
    description: 'Additional user instructions from Custom prompt additions, or a marker indicating that no extra instructions were supplied.',
    example: 'Use concise technical terminology.'
  })
});

export const MODE_PROMPT_PARAMETERS = Object.freeze({
  batch: Object.freeze({
    ...COMMON_PARAMETERS,
    target_lang: Object.freeze({
      token: '{target_lang}',
      required: true,
      label: 'Target language',
      description: 'The language name or language code selected by the user. Every batch segment must be translated into this language.',
      example: 'French (fr-FR)'
    }),
    batch_token: Object.freeze({
      token: '{batch_token}',
      required: false,
      label: 'Batch marker token',
      description: 'A request-specific marker value. Keep this placeholder when customizing the default template so the model sees the exact marker example.',
      example: 'A1B2C3D4'
    }),
    source_text: Object.freeze({
      token: '{source_text}',
      required: true,
      label: 'Source text',
      description: 'Marker-delimited page blocks. Each block begins with a unique ⟦LBT:token:N⟧ line and must be returned with the same marker unchanged.',
      example: '⟦LBT:A1B2C3D4:1⟧\nHello',
      returnFormat: PROMPT_MODE_CONTRACTS.batch.responseFormat
    })
  }),
  single: Object.freeze({
    ...COMMON_PARAMETERS,
    target_lang: Object.freeze({
      token: '{target_lang}',
      required: true,
      label: 'Target language',
      description: 'The language name or language code selected by the user for this single text translation.',
      example: 'French (fr-FR)'
    }),
    source_text: Object.freeze({
      token: '{source_text}',
      required: true,
      label: 'Source text',
      description: 'One plain-text string. It is not JSON and has no segment index; the model must return only the translated plain text.',
      example: 'Hello, how are you?',
      returnFormat: PROMPT_MODE_CONTRACTS.single.responseFormat
    })
  })
});

// Keep the original direct property access working, while also exposing the
// nested mode-specific shape used by the options editor.
export const PROMPT_PARAMETERS = Object.freeze({
  ...MODE_PROMPT_PARAMETERS.batch,
  batch: MODE_PROMPT_PARAMETERS.batch,
  single: MODE_PROMPT_PARAMETERS.single
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeMode(mode = 'batch') {
  const value = String(mode || 'batch');
  if (!PROMPT_MODES.includes(value)) throw new RangeError(`Unsupported prompt mode: ${value}`);
  return value;
}

function templateTokens(template) {
  const source = typeof template === 'string' ? template : '';
  const tokens = [];
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    if (!tokens.includes(match[1])) tokens.push(match[1]);
  }
  return tokens;
}

function normalizedTemplate(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function templateSet(templates, legacyTemplate = null) {
  const value = templates && typeof templates === 'object' ? templates : {};
  const legacy = typeof legacyTemplate === 'string' && legacyTemplate.trim() ? legacyTemplate : null;
  return {
    batch: normalizedTemplate(value.batch, legacy ?? DEFAULT_PROMPT_TEMPLATES.batch),
    single: normalizedTemplate(value.single, legacy ?? DEFAULT_PROMPT_TEMPLATES.single)
  };
}

export function validatePromptTemplate(template, mode = 'batch') {
  const promptMode = normalizeMode(mode);
  const parameters = MODE_PROMPT_PARAMETERS[promptMode];
  const used = templateTokens(template);
  const required = Object.entries(parameters)
    .filter(([, parameter]) => parameter.required)
    .map(([name]) => name);
  const missing = required.filter((name) => !used.includes(name));
  const unknown = used.filter((name) => !hasOwn(parameters, name));
  return {
    valid: missing.length === 0 && unknown.length === 0,
    mode: promptMode,
    required,
    missing,
    unknown,
    used
  };
}

export function renderPromptTemplate(template, values = {}, mode = 'batch') {
  const promptMode = normalizeMode(mode);
  const parameters = MODE_PROMPT_PARAMETERS[promptMode];
  const source = normalizedTemplate(template, DEFAULT_PROMPT_TEMPLATES[promptMode]);
  return source.replace(TOKEN_PATTERN, (token, name) => {
    if (!hasOwn(parameters, name)) return token;
    const value = values?.[name];
    return value === null || value === undefined ? '' : String(value);
  });
}

/**
 * Return a compact numeric fingerprint for a prompt-sensitive TM key. Both
 * templates are included so changing either prompt invalidates all prompt-
 * dependent cache entries, while mode keeps batch and selection keys distinct.
 */
export function promptFingerprint(input = {}) {
  const options = typeof input === 'string' ? { template: input } : (input ?? {});
  const mode = normalizeMode(options.mode ?? 'batch');
  const templates = templateSet(options.templates ?? options.promptTemplates, options.template);
  const source = JSON.stringify([
    options.contractVersion ?? PROMPT_CONTRACT_VERSION,
    mode,
    templates.batch,
    templates.single,
    String(options.customPromptAdditions ?? ''),
    String(options.tone ?? 'default')
  ]);
  return Number.parseInt(stableHash(source).slice(0, 8), 16) >>> 0;
}