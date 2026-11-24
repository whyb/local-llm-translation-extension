#!/usr/bin/env node
/** Real-endpoint smoke test for the exact production prompt path. */
import { testTranslationPrompt, TranslationService } from '../src/background/translator.js';
import { normalizeSettings } from '../src/shared/settings.js';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:9931/v1';
const model = process.argv[3] ?? 'gemma4_26b_a4b';
const settings = normalizeSettings({
  cache: { enabled: false },
  providers: {
    profiles: [{
      id: 'local-smoke',
      name: 'Local smoke test',
      role: 'primary',
      adapter: 'llamacpp',
      baseUrl,
      model,
      batchSize: 4,
      timeoutMs: 180000,
      temperature: 0.2,
      streaming: false
    }]
  },
  translation: { targetLang: 'Simplified Chinese (zh-CN)' }
});
const service = new TranslationService({ getSettings: () => settings });
const units = [
  { id: 'u1', kind: 'text', text: 'Local LLM Translator' },
  { id: 'u2', kind: 'text', text: 'Open settings' },
  { id: 'u3', kind: 'text', text: 'Use {name} without translating the placeholder.' },
  { id: 'u4', kind: 'text', text: 'Read the documentation.' }
];
const started = performance.now();
const batch = await service.translateBatch(units, {
  targetLang: 'Simplified Chinese (zh-CN)',
  sourceLang: 'English',
  domain: '',
  batchToken: 'SMOKE12345'
});
const promptTestBatch = await testTranslationPrompt({
  settings,
  mode: 'batch',
  texts: ['Local LLM Translator', 'Open settings', 'Read the documentation.'],
  batchSize: 3
});
const promptTestSingle = await testTranslationPrompt({
  settings,
  mode: 'single',
  texts: ['Translate pages privately with your own model.']
});
const single = await service.translateSingle('Translate pages privately with your own model.', {
  targetLang: 'Simplified Chinese (zh-CN)',
  sourceLang: 'English',
  domain: '',
  profileRole: 'primary',
  preferredProfileId: 'local-smoke'
});
const batchRows = units.map((unit, index) => ({ source: unit.text, translation: batch.translations.get(index) ?? null }));
if (batch.translations.size !== units.length || batchRows.some((row) => !row.translation)) {
  throw new Error(`batch smoke failed: ${JSON.stringify(batchRows)}`);
}
if (!single.text.trim()) throw new Error('single smoke returned empty text');
if (promptTestBatch.rows.length !== 3 || promptTestSingle.rows.length !== 1) throw new Error('prompt-test helper smoke failed');
console.log(JSON.stringify({
  endpoint: baseUrl,
  model,
  durationMs: Math.round(performance.now() - started),
  batchRows,
  single: single.text,
  promptTestBatch,
  promptTestSingle
}, null, 2));
