import { getManifest, sendRuntimeMessage } from '../../shared/browser.js';
import { t } from '../../shared/i18n.js';
import { normalizeSettings } from '../../shared/settings.js';
import { button, card, controlGrid, downloadFile, el, field, numberInput, redact, selectInput } from './ui-utils.js';

const LEVEL_OPTIONS = [
  { value: 'debug', label: 'Debug', raw: true },
  { value: 'info', label: 'Info', raw: true },
  { value: 'warn', label: 'Warning', raw: true },
  { value: 'error', label: 'Error', raw: true }
];

function errorLogList(errors) {
  const list = el('div', 'error-log-list');
  if (!Array.isArray(errors) || !errors.length) {
    list.append(el('p', 'hint', t('No errors recorded in the selected retention window.')));
    return list;
  }
  for (const entry of [...errors].reverse()) {
    const item = el('article', 'error-log-item');
    const head = el('div', 'error-log-head');
    const meta = el('div', 'error-log-meta');
    meta.append(
      el('strong', '', `${String(entry.level || 'error').toUpperCase()} · ${entry.source || 'unknown'}`),
      el('span', 'error-log-time', new Date(Number(entry.timestamp) || Date.now()).toLocaleString())
    );
    if (Number(entry.count) > 1) meta.append(el('span', 'error-log-count', `×${entry.count}`));
    head.append(meta);
    item.append(head);
    item.append(el('p', 'error-log-message', entry.message || 'Unknown error'));
    if (entry.url) item.append(el('p', 'error-log-url', entry.url));
    if (entry.details) item.append(el('pre', 'error-log-details', entry.details));
    if (entry.stack) {
      const details = el('details');
      details.append(el('summary', '', t('Stack trace')), el('pre', 'error-log-stack', entry.stack));
      item.append(details);
    }
    list.append(item);
  }
  return list;
}

export async function renderDiagnostics(ctx) {
  const { settings, content, markDirty, render } = ctx;
  content.replaceChildren();

  let data = null;
  try {
    const response = await sendRuntimeMessage({ type: 'diagnostics-request' });
    data = response?.diagnostics ?? response;
  } catch (error) {
    data = { error: error instanceof Error ? error.message : String(error) };
  }

  const errors = Array.isArray(data?.errorLog) ? data.errorLog : [];
  const logActions = el('div', 'inline-actions');
  logActions.append(
    button('Refresh diagnostics', 'secondary', () => { render(); }),
    button('Download error log', 'secondary', () => {
      downloadFile('lbt-errors.json', JSON.stringify({ meta: { generatedAt: new Date().toISOString(), appVersion: getManifest().version }, errors }, null, 2), 'application/json');
    }),
    button('Clear error log', 'danger', async () => {
      await sendRuntimeMessage({ type: 'error-log-clear-request' });
      render();
    })
  );
  const logControls = controlGrid(
    'two',
    field('Error level', selectInput(settings.diagnostics.errorLogLevel, LEVEL_OPTIONS, (value) => {
      settings.diagnostics.errorLogLevel = value;
      markDirty();
    })),
    field('Retention days', numberInput(settings.diagnostics.errorRetentionDays, (value) => {
      settings.diagnostics.errorRetentionDays = value ?? 7;
      markDirty();
    }, { min: '1', max: '90', step: '1' }))
  );
  content.append(card(
    'Error log',
    'Client and background errors are stored locally and pruned automatically.',
    logActions,
    logControls,
    errorLogList(errors)
  ));

  const dump = el('div', 'code', JSON.stringify(redact(data), null, 2));
  content.append(card('Diagnostics', 'Live run data from the background worker. Empty panels mean no data has been logged yet.', dump));

  const report = el('textarea');
  report.readOnly = true;
  report.rows = 12;
  report.setAttribute('aria-label', t('Bug report'));
  const reportActions = el('div', 'inline-actions');
  const generate = () => JSON.stringify({ meta: { generatedAt: new Date().toISOString(), appVersion: getManifest().version }, diagnostics: redact(data) }, null, 2);
  reportActions.append(
    button('Generate redacted report', 'secondary', () => { report.value = generate(); }),
    button('Copy report', 'secondary', async () => { try { await navigator.clipboard.writeText(report.value || generate()); } catch { /* noop */ } })
  );
  content.append(card('Bug report', 'Credential-shaped fields and strings are redacted before the report is produced.', reportActions, report));

  const includeKeys = el('input');
  includeKeys.type = 'checkbox';
  const includeLabel = el('label', 'check');
  includeLabel.append(includeKeys, el('span', '', t('Include API keys when exporting settings')));
  const transferActions = el('div', 'inline-actions');
  transferActions.append(button('Export settings', 'secondary', () => {
    const copy = structuredClone(settings);
    if (!includeKeys.checked) for (const profile of copy.providers.profiles) profile.apiKey = null;
    downloadFile('lbt-settings.json', JSON.stringify(copy, null, 2), 'application/json');
  }));
  const importFile = el('input');
  importFile.type = 'file';
  importFile.accept = '.json,application/json';
  importFile.setAttribute('aria-label', t('Import settings'));
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const imported = normalizeSettings(JSON.parse(await file.text()));
      ctx.replaceSettings(imported);
      markDirty();
      render();
    } catch (error) {
      alert(t('Import failed: {error}', { error: error instanceof Error ? error.message : String(error) }));
    }
  });
  transferActions.append(importFile);
  const transferToggle = el('div', 'toggle-grid');
  transferToggle.append(includeLabel);
  content.append(card('Settings transfer', 'Exported files are plain JSON. Keys are excluded unless you opt in.', transferActions, transferToggle));

  const danger = el('div', 'inline-actions');
  danger.append(button('Reset everything…', 'danger', async () => {
    if (!confirm(t('Permanently delete all settings, translation memory, page snapshots, capability records and run state? Host permissions are kept.'))) return;
    const result = await sendRuntimeMessage({ type: 'hard-reset-request' });
    dump.textContent = result?.ok
      ? t('Reset complete. The extension is reloading…')
      : t('Reset failed: {error}', { error: result?.error ?? t('unknown') });
  }));
  content.append(card('Danger zone', 'There is no undo. Host-site permissions are not revoked by this action.', danger));
}
