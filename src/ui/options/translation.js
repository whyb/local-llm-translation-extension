import { sendRuntimeMessage } from '../../shared/browser.js';
import { t } from '../../shared/i18n.js';
import { button, card, check, controlGrid, el, field, numberInput, selectInput, textArea, textInput } from './ui-utils.js';
import { languageField } from './language-picker.js';
import { promptEditor } from './prompt-editor.js';

const DEFAULT_TEST_TEXT = [
  'Local LLM Translator',
  'Open settings',
  'Your changes are saved automatically.',
  'Read the documentation.',
  'No account is required.',
  'Fast, private translation.',
  'Learn more',
  'Version 2.0.0',
  'Use {name} to open the dashboard.',
  'Visit https://example.com/docs?lang=en for details.'
].join('\n');

let testBatchSize = null;
let testTextValue = null;

export function renderTranslation(ctx) {
  const { settings, content, markDirty, render } = ctx;
  const translation = settings.translation;
  const target = languageField('Target language', translation.targetLang, (value) => { translation.targetLang = value; markDirty(); }, 'Searchable built-in list with flags. You can also type any language name or BCP 47 tag.');
  target.classList.add('span-two');
  const preview = displayModePreview(translation.renderMode);
  const displayMode = field('Display mode', selectInput(translation.renderMode, [
    { value: 'replace', label: 'Replace the original' },
    { value: 'bilingual-stacked', label: 'Bilingual — stacked' },
    { value: 'replace-hover-reveal', label: 'Replace, hover to reveal' }
  ], (value) => {
    translation.renderMode = value;
    preview.dataset.mode = value;
    markDirty();
  }), 'The preview updates immediately. Choose whether the page keeps the source text visible.');
  const identity = controlGrid(
    'two',
    target,
    displayMode,
    preview,
    field('Tone / formality', selectInput(translation.formality, [
      { value: 'default', label: 'Default' },
      { value: 'informal', label: 'Informal' },
      { value: 'formal', label: 'Formal' }
    ], (value) => { translation.formality = value; markDirty(); }), 'Passed into both the batch and single-text prompts.')
  );
  content.append(card('Prompt & presentation', 'These values are sent only when a translation is requested.', identity));

  content.append(promptEditor(ctx));
  content.append(promptTestCard(ctx));

  content.append(card(
    'Custom prompt additions',
    'Shared optional instructions. Include {custom_instructions} in either prompt template where this text should be inserted. Do not paste secrets.',
    textArea(translation.customPromptAdditions, (value) => { translation.customPromptAdditions = value; markDirty(); }, { rows: '5' })
  ));

  content.append(glossaryCard(ctx));

  const guardToggles = el('div', 'toggle-grid');
  guardToggles.append(
    check('Preserve whitespace', translation.layoutGuards.whitespace, (value) => { translation.layoutGuards.whitespace = value; markDirty(); }),
    check('Correct bidi direction', translation.layoutGuards.bidi, (value) => { translation.layoutGuards.bidi = value; markDirty(); }),
    check('Limit clipped expansion', translation.layoutGuards.clippedExpansion, (value) => { translation.layoutGuards.clippedExpansion = value; markDirty(); }),
    check('Preserve ruby / wbr', translation.layoutGuards.rubyWbr, (value) => { translation.layoutGuards.rubyWbr = value; markDirty(); })
  );
  const guards = controlGrid(
    'two',
    field('Max expansion ratio', numberInput(translation.layoutGuards.maxExpansionRatio, (value) => { translation.layoutGuards.maxExpansionRatio = value ?? 1.5; markDirty(); }, { min: '1', max: '8', step: '0.1' }), 'Prevents translated text from expanding beyond this ratio before the page layout is adjusted.'),
    guardToggles
  );
  content.append(card('Layout guards', 'Keep translated pages readable without changing the source text sent to the model.', guards));
}

function displayModePreview(mode) {
  const preview = el('div', 'display-preview');
  preview.dataset.mode = mode;
  preview.setAttribute('role', 'img');
  preview.setAttribute('aria-label', t('Example output'));
  preview.tabIndex = 0;
  const heading = el('div', 'display-preview-heading');
  heading.append(el('span', '', t('Example output')), el('span', 'display-preview-badge', t('Translated text')));
  const canvas = el('div', 'display-preview-canvas');
  const source = el('div', 'preview-line preview-source');
  source.append(el('span', 'preview-caption', t('Source text')), el('span', 'preview-copy', 'Privacy-first translation.'));
  const translated = el('div', 'preview-line preview-translation');
  translated.tabIndex = 0;
  translated.dataset.previewOriginal = 'Privacy-first translation.';
  translated.append(el('span', 'preview-caption', t('Translated text')), el('span', 'preview-copy', t('Privacy-first translation')));
  canvas.append(source, translated);
  preview.append(heading, canvas);
  return preview;
}

function promptTestCard(ctx) {
  const { settings } = ctx;
  const primary = settings.providers.profiles.find((profile) => profile.role === 'primary') ?? settings.providers.profiles[0];
  if (testBatchSize === null) testBatchSize = Math.max(1, Math.min(32, Number(primary?.batchSize) || 8));
  if (testTextValue === null) testTextValue = DEFAULT_TEST_TEXT;
  const controls = controlGrid(
    'two',
    field('Batch size', numberInput(testBatchSize, (value) => {
      testBatchSize = Math.max(1, Math.min(32, Math.floor(Number(value) || 1)));
    }, { min: '1', max: '32', step: '1' }), 'Test-only batch size. The primary provider and current unsaved settings are used; no cache is written. Batch uses the first N non-empty lines; single uses the first line.'),
    (() => {
      const node = el('div', 'inline-actions prompt-test-actions');
      node.append(button('Test batch', 'secondary'), button('Test single', 'secondary'));
      return node;
    })()
  );
  const textAreaNode = textArea(testTextValue, (value) => { testTextValue = value; }, { rows: '8', spellcheck: 'false' });
  const status = el('div', 'prompt-test-status', t('Ready to test.'));
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const results = el('div', 'prompt-test-results');
  const [batchButton, singleButton] = controls.querySelectorAll('button');
  const setBusy = (busy) => {
    batchButton.disabled = busy;
    singleButton.disabled = busy;
  };
  const run = async (mode) => {
    const texts = textAreaNode.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!texts.length) {
      status.textContent = t('Test failed: {error}', { error: t('Source text is required.') });
      status.className = 'prompt-test-status is-error';
      return;
    }
    setBusy(true);
    results.replaceChildren();
    status.className = 'prompt-test-status is-busy';
    status.textContent = mode === 'batch' ? t('Testing batch…') : t('Testing single…');
    try {
      const response = await sendRuntimeMessage({
        type: 'translation-prompt-test-request',
        settings: structuredClone(settings),
        mode,
        texts,
        batchSize: testBatchSize,
        sourceLang: null
      });
      if (!response?.ok) throw new Error(response?.error || t('unknown'));
      const rows = Array.isArray(response.rows) ? response.rows : [];
      status.className = 'prompt-test-status is-success';
      status.textContent = t('Test passed · {provider} · {duration} ms · {count}/{requested} segments', {
        provider: response.profileName || response.profileId || t('unknown'),
        duration: response.durationMs ?? '—',
        count: rows.length,
        requested: response.requestedBatchSize ?? rows.length
      });
      for (const row of rows) {
        const item = el('article', 'prompt-test-result');
        const heading = el('div', 'prompt-test-result-heading');
        heading.append(el('strong', '', `#${Number(row.index) + 1}`), el('span', 'badge', t('Translated text')));
        const source = el('div', 'prompt-test-result-copy');
        source.append(el('span', 'preview-caption', t('Source text')), el('span', '', String(row.source ?? '')));
        const translation = el('div', 'prompt-test-result-copy is-translation');
        translation.append(el('span', 'preview-caption', t('Translated text')), el('span', '', String(row.translation ?? '')));
        item.append(heading, source, translation);
        results.append(item);
      }
    } catch (error) {
      status.className = 'prompt-test-status is-error';
      status.textContent = t('Test failed: {error}', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };
  batchButton.addEventListener('click', () => run('batch'));
  singleButton.addEventListener('click', () => run('single'));
  return card(
    'Prompt test',
    'Test-only batch size. The primary provider and current unsaved settings are used; no cache is written. Batch uses the first N non-empty lines; single uses the first line.',
    controls,
    field('Source text', textAreaNode),
    status,
    results
  );
}

function glossaryCard(ctx) {
  const { settings, markDirty, render } = ctx;
  const actions = el('div', 'inline-actions');
  actions.append(button('Add term', 'secondary', () => { settings.translation.glossary.push({ source: '', replacement: '' }); markDirty(); render(); }));
  const wrap = el('div', 'table-wrap');
  const table = el('table');
  const head = el('thead'); const row = el('tr');
  ['Term on the page', 'Translation / empty = never translate', ''].forEach((label) => row.append(el('th', '', t(label))));
  head.append(row); table.append(head);
  const body = el('tbody');
  for (const entry of settings.translation.glossary) {
    const tr = el('tr');
    const term = el('td'); term.append(textInput(entry.source, (value) => { entry.source = value; markDirty(); }));
    const replacement = el('td'); replacement.append(textInput(entry.replacement ?? '', (value) => { entry.replacement = value || null; markDirty(); }));
    const action = el('td'); action.append(button('Remove', 'danger', () => { settings.translation.glossary = settings.translation.glossary.filter((item) => item !== entry); markDirty(); render(); }));
    tr.append(term, replacement, action); body.append(tr);
  }
  table.append(body); wrap.append(table);
  if (!settings.translation.glossary.length) wrap.append(el('div', 'empty', t('No glossary entries yet.')));
  return card('Glossary', 'Terms are always translated your way; an empty replacement makes them never translate.', actions, wrap);
}
