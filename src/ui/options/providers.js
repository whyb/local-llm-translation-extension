import { sendRuntimeMessage } from '../../shared/browser.js';
import { t } from '../../shared/i18n.js';
import { ADAPTER_DEFAULT_BASE_URLS, ADAPTERS, DEFAULT_CONTEXT_LENGTH, ROLES, STRUCTURED_OUTPUT_MODES, createDefaultProfile } from '../../shared/settings.js';
import {
  button, card, check, controlGrid, el, field, formSection, numberInput, selectInput, textArea, textInput
} from './ui-utils.js';

const roleOptions = ROLES.map((role) => ({ value: role, label: role[0].toUpperCase() + role.slice(1) }));
const adapterOptions = ADAPTERS.map((adapter) => ({ value: adapter, label: adapter }));
const STRUCTURED_OUTPUT_LABELS = Object.freeze({
  auto: 'Automatic',
  json_schema: 'JSON schema',
  json_object: 'JSON object',
  'prompt-only': 'Prompt only'
});
const THINKING_MODE_LABELS = Object.freeze({ off: 'Off', default: 'Default', custom: 'Custom' });
const THINKING_EFFORT_LABELS = Object.freeze({ off: 'Off', low: 'Low', medium: 'Medium', high: 'High', max: 'Max' });

function cloneProfile(profile) {
  try { return structuredClone(profile); } catch { return JSON.parse(JSON.stringify(profile)); }
}

function selectedProfile(settings) {
  const profiles = settings.providers.profiles;
  return profiles.find((profile) => profile.id === settings.providers.selectedProfileId) ?? profiles[0] ?? null;
}

const ICON_PATHS = Object.freeze({
  test: [
    'M20 12a8 8 0 1 1-2.34-5.66',
    'M20 4v6h-6'
  ],
  edit: [
    'M4 20h4L20 8l-4-4L4 16v4z',
    'M13.5 6.5l4 4'
  ],
  delete: [
    'M4 7h16',
    'M9 7V4h6v3',
    'M7 7l1 13h8l1-13',
    'M10 11v5',
    'M14 11v5'
  ]
});

function iconSvg(paths) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const data of paths) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', data);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

function iconAction(label, iconName, className, onClick) {
  const node = button(label, `provider-action icon-action ${className}`.trim(), onClick);
  node.title = t(label);
  node.replaceChildren(iconSvg(ICON_PATHS[iconName]), el('span', 'visually-hidden', t(label)));
  return node;
}

function nextProfile(profiles) {
  let number = profiles.length + 1;
  while (profiles.some((profile) => profile.id === `profile-${number}`)) number += 1;
  const profile = createDefaultProfile(number - 1, profiles.length === 0 ? 'primary' : 'fallback');
  profile.id = `profile-${number}`;
  profile.name = `Provider ${number}`;
  return profile;
}

export function renderProviders(ctx) {
  const { settings, content, markDirty, render } = ctx;
  const profiles = settings.providers.profiles;
  const active = selectedProfile(settings);
  const actions = el('div', 'inline-actions');
  if (profiles.length) {
    actions.append(button('Add provider', 'primary', () => openProviderEditor(ctx, null)));
  }
  const list = el('div', 'provider-list');
  if (!profiles.length) {
    const empty = el('div', 'provider-empty');
    empty.append(
      el('strong', '', t('No providers configured')),
      el('p', 'hint', t('Connect one or more local or cloud model endpoints.')),
      button('Add provider', 'primary', () => openProviderEditor(ctx, null))
    );
    list.append(empty);
  } else {
    for (const profile of profiles) list.append(providerRow(ctx, profile, active?.id === profile.id));
  }
  content.append(card(
    'Provider profiles',
    'Choose the default provider for translation. If none is selected, the first provider is used.',
    actions,
    list
  ));

  const routing = controlGrid(
    'two',
    field('Auto-probe after save', selectInput(settings.providers.autoProbeOnSave ? 'yes' : 'no', [
      { value: 'yes', label: 'Yes — probe changed endpoints after Save' },
      { value: 'no', label: 'No — probe only when asked' }
    ], (value) => { settings.providers.autoProbeOnSave = value === 'yes'; markDirty(); }), 'Checks model availability and endpoint capabilities after settings are saved.'),
    field('Hard error threshold', numberInput(settings.providers.hardErrorThreshold, (value) => { settings.providers.hardErrorThreshold = value ?? 3; markDirty(); }, { min: '1', step: '1' }), 'Stops a translation run after this many consecutive hard failures.')
  );
  content.append(card('Routing', 'These options apply to every provider profile.', routing));
}

function providerRow(ctx, profile, selected) {
  const { settings, markDirty, render } = ctx;
  const row = el('article', `provider-row${selected ? ' is-selected' : ''}`);
  const choice = el('label', 'provider-choice');
  const radio = el('input'); radio.type = 'radio'; radio.name = 'selected-provider'; radio.checked = selected;
  radio.setAttribute('aria-label', t('Use this provider'));
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    settings.providers.selectedProfileId = profile.id;
    markDirty();
    await ctx.save(false);
    render();
  });
  choice.append(radio, el('span', 'provider-choice-mark'));
  const icon = el('span', 'provider-row-icon', String(profile.name || profile.adapter || 'P').slice(0, 1).toUpperCase());
  const copy = el('div', 'provider-row-copy');
  const title = el('div', 'provider-row-title');
  title.append(el('h3', '', profile.name), el('span', 'badge', profile.adapter));
  if (selected) title.append(el('span', 'badge provider-selected-badge', t('Selected')));
  const details = el('div', 'provider-row-subtitle');
  details.append(el('span', '', profile.model || t('No model selected')), el('span', 'provider-separator', '·'), el('span', '', profile.baseUrl));
  const status = el('div', 'provider-row-status', t('No test run yet.'));
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  copy.append(title, details, status);
  const actions = el('div', 'provider-row-actions');
  const testButton = iconAction('Test', 'test', 'secondary', () => testProfile(profile, status, testButton));
  actions.append(testButton);
  actions.append(iconAction('Edit', 'edit', 'secondary', () => openProviderEditor(ctx, profile)));
  actions.append(iconAction('Remove', 'delete', 'danger', async () => {
    if (!confirm(t('Delete provider "{name}"? This only removes the saved provider configuration.', { name: profile.name }))) return;
    settings.providers.profiles = settings.providers.profiles.filter((item) => item.id !== profile.id);
    if (settings.providers.selectedProfileId === profile.id) settings.providers.selectedProfileId = null;
    markDirty();
    await ctx.save(false);
    render();
  }));
  row.append(choice, icon, copy, actions);
  return row;
}

function openProviderEditor(ctx, existing) {
  const { settings, markDirty, render } = ctx;
  const isNew = !existing;
  const draft = cloneProfile(existing ?? nextProfile(settings.providers.profiles));
  const dialog = el('dialog', 'provider-dialog');
  dialog.setAttribute('aria-labelledby', 'provider-dialog-title');
  const form = el('form', 'provider-editor-form');
  const header = el('header', 'provider-dialog-header');
  header.append(el('h2', '', t(isNew ? 'Add provider' : 'Edit')));
  header.querySelector('h2').id = 'provider-dialog-title';
  const body = el('div', 'provider-dialog-body');
  const error = el('p', 'provider-dialog-error');
  error.setAttribute('role', 'alert');
  const footer = el('footer', 'provider-dialog-footer');
  const modelsStatus = el('small', 'hint model-list-status');
  const modelControlHost = el('div', 'model-control-host');
  let contextInput = null;
  let modelContextById = new Map();
  const applyContextLength = (value) => {
    const length = Number(value);
    if (!Number.isFinite(length) || length <= 0) return false;
    draft.contextLength = Math.floor(length);
    if (contextInput) contextInput.value = String(draft.contextLength);
    return true;
  };
  const contextSuffix = (value) => {
    const length = Number(value);
    return Number.isFinite(length) && length > 0 ? ` · ${t('Context length')}: ${Math.floor(length)}` : '';
  };
  const makeModelInput = (value) => {
    const input = textInput(value ?? '', (next) => { draft.model = next || null; }, 'text', { placeholder: 'Model id' });
    input.classList.add('model-id-input');
    return input;
  };
  let modelInput = makeModelInput(draft.model);
  modelControlHost.append(modelInput);
  const modelActions = el('div', 'model-picker-row');
  const fetchModels = button('Fetch models', 'secondary', async () => {
    fetchModels.disabled = true;
    modelsStatus.textContent = t('Refreshing models…');
    modelsStatus.title = modelsStatus.textContent;
    try {
      const result = await sendRuntimeMessage({
        type: 'refresh-models-request',
        profile: draft,
        timeoutMs: Math.min(Number(draft.timeoutMs) || 120000, 10000)
      });
      if (!result?.ok) throw new Error(result?.error || t('Model list unavailable'));
      const entries = (result.models ?? []).filter((model) => typeof model?.id === 'string' && model.id.trim());
      modelContextById = new Map(entries.map((model) => [model.id, Number(model.contextLength) || null]));
      const modelIds = [...new Set(entries.map((model) => model.id))];
      const selectedId = modelIds.includes(draft.model) ? draft.model : modelIds[0] ?? null;
      const detectedContextLength = Number(result.contextLength) > 0
        ? Math.floor(Number(result.contextLength))
        : modelContextById.get(selectedId) ?? null;
      applyContextLength(detectedContextLength);
      if (!modelIds.length) {
        modelsStatus.textContent = t('Models: {models}', { models: t('none returned') }) + contextSuffix(detectedContextLength);
        modelsStatus.title = modelsStatus.textContent;
        return;
      }
      if (modelIds.length === 1) {
        draft.model = modelIds[0];
        if (modelInput?.isConnected) modelInput.value = modelIds[0];
        else {
          modelInput = makeModelInput(modelIds[0]);
          modelControlHost.replaceChildren(modelInput);
        }
      } else {
        draft.model = selectedId;
        const modelSelect = selectInput(selectedId, modelIds.map((id) => ({ value: id, label: id, raw: true })), (value) => {
          draft.model = value;
          applyContextLength(modelContextById.get(value));
        });
        modelSelect.classList.add('model-id-select');
        modelControlHost.replaceChildren(modelSelect);
        modelInput = null;
      }
      const modelList = modelIds.join(', ');
      modelsStatus.textContent = t('Models: {models}', { models: modelList }) + contextSuffix(detectedContextLength);
      modelsStatus.title = modelsStatus.textContent;
    } catch (exception) {
      modelsStatus.textContent = t('Model refresh failed: {error}', { error: exception instanceof Error ? exception.message : String(exception) });
      modelsStatus.title = modelsStatus.textContent;
    } finally {
      fetchModels.disabled = false;
    }
  });
  modelActions.append(modelControlHost, fetchModels, modelsStatus);

  const resetModelControl = () => {
    if (!modelInput?.isConnected) {
      modelInput = makeModelInput(draft.model);
      modelControlHost.replaceChildren(modelInput);
    }
    modelsStatus.textContent = '';
    modelsStatus.title = '';
  };
  const baseUrlInput = textInput(draft.baseUrl, (value) => { draft.baseUrl = value; resetModelControl(); }, 'url', { placeholder: ADAPTER_DEFAULT_BASE_URLS[draft.adapter] || ADAPTER_DEFAULT_BASE_URLS.openai });
  baseUrlInput.addEventListener('input', resetModelControl);
  const baseUrlNote = el('small', 'field-hint');
  const updateBaseUrlNote = () => {
    const defaultUrl = ADAPTER_DEFAULT_BASE_URLS[draft.adapter] || ADAPTER_DEFAULT_BASE_URLS.openai;
    baseUrlNote.textContent = `${t('Default')}: ${defaultUrl}`;
    baseUrlInput.placeholder = defaultUrl;
  };
  const baseUrlField = field('Base URL', baseUrlInput, 'OpenAI-compatible root or provider-specific API root.');
  baseUrlField.append(baseUrlNote);
  updateBaseUrlNote();
  const adapterSelect = selectInput(draft.adapter, adapterOptions, (value) => {
    const previousDefault = ADAPTER_DEFAULT_BASE_URLS[draft.adapter];
    const currentBaseUrl = baseUrlInput.value.trim();
    draft.adapter = value;
    const nextDefault = ADAPTER_DEFAULT_BASE_URLS[value] || ADAPTER_DEFAULT_BASE_URLS.openai;
    if (!currentBaseUrl || currentBaseUrl === previousDefault) {
      draft.baseUrl = nextDefault;
      baseUrlInput.value = nextDefault;
    }
    resetModelControl();
    updateBaseUrlNote();
  });
  const modelField = field('Model id', modelActions, 'The exact model identifier sent to this provider.');
  modelField.classList.add('span-two');
  const connection = formSection(
    'Connection',
    'Identify the endpoint and the exact model that should answer translation requests.',
    controlGrid(
      'two',
      field('Profile name', textInput(draft.name, (value) => { draft.name = value; })),
      field('Role', selectInput(draft.role, roleOptions, (value) => { draft.role = value; })),
      field('Adapter', adapterSelect),
      baseUrlField,
      modelField,
      field('API key', textInput(draft.apiKey ?? '', (value) => { draft.apiKey = value || null; }, 'password', { autocomplete: 'off', spellcheck: 'false' }), 'Leave empty for local servers that do not require authentication.')
    ),
    el('small', 'key-warning', t('Warning: API keys are not encrypted at rest. Export omits them unless explicitly selected.'))
  );

  contextInput = numberInput(draft.contextLength, (value) => { draft.contextLength = value ?? DEFAULT_CONTEXT_LENGTH; }, { min: '1', step: '1' });
  const generation = formSection(
    'Generation',
    'Values that affect output size, batching and sampling behavior.',
    controlGrid(
      'three',
      field('Context length', contextInput),
      field('Max tokens per response', numberInput(draft.maxTokens, (value) => { draft.maxTokens = value; }, { min: '0', step: '1' })),
      field('Temperature', numberInput(draft.temperature, (value) => { draft.temperature = value; }, { min: '0', step: '0.1' })),
      field('Batch size', numberInput(draft.batchSize, (value) => { draft.batchSize = value ?? 8; }, { min: '1', step: '1' }), 'Page segments merged into one marker-delimited request.'),
      field('Max in-flight', numberInput(draft.maxInFlight, (value) => { draft.maxInFlight = value ?? 1; }, { min: '1', step: '1' })),
      check('Stream responses', draft.streaming, (value) => { draft.streaming = value; }, 'Show completed batches as soon as the provider returns them.')
    )
  );

  const thinking = formSection(
    'Thinking controls',
    'Thinking controls are provider-specific. Disable them when you want the shortest and most predictable translation responses.',
    controlGrid(
      'two',
      field('Thinking mode', selectInput(draft.reasoning?.mode ?? 'off', ['off', 'default', 'custom'].map((value) => ({ value, label: THINKING_MODE_LABELS[value] ?? value })), (value) => { draft.reasoning.mode = value; }), 'Off sends the most direct request. Custom uses the effort level below.'),
      field('Thinking effort', selectInput(draft.reasoning?.effort ?? '', [{ value: '', label: 'Not set' }, ...['off', 'low', 'medium', 'high', 'max'].map((value) => ({ value, label: THINKING_EFFORT_LABELS[value] ?? value }))], (value) => { draft.reasoning.effort = value || null; }), 'Used only when Thinking mode is set to Custom.')
    )
  );

  const reliability = formSection(
    'Reliability',
    'Timeouts and retry counts apply to each provider request.',
    controlGrid(
      'two',
      field('Timeout (ms)', numberInput(draft.timeoutMs, (value) => { draft.timeoutMs = value ?? 120000; }, { min: '1000', step: '1000' })),
      field('Retries', numberInput(draft.retries, (value) => { draft.retries = value ?? 0; }, { min: '0', step: '1' }))
    )
  );

  const requestOverrides = el('details', 'advanced');
  requestOverrides.append(el('summary', '', t('Request overrides')));
  requestOverrides.append(formSection(
    'Provider request overrides',
    'Leave these values unchanged unless the endpoint needs a provider-specific request body or format constraint.',
    controlGrid(
      'two',
      field('Structured output', selectInput(draft.structuredOutput ?? 'auto', STRUCTURED_OUTPUT_MODES.map((value) => ({ value, label: STRUCTURED_OUTPUT_LABELS[value] ?? value })), (value) => { draft.structuredOutput = value; }), 'Marker batch requests always use prompt-only output. This remains available for compatible custom templates and provider probes.'),
      field('Raw request JSON', textArea(draft.rawRequestJson ?? '', (value) => { draft.rawRequestJson = value || null; }, { rows: '4', spellcheck: 'false' }), 'Merged into the request body. Invalid JSON is ignored.')
    )
  ));

  let dialogClosing = false;
  const closeDialog = () => {
    if (dialogClosing) return;
    dialogClosing = true;
    try {
      if (dialog.open) dialog.close();
    } catch {
      // Edge can reject close() if the modal state changed while saving.
    }
    dialog.remove();
  };
  const cancel = button('Cancel', 'secondary', closeDialog);
  const save = button('Save changes', 'primary', async () => {
    error.textContent = '';
    if (!draft.name.trim()) { error.textContent = t('Profile name is required.'); return; }
    if (!draft.baseUrl.trim()) { error.textContent = t('Base URL is required.'); return; }
    save.disabled = true;
    cancel.disabled = true;
    const previousProfiles = cloneProfile(settings.providers.profiles);
    const previousSelectedId = settings.providers.selectedProfileId;
    const shouldProbe = settings.providers.autoProbeOnSave;
    try {
      if (isNew) settings.providers.profiles.push(draft);
      else settings.providers.profiles = settings.providers.profiles.map((profile) => profile.id === draft.id ? draft : profile);
      if (!settings.providers.selectedProfileId && settings.providers.profiles.length === 1) settings.providers.selectedProfileId = draft.id;
      markDirty();
      const saved = await ctx.save(false);
      if (!saved) {
        settings.providers.profiles = previousProfiles;
        settings.providers.selectedProfileId = previousSelectedId;
        throw new Error(t('Save failed: {error}', { error: t('unknown') }));
      }
      closeDialog();
      render();
      if (shouldProbe) {
        const probeProfile = cloneProfile(draft);
        // Probe after the UI has closed so an unreachable endpoint can never
        // make Save changes appear unresponsive.
        void Promise.resolve()
          .then(() => sendRuntimeMessage({ type: 'probe-profile-request', profile: probeProfile }))
          .catch(() => {});
      }
    } catch (exception) {
      error.textContent = exception instanceof Error ? exception.message : String(exception);
    } finally {
      save.disabled = false;
      cancel.disabled = false;
    }
  });
  footer.append(error, cancel, save);
  body.append(connection, generation, thinking, reliability, requestOverrides);
  form.append(header, body, footer);
  dialog.append(form);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  modelInput.focus();
}

async function testProfile(profile, status, testButton) {
  status.textContent = t('Testing endpoint…');
  status.className = 'provider-row-status is-busy';
  testButton.disabled = true;
  try {
    const result = await sendRuntimeMessage({ type: 'test-connection-request', profile });
    if (!result?.ok) throw new Error(result?.error || t('Connection failed'));
    const throughput = result.tokensPerSecond
      ? t('{rate} tok/s', { rate: Math.round(result.tokensPerSecond) })
      : t('tokens/sec unavailable');
    status.textContent = t('Connected · {latency} ms · {throughput}', { latency: result.latencyMs ?? '—', throughput });
    status.className = 'provider-row-status is-success';
  } catch (error) {
    status.textContent = t('Connection failed: {error}', { error: error instanceof Error ? error.message : String(error) });
    status.className = 'provider-row-status is-error';
  } finally {
    testButton.disabled = false;
  }
}



