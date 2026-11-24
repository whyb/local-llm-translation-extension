import { getManifest, sendRuntimeMessage } from '../../shared/browser.js';
import { t } from '../../shared/i18n.js';
import { normalizeSettings } from '../../shared/settings.js';
import { button, card, check, downloadFile, el, redact } from './ui-utils.js';

export async function renderDiagnostics(ctx) {
  const { settings, content, markDirty, render } = ctx;
  const actions = el('div', 'inline-actions');
  actions.append(button('Refresh diagnostics', 'secondary', async () => { await renderDiagnostics(ctx); }));
  const toggles = el('div', 'toggle-grid');
  toggles.append(
    check('Show performance HUD', settings.appearance.hudEnabled, (value) => { settings.appearance.hudEnabled = value; markDirty(); }),
    check('Verbose logging', settings.robustness.verboseLogging, (value) => { settings.robustness.verboseLogging = value; markDirty(); })
  );
  const dump = el('div', 'code', t('Loading diagnostics…'));
  content.append(card('Diagnostics', 'Live run data from the background worker. Empty panels mean no data has been logged yet.', actions, toggles, dump));

  let data = null;
  try {
    const response = await sendRuntimeMessage({ type: 'diagnostics-request' });
    data = response?.diagnostics ?? response;
  } catch (error) {
    data = { error: error instanceof Error ? error.message : String(error) };
  }
  dump.textContent = JSON.stringify(redact(data), null, 2);

  const report = el('textarea'); report.readOnly = true; report.rows = 12; report.setAttribute('aria-label', t('Bug report'));
  const reportActions = el('div', 'inline-actions');
  const generate = () => JSON.stringify({ meta: { generatedAt: new Date().toISOString(), appVersion: getManifest().version }, diagnostics: redact(data) }, null, 2);
  reportActions.append(
    button('Generate redacted report', 'secondary', () => { report.value = generate(); }),
    button('Copy report', 'secondary', async () => { try { await navigator.clipboard.writeText(report.value || generate()); } catch { /* noop */ } })
  );
  content.append(card('Bug report', 'Credential-shaped fields and strings are redacted before the report is produced.', reportActions, report));

  const includeKeys = el('input'); includeKeys.type = 'checkbox';
  const includeLabel = el('label', 'check'); includeLabel.append(includeKeys, el('span', '', t('Include API keys when exporting settings')));
  const transferActions = el('div', 'inline-actions');
  transferActions.append(button('Export settings', 'secondary', () => {
    const copy = structuredClone(settings);
    if (!includeKeys.checked) for (const profile of copy.providers.profiles) profile.apiKey = null;
    downloadFile('lbt-settings.json', JSON.stringify(copy, null, 2), 'application/json');
  }));
  const importFile = el('input'); importFile.type = 'file'; importFile.accept = '.json,application/json';
  importFile.setAttribute('aria-label', t('Import settings'));
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0]; if (!file) return;
    try {
      const imported = normalizeSettings(JSON.parse(await file.text()));
      ctx.replaceSettings(imported);
      markDirty(); render();
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
