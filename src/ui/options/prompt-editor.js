import { t } from '../../shared/i18n.js';
import {
  DEFAULT_PROMPT_TEMPLATES,
  MODE_PROMPT_PARAMETERS,
  validatePromptTemplate
} from '../../shared/prompt.js';
import { button, card, el, field, textArea } from './ui-utils.js';

const REQUIRED_PARAMETERS = Object.freeze(['target_lang', 'source_text']);
const OPTIONAL_PARAMETERS = Object.freeze(['source_lang', 'batch_token', 'tone', 'glossary_json', 'custom_instructions']);
const PARAMETER_ORDER = Object.freeze([...REQUIRED_PARAMETERS, ...OPTIONAL_PARAMETERS]);

const MODE_COPY = Object.freeze({
  batch: {
    tab: 'Batch / page prompt',
    field: 'Batch / page prompt template',
    explanation: 'Used for page, iframe and large-text batch translation. Each block begins with a unique marker so translations can be matched back to the correct DOM node without JSON parsing.',
    returnTitle: 'Expected batch return',
    returnDescription: '{source_text} contains marker-delimited blocks. The model must copy each marker line exactly and return only its translated text.',
    returnNote: 'Every marker must appear exactly once. Do not add commentary, labels, JSON or Markdown fences.',
    example: '⟦LBT:A1B2C3D4:1⟧\nTranslated text'
  },
  single: {
    tab: 'Single text prompt',
    field: 'Single text prompt template',
    explanation: 'Used for translating one selected passage or one text segment. The model receives plain text and returns only its translation, with no markers or JSON wrapper.',
    returnTitle: 'Expected single return',
    returnDescription: '{source_text} is one plain string. The model must return only the translated text.',
    returnNote: 'Return no JSON, labels, explanations, quotes or Markdown fences. Marker and index requirements do not apply to this mode.',
    example: 'Translated text'
  }
});

let editorSequence = 0;
let activeMode = 'batch';

function parameterInfo(name, mode) {
  const parameter = MODE_PROMPT_PARAMETERS[mode][name];
  return {
    name,
    required: Boolean(parameter.required),
    label: parameter.label,
    description: parameter.description
  };
}

export function promptEditor(ctx) {
  const { settings, markDirty } = ctx;
  const translation = settings.translation;
  if (!translation.promptTemplates || typeof translation.promptTemplates !== 'object') {
    translation.promptTemplates = { ...DEFAULT_PROMPT_TEMPLATES };
  }
  for (const mode of ['batch', 'single']) {
    if (typeof translation.promptTemplates[mode] !== 'string' || !translation.promptTemplates[mode].trim()) {
      translation.promptTemplates[mode] = DEFAULT_PROMPT_TEMPLATES[mode];
    }
  }

  const editorId = `translation-prompt-${++editorSequence}`;
  const tabs = el('div', 'prompt-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', t('Prompt mode'));
  const panels = new Map();
  const tabButtons = new Map();

  for (const mode of ['batch', 'single']) {
    const tab = button(MODE_COPY[mode].tab, 'prompt-tab');
    tab.id = `${editorId}-${mode}-tab`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${editorId}-${mode}-panel`);
    tab.addEventListener('click', () => activate(mode, false));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      activate(mode === 'batch' ? 'single' : 'batch', true);
    });
    tabButtons.set(mode, tab);
    tabs.append(tab);

    const panel = createModePanel({
      mode,
      translation,
      markDirty,
      id: `${editorId}-${mode}-panel`,
      tabId: tab.id
    });
    panel.hidden = mode !== activeMode;
    panels.set(mode, panel);
  }

  function activate(mode, focusTab) {
    activeMode = mode;
    for (const [name, tab] of tabButtons) {
      const selected = name === mode;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels.get(name).hidden = !selected;
    }
    if (focusTab) tabButtons.get(mode).focus();
  }

  activate(activeMode, false);
  const editor = el('div', 'prompt-editor');
  editor.append(tabs, ...panels.values());
  return card(
    'Translation prompt',
    'Choose the prompt used for batch/page translation or single-text translation. Parameters are replaced with request data before the provider is called.',
    editor
  );
}

function createModePanel({ mode, translation, markDirty, id, tabId }) {
  const copy = MODE_COPY[mode];
  const validationId = `${id}-validation`;
  const infoId = `${id}-format`;
  const panel = el('section', 'prompt-panel');
  panel.id = id;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', tabId);

  const info = el('aside', 'prompt-format-info');
  info.id = infoId;
  const preview = el('pre', 'prompt-format-preview');
  preview.append(el('code', '', mode === 'single' ? t(copy.example) : copy.example));
  info.append(
    el('h3', '', t(copy.returnTitle)),
    el('p', '', t(copy.returnDescription, { source_text: '{source_text}' })),
    el('span', 'prompt-format-label', t('Example output')),
    preview,
    el('p', 'hint', t(copy.returnNote))
  );

  const textarea = textArea(translation.promptTemplates[mode], (value) => {
    translation.promptTemplates[mode] = value;
    markDirty();
    updateValidation(value);
  }, {
    id: `${id}-textarea`,
    rows: '12',
    spellcheck: 'false',
    'aria-describedby': `${validationId} ${infoId}`
  });
  textarea.className = 'prompt-textarea';

  const parameterList = el('ul', 'prompt-parameters');
  for (const name of PARAMETER_ORDER) {
    if (!MODE_PROMPT_PARAMETERS[mode][name]) continue;
    const parameter = parameterInfo(name, mode);
    const item = el('li', 'prompt-parameter');
    const identity = el('span');
    identity.append(el('code', '', `{${name}}`));
    identity.append(el('span', parameter.required ? 'prompt-required' : 'muted', t(parameter.required ? 'Required' : 'Optional')));
    const description = el('span', 'prompt-parameter-copy');
    description.append(el('strong', '', t(parameter.label)), document.createTextNode(` — ${t(parameter.description)}`));
    item.append(identity, description);
    parameterList.append(item);
  }

  const validation = el('p', 'prompt-validation');
  validation.id = validationId;
  validation.setAttribute('role', 'status');
  validation.setAttribute('aria-live', 'polite');
  validation.setAttribute('aria-atomic', 'true');

  const actions = el('div', 'prompt-editor-actions');
  actions.append(button('Reset to default', 'secondary', () => {
    translation.promptTemplates[mode] = DEFAULT_PROMPT_TEMPLATES[mode];
    textarea.value = DEFAULT_PROMPT_TEMPLATES[mode];
    markDirty();
    updateValidation(DEFAULT_PROMPT_TEMPLATES[mode]);
    textarea.focus();
  }));

  function updateValidation(template) {
    const result = validatePromptTemplate(template, mode);
    const messages = [];
    if (result.missing.length) {
      messages.push(t('Missing required parameters: {parameters}', {
        parameters: result.missing.map((name) => `{${name}}`).join(', ')
      }));
    }
    if (result.unknown.length) {
      messages.push(t('Unknown parameters: {parameters}', {
        parameters: result.unknown.map((name) => `{${name}}`).join(', ')
      }));
    }
    validation.textContent = messages.length
      ? messages.join(' ')
      : t('Template is valid. All required parameters are present.');
    validation.className = result.valid ? 'prompt-validation is-valid' : 'prompt-validation is-invalid';
    textarea.setAttribute('aria-invalid', String(!result.valid));
  }

  const templateField = field(
    copy.field,
    textarea,
    'This template controls the instructions and payload sent to the language model. Keep the required placeholders so every request remains valid.'
  );
  templateField.append(validation);
  const workbench = el('div', 'prompt-workbench');
  workbench.append(templateField, info);
  const parameterHeading = el('div', 'prompt-section-heading');
  parameterHeading.append(
    el('h3', '', t('Parameters for this mode')),
    el('p', 'hint', t('Insert parameters exactly as shown. Required parameters must appear at least once. Optional parameters can be removed when the model does not need that context.'))
  );
  const parameterDisclosure = el('details', 'advanced prompt-parameters-details');
  const parameterBody = el('div', 'prompt-advanced-body');
  parameterBody.append(parameterHeading, parameterList);
  parameterDisclosure.append(el('summary', '', t('Parameters for this mode')), parameterBody);
  panel.append(
    el('p', 'prompt-mode-explanation', t(copy.explanation)),
    workbench,
    actions,
    parameterDisclosure
  );
  updateValidation(translation.promptTemplates[mode]);
  return panel;
}