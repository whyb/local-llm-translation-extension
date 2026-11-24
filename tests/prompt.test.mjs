import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_PROMPT_TEMPLATES, LEGACY_PROMPT_TEMPLATES, MODE_PROMPT_PARAMETERS, PROMPT_CONTRACT_VERSION,
  PROMPT_MODE_CONTRACTS, PROMPT_PARAMETERS, promptFingerprint,
  renderPromptTemplate, validatePromptTemplate
} from '../src/shared/prompt.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings.js';
import { makeTmKey } from '../src/shared/text.js';
import {
  buildMessages, contextBoundedBatches, contextPromptTokenBudget, createBatchToken, estimateBatchPromptTokens,
  parseBatchResponse, parseEnvelope, parseMarkerEnvelope, promptVersionForSettings, testTranslationPrompt, TranslationService
} from '../src/background/translator.js';
import { ProviderError } from '../src/background/providers/index.js';
import { MESSAGE, validateContentMessage } from '../src/shared/messages.js';

test('batch and single defaults expose mode-specific contracts and parameters', () => {
  assert.equal(validatePromptTemplate(DEFAULT_PROMPT_TEMPLATES.batch, 'batch').valid, true);
  assert.equal(validatePromptTemplate(DEFAULT_PROMPT_TEMPLATES.single, 'single').valid, true);
  assert.equal(PROMPT_MODE_CONTRACTS.batch.responseKind, 'marker-delimited-text');
  assert.equal(PROMPT_MODE_CONTRACTS.single.responseKind, 'plain-text');
  assert.match(DEFAULT_PROMPT_TEMPLATES.batch, /⟦LBT:\{batch_token\}:1⟧/);
  assert.doesNotMatch(DEFAULT_PROMPT_TEMPLATES.batch, /\{"r":/);
  assert.match(DEFAULT_PROMPT_TEMPLATES.single, /plain text/i);
  assert.equal(MODE_PROMPT_PARAMETERS.batch.source_text.required, true);
  assert.equal(MODE_PROMPT_PARAMETERS.batch.batch_token.required, false);
  assert.equal(MODE_PROMPT_PARAMETERS.single.source_text.required, true);
  assert.equal(MODE_PROMPT_PARAMETERS.single.source_text.returnFormat, 'Translated text');
  assert.equal(PROMPT_PARAMETERS.batch, MODE_PROMPT_PARAMETERS.batch);
  assert.equal(PROMPT_PARAMETERS.single, MODE_PROMPT_PARAMETERS.single);
  assert.equal(PROMPT_PARAMETERS.target_lang.required, true);
});

test('prompt editor helper and disclosure identifiers do not collide', async () => {
  const source = await readFile(new URL('../src/ui/options/prompt-editor.js', import.meta.url), 'utf8');
  assert.match(source, /function parameterInfo\(name, mode\)/);
  assert.match(source, /const parameterDisclosure = el\('details'/);
  assert.doesNotMatch(source, /const parameterDetails\s*=/);
});

test('template validation is mode-aware and reports missing and unknown parameters', () => {
  const batch = validatePromptTemplate('Translate into {target_lang}. Extra: {mystery}.', 'batch');
  assert.equal(batch.valid, false);
  assert.equal(batch.mode, 'batch');
  assert.deepEqual(batch.missing, ['source_text']);
  assert.deepEqual(batch.unknown, ['mystery']);
  assert.deepEqual(batch.required, ['target_lang', 'source_text']);

  const single = validatePromptTemplate('{target_lang}: {source_text}', 'single');
  assert.equal(single.valid, true);
  assert.equal(single.mode, 'single');
  assert.throws(() => validatePromptTemplate('{target_lang}', 'unsupported'), /Unsupported prompt mode/);
});

test('renderPromptTemplate preserves the selected mode and source text representation', () => {
  const indexed = JSON.stringify([{ i: 0, t: 'Hello' }, { i: 1, t: 'World' }]);
  const batch = renderPromptTemplate('{target_lang}\n{source_text}', {
    target_lang: 'German',
    source_text: indexed
  }, 'batch');
  assert.equal(batch, `German\n${indexed}`);

  const single = renderPromptTemplate('{target_lang}\n{source_text}', {
    target_lang: 'German',
    source_text: 'Hello, world!'
  }, 'single');
  assert.equal(single, 'German\nHello, world!');
});

test('settings migrate the legacy promptTemplate into both new modes without keeping a duplicate field', () => {
  const defaults = normalizeSettings(null).translation.promptTemplates;
  assert.equal(defaults.batch, DEFAULT_PROMPT_TEMPLATES.batch);
  assert.equal(defaults.single, DEFAULT_PROMPT_TEMPLATES.single);

  const legacy = 'Translate to {target_lang}.\n{source_text}';
  const migrated = normalizeSettings({ translation: { promptTemplate: legacy } });
  assert.equal(migrated.translation.promptTemplates.batch, legacy);
  assert.equal(migrated.translation.promptTemplates.single, legacy);
  assert.equal(Object.hasOwn(migrated.translation, 'promptTemplate'), false);

  const partiallyNew = normalizeSettings({
    translation: {
      promptTemplate: legacy,
      promptTemplates: { batch: 'Batch {target_lang}\n{source_text}', single: '   ' }
    }
  });
  assert.equal(partiallyNew.translation.promptTemplates.batch, 'Batch {target_lang}\n{source_text}');
  assert.equal(partiallyNew.translation.promptTemplates.single, legacy);

  const upgradedDefaults = normalizeSettings({
    translation: {
      promptTemplates: {
        batch: LEGACY_PROMPT_TEMPLATES.batch,
        single: LEGACY_PROMPT_TEMPLATES.single
      }
    }
  });
  assert.equal(upgradedDefaults.translation.promptTemplates.batch, DEFAULT_PROMPT_TEMPLATES.batch);
  assert.equal(upgradedDefaults.translation.promptTemplates.single, DEFAULT_PROMPT_TEMPLATES.single);
});

test('buildMessages uses marker-delimited batch blocks and one plain string for single', () => {
  const batchTemplate = [
    'target={target_lang}',
    'source={source_lang}',
    'tone={tone}',
    'glossary={glossary_json}',
    'custom={custom_instructions}',
    'token={batch_token}',
    '{source_text}'
  ].join('\n');
  const singleTemplate = 'target={target_lang}\n{source_text}';
  const settings = normalizeSettings({
    translation: {
      targetLang: 'fr-FR',
      promptTemplates: { batch: batchTemplate, single: singleTemplate },
      formality: 'formal',
      glossary: [{ source: 'API', replacement: 'API' }],
      customPromptAdditions: 'Use developer-friendly wording.'
    }
  });

  const batchMessages = buildMessages(
    [{ text: 'Hello' }, { text: 'Open settings' }],
    { settings, targetLang: 'fr-FR', sourceLang: 'en-US', batchToken: 'ABC12345' },
    'batch'
  );
  assert.match(batchMessages[0].content, /Copy every segment marker line exactly/);
  assert.match(batchMessages[0].content, /Do not return JSON/);
  assert.equal(batchMessages[1].content, [
    'target=fr-FR',
    'source=en-US',
    'tone=formal',
    'glossary=[{"source":"API","replacement":"API"}]',
    'custom=Use developer-friendly wording.',
    'token=ABC12345',
    '⟦LBT:ABC12345:1⟧',
    'Hello',
    '⟦LBT:ABC12345:2⟧',
    'Open settings'
  ].join('\n'));

  const singleMessages = buildMessages(
    [{ text: 'A selected "quoted" passage' }],
    { settings, targetLang: 'fr-FR', sourceLang: 'en-US' },
    'single'
  );
  assert.match(singleMessages[0].content, /plain text/);
  assert.match(singleMessages[0].content, /Do not return JSON/);
  assert.equal(singleMessages[1].content, 'target=fr-FR\nA selected "quoted" passage');
});

test('parseEnvelope remains strict JSON-array based even for one batch segment', () => {
  assert.deepEqual(parseEnvelope('{"r":[{"i":0,"t":"Bonjour"}]}', 1), [{ i: 0, t: 'Bonjour' }]);
  assert.deepEqual(parseEnvelope('[{"i":0,"t":"Bonjour"}]', 1), [{ i: 0, t: 'Bonjour' }]);
  assert.throws(
    () => parseEnvelope('Bonjour', 1),
    (error) => error instanceof ProviderError && error.kind === 'malformed'
  );
});

test('marker parser tolerates wrapper changes and maps by marker index', () => {
  const token = 'ABC12345';
  const output = [
    '[LBT : ABC12345 : 2]',
    'Deux',
    '⟦LBT:ABC12345:1⟧',
    'Un'
  ].join('\n');
  assert.deepEqual(parseMarkerEnvelope(output, 2, token), [
    { i: 1, t: 'Deux' },
    { i: 0, t: 'Un' }
  ]);
  assert.throws(
    () => parseMarkerEnvelope('⟦LBT:ABC12345:1⟧\nUn', 2, token),
    (error) => error instanceof ProviderError && error.kind === 'malformed'
  );
});

test('batch parser keeps JSON as a backward-compatible fallback', () => {
  const token = 'ABC12345';
  assert.deepEqual(
    parseBatchResponse('{"r":[{"i":0,"t":"Bonjour"}]}', 1, token),
    [{ i: 0, t: 'Bonjour' }]
  );
  assert.throws(
    () => parseBatchResponse('{"r":[{"i":0,"t":"Bonjour"}]}', 2, token),
    (error) => error instanceof ProviderError && error.kind === 'malformed'
  );
  assert.throws(
    () => parseBatchResponse('Bonjour sans marqueur', 1, token),
    (error) => error instanceof ProviderError
      && error.kind === 'malformed'
      && !error.detail.includes('Bonjour sans marqueur')
  );
});

test('createBatchToken avoids reusing text found in the source', () => {
  const token = createBatchToken([{ text: 'contains ABC12345 already' }], 'ABC12345');
  assert.notEqual(token, 'ABC12345');
  assert.match(token, /^[A-Z0-9]{6,}$/);
});

test('invalid batch template fails with ProviderError before any provider network call', async () => {
  const settings = normalizeSettings({
    translation: { promptTemplates: { batch: 'Translate into {target_lang}.', single: DEFAULT_PROMPT_TEMPLATES.single } }
  });
  const service = new TranslationService({ getSettings: () => settings });
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('unexpected network call');
  };
  try {
    await assert.rejects(
      () => service.translateBatch(
        [{ id: 'u1', text: 'Hello' }],
        { targetLang: 'de', sourceLang: 'en', domain: '' }
      ),
      (error) => error instanceof ProviderError
        && error.kind === 'config'
        && /batch mode/.test(error.message)
        && /\{source_text\}/.test(error.message)
    );
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prompt fingerprints include both templates, mode, custom additions, tone and contract version', () => {
  const templates = { ...DEFAULT_PROMPT_TEMPLATES };
  const base = {
    templates,
    mode: 'batch',
    customPromptAdditions: '',
    tone: 'default'
  };
  const fingerprint = promptFingerprint(base);
  assert.equal(typeof fingerprint, 'number');
  assert.equal(fingerprint, promptFingerprint({ ...base }));
  assert.notEqual(fingerprint, promptFingerprint({ ...base, templates: { ...templates, batch: `${templates.batch}\nBe concise.` } }));
  assert.notEqual(fingerprint, promptFingerprint({ ...base, templates: { ...templates, single: `${templates.single}\nBe concise.` } }));
  assert.notEqual(fingerprint, promptFingerprint({ ...base, mode: 'single' }));
  assert.notEqual(fingerprint, promptFingerprint({ ...base, customPromptAdditions: 'Use legal terminology.' }));
  assert.notEqual(fingerprint, promptFingerprint({ ...base, tone: 'formal' }));
  assert.notEqual(fingerprint, promptFingerprint({ ...base, contractVersion: PROMPT_CONTRACT_VERSION + 1 }));

  const settings = normalizeSettings({ translation: { promptTemplates: templates } });
  const batchVersion = promptVersionForSettings(settings, 'batch');
  const singleVersion = promptVersionForSettings(settings, 'single');
  assert.notEqual(batchVersion, singleVersion);
  const keyInput = {
    text: 'Hello',
    targetLang: 'de',
    profileId: 'p1',
    model: 'model',
    promptVersion: batchVersion,
    glossaryFingerprint: 'g',
    normalizeRules: DEFAULT_SETTINGS.cache.normalizeRules
  };
  assert.notEqual(makeTmKey(keyInput), makeTmKey({ ...keyInput, promptVersion: singleVersion }));
});

test('batch requests use marker text without a JSON response format', async () => {
  const settings = normalizeSettings({
    cache: { enabled: false },
    providers: {
      profiles: [{
        id: 'batch-test',
        name: 'Batch test',
        role: 'primary',
        adapter: 'openai',
        baseUrl: 'http://localhost:1234/v1',
        model: 'test-model',
        structuredOutput: 'json_schema',
        streaming: false,
        timeoutMs: 1000
      }]
    }
  });
  const service = new TranslationService({ getSettings: () => settings });
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: { content: '⟦LBT:ABC12345:1⟧\nBonjour\n⟦LBT:ABC12345:2⟧\nOuvrir les paramètres' },
        finish_reason: 'stop'
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await service.translateBatch(
      [{ id: 'u1', text: 'Hello' }, { id: 'u2', text: 'Open settings' }],
      { targetLang: 'fr', sourceLang: 'en', domain: '', batchToken: 'ABC12345' }
    );
    assert.equal(captured.response_format, undefined);
    assert.match(captured.messages[1].content, /⟦LBT:ABC12345:1⟧/);
    assert.doesNotMatch(captured.messages[1].content, /\{"i":0/);
    assert.equal(result.translations.get(0), 'Bonjour');
    assert.equal(result.translations.get(1), 'Ouvrir les paramètres');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('malformed batch text degrades to independent plain-text translations', async () => {
  const settings = normalizeSettings({
    cache: { enabled: false },
    providers: {
      profiles: [{
        id: 'fallback-test',
        name: 'Fallback test',
        role: 'primary',
        adapter: 'openai',
        baseUrl: 'http://localhost:1234/v1',
        model: 'test-model',
        streaming: false,
        timeoutMs: 1000
      }]
    }
  });
  const service = new TranslationService({ getSettings: () => settings });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const isBatch = body.messages[1].content.includes('⟦LBT:');
    const content = isBatch
      ? 'The model forgot every marker.'
      : body.messages[1].content.includes('Hello') ? 'Bonjour' : 'Ouvrir les paramètres';
    return new Response(JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const delivered = [];
  try {
    const result = await service.translateUnits(
      [{ id: 'u1', kind: 'text', text: 'Hello' }, { id: 'u2', kind: 'text', text: 'Open settings' }],
      {
        domain: '',
        targetLang: 'fr',
        sourceLang: 'en',
        onSegment: (message) => delivered.push(message)
      }
    );
    assert.equal(result.done, 2);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].response_format, undefined);
    assert.equal(requests[1].response_format, undefined);
    assert.equal(requests[2].response_format, undefined);
    assert.equal(delivered.length, 2);
    assert.deepEqual(delivered.map((item) => item.text), ['Bonjour', 'Ouvrir les paramètres']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prompt-test messages validate text, mode and batch bounds', () => {
  const base = {
    type: MESSAGE.TRANSLATION_PROMPT_TEST_REQUEST,
    settings: {},
    mode: 'batch',
    texts: ['Hello'],
    batchSize: 8
  };
  assert.equal(validateContentMessage(base), true);
  assert.equal(validateContentMessage({ ...base, mode: 'other' }), false);
  assert.equal(validateContentMessage({ ...base, texts: [] }), false);
  assert.equal(validateContentMessage({ ...base, batchSize: 33 }), false);
  assert.equal(validateContentMessage({ ...base, texts: ['x'.repeat(50001)] }), false);
});

test('prompt test helper uses the current batch and single translation paths', async () => {
  const settings = normalizeSettings({
    cache: { enabled: false },
    providers: {
      profiles: [{
        id: 'prompt-test',
        name: 'Prompt test',
        role: 'primary',
        adapter: 'openai',
        baseUrl: 'http://localhost:1234/v1',
        model: 'test-model',
        streaming: false,
        timeoutMs: 1000
      }]
    },
    translation: { targetLang: 'fr' }
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const user = body.messages[1].content;
    const marker = user.match(/⟦LBT:([A-Z0-9]+):1⟧/);
    const content = marker
      ? `⟦LBT:${marker[1]}:1⟧\nBonjour`
      : 'Bonjour en texte brut';
    return new Response(JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const batch = await testTranslationPrompt({
      settings,
      mode: 'batch',
      texts: ['Hello', 'Open settings'],
      batchSize: 1
    });
    assert.equal(batch.requestedBatchSize, 1);
    assert.equal(batch.rows.length, 1);
    assert.equal(batch.rows[0].translation, 'Bonjour');
    assert.equal(calls[0].response_format, undefined);

    const single = await testTranslationPrompt({
      settings,
      mode: 'single',
      texts: ['Hello'],
      batchSize: 8
    });
    assert.equal(single.requestedBatchSize, 1);
    assert.equal(single.rows[0].translation, 'Bonjour en texte brut');
    assert.equal(calls[1].response_format, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('selection uses plain-text single mode without parsing or requesting JSON', async () => {
  const settings = normalizeSettings({
    cache: { enabled: false },
    providers: {
      profiles: [{
        id: 'selection-test',
        name: 'Selection test',
        role: 'selection',
        adapter: 'openai',
        baseUrl: 'http://localhost:1234/v1',
        model: 'test-model',
        structuredOutput: 'json_schema',
        streaming: false,
        timeoutMs: 1000
      }]
    },
    translation: {
      promptTemplates: {
        batch: DEFAULT_PROMPT_TEMPLATES.batch,
        single: 'Translate into {target_lang}. Return only plain text.\n{source_text}'
      }
    }
  });
  const service = new TranslationService({ getSettings: () => settings });
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Plain response: {not-json}' }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await service.translateSelection('Hello world', {
      url: 'https://example.com/article',
      requestId: 'selection-1',
      targetLang: 'fr',
      sourceLang: 'en'
    });
    assert.equal(result.text, 'Plain response: {not-json}');
    assert.ok(captured);
    assert.equal(captured.body.response_format, undefined);
    assert.match(captured.body.messages[0].content, /plain text/);
    assert.match(captured.body.messages[0].content, /Do not return JSON/);
    assert.match(captured.body.messages[1].content, /Hello world/);
    assert.doesNotMatch(captured.body.messages[1].content, /\{"i":0/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('context-length-aware batching splits oversized marker batches', () => {
  const settings = normalizeSettings({
    cache: { enabled: false },
    providers: {
      profiles: [{
        id: 'small-context',
        name: 'Small context',
        role: 'primary',
        adapter: 'llamacpp',
        baseUrl: 'http://127.0.0.1:8080/v1',
        model: 'test-model',
        contextLength: 512,
        batchSize: 8,
        maxTokens: null
      }]
    },
    translation: { targetLang: 'fr' }
  });
  const profile = settings.providers.profiles[0];
  const context = { settings, targetLang: 'fr', sourceLang: 'en', domain: '' };
  const units = Array.from({ length: 12 }, (_, index) => ({
    id: `unit-${index}`,
    kind: 'text',
    text: `Item ${index}: ${'translation content '.repeat(12)}`
  }));
  const budget = contextPromptTokenBudget(profile);
  const batches = contextBoundedBatches(units, 8, context, profile);
  assert.equal(budget, 384);
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => batch.length <= 8));
  assert.ok(batches.every((batch) => batch.length === 1 || estimateBatchPromptTokens(batch, context) <= budget));
  assert.equal(batches.flat().length, units.length);
});
