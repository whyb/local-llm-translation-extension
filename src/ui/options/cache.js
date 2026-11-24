import { sendRuntimeMessage } from '../../shared/browser.js';
import { t } from '../../shared/i18n.js';
import {
  button, card, check, controlGrid, downloadFile, el, field, formSection, numberInput, selectInput, textArea, textInput
} from './ui-utils.js';

export function renderCache(ctx) {
  const { settings, content, markDirty, render } = ctx;
  const cache = settings.cache;
  const checks = el('div', 'toggle-grid');
  checks.append(
    check('Enable translation memory', cache.enabled, (value) => { cache.enabled = value; markDirty(); }),
    check('Normalized matching', cache.normalizedMatching, (value) => { cache.normalizedMatching = value; markDirty(); }),
    check('Reuse across sites', cache.crossSiteReuse, (value) => { cache.crossSiteReuse = value; markDirty(); }),
    check('Keep URL fragments', !cache.urlNormalisation.stripFragment, (value) => { cache.urlNormalisation.stripFragment = !value; markDirty(); })
  );
  const sizing = controlGrid(
    'three',
    field('Disk cap (MiB)', numberInput(Math.round(cache.diskCapBytes / 1048576), (value) => { cache.diskCapBytes = Math.max(1, value ?? 256) * 1048576; markDirty(); }, { min: '1', step: '1' }), 'Maximum on-disk translation-memory size.'),
    field('Hot-tier watermark', numberInput(cache.hotTierWatermarkEntries, (value) => { cache.hotTierWatermarkEntries = value ?? 20000; markDirty(); }, { min: '0', step: '1' }), 'Entries kept in the fast access tier.'),
    field('TTL (hours)', numberInput(cache.ttlMs === null ? '' : Math.round(cache.ttlMs / 3600000), (value) => { cache.ttlMs = value === null ? null : Math.max(0, value) * 3600000; markDirty(); }, { min: '0', step: '1' }), 'Leave empty for no expiry.')
  );
  content.append(card('Memory', 'TM stores source text, translations, domains and model identity. Use TTL and purge controls for privacy.', checks, sizing));

  const invalidation = el('div', 'toggle-grid');
  for (const [key, label] of Object.entries({ promptVersion: 'Prompt version changes', modelChange: 'Model changes', targetLangChange: 'Target language changes', glossaryChange: 'Glossary changes' })) {
    invalidation.append(check(label, cache.invalidateOn[key], (value) => { cache.invalidateOn[key] = value; markDirty(); }));
  }
  const normalization = el('details', 'advanced');
  normalization.append(el('summary', '', t('URL normalization')));
  const normalizationBody = formSection(
    'URL normalization',
    'One tracking parameter per line. Supports a trailing * wildcard.',
    textArea(cache.urlNormalisation.stripParams.join('\n'), (value) => { cache.urlNormalisation.stripParams = value.split(/\s+/).filter(Boolean); markDirty(); }, { rows: '5', spellcheck: 'false' })
  );
  normalization.append(normalizationBody);
  content.append(card('Invalidate when…', 'Choose which changes must create a new cache key.', invalidation, normalization));
  content.append(domainOverridesCard(ctx));

  const stats = el('div', 'code', t('Loading cache stats…'));
  const domain = textInput('', () => {}, 'text', { placeholder: 'example.com' });
  const format = selectInput('jsonl', [{ value: 'jsonl', label: 'JSONL' }, { value: 'json', label: 'JSON' }], () => {});
  const maintenance = el('div', 'card-toolbar');
  const exportActions = el('div', 'inline-actions');
  exportActions.append(
    button('Refresh stats', 'secondary', () => loadStats(stats)),
    button('Export TM', 'secondary', () => exportTm(format.value)),
    format
  );
  const importFile = el('input'); importFile.type = 'file'; importFile.accept = '.json,.jsonl,application/json';
  importFile.setAttribute('aria-label', t('Import TM'));
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0]; if (!file) return;
    const result = await sendRuntimeMessage({ type: 'tm-import-request', raw: await file.text() });
    stats.textContent = result?.ok
      ? t('Imported {total} records: {added} new, {updated} updated, {unchanged} unchanged, {skipped} skipped.', {
        total: result.total,
        added: result.added,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: result.skipped
      })
      : t('Import failed: {error}', { error: result?.error ?? t('unknown') });
    importFile.value = '';
  });
  exportActions.append(importFile);
  maintenance.append(exportActions);
  const purgeDomainActions = el('div', 'inline-actions');
  purgeDomainActions.append(button('Purge domain', 'danger', async () => {
    await sendRuntimeMessage({ type: 'cache-forget-request', domain: domain.value.trim() });
    await loadStats(stats);
  }));
  const destructive = controlGrid('two', field('Domain', domain), purgeDomainActions);
  destructive.append(button('Purge all cache', 'danger', async () => {
    await sendRuntimeMessage({ type: 'cache-purge-request' });
    await loadStats(stats);
  }));
  content.append(card('TM tools', 'Export, import, refresh or selectively remove stored translations.', maintenance, destructive, stats));
  loadStats(stats);
}

async function loadStats(node) {
  try {
    const result = await sendRuntimeMessage({ type: 'cache-stats-request' });
    node.textContent = JSON.stringify(result?.stats ?? { error: result?.error ?? t('unavailable') }, null, 2);
  } catch (error) {
    node.textContent = t('Stats unavailable: {error}', { error: error instanceof Error ? error.message : String(error) });
  }
}

async function exportTm(format) {
  try {
    const result = await sendRuntimeMessage({ type: 'tm-export-request', format });
    if (!result?.ok) throw new Error(result?.error || t('Export failed'));
    downloadFile(`lbt-tm-export.${format}`, result.payload, format === 'jsonl' ? 'application/x-ndjson' : 'application/json');
  } catch (error) {
    alert(t('TM export failed: {error}', { error: error instanceof Error ? error.message : String(error) }));
  }
}

function domainOverridesCard(ctx) {
  const { settings, markDirty, render } = ctx;
  const overrides = settings.cache.urlNormalisation.domainOverrides;
  const actions = el('div', 'inline-actions');
  actions.append(button('Add URL override', 'secondary', () => { overrides.push({ domain: '', keepParams: [], keepFragment: false }); markDirty(); render(); }));
  const wrap = el('div', 'table-wrap');
  const table = el('table'); const head = el('thead'); const row = el('tr');
  ['Domain', 'Keep params (comma separated)', 'Keep fragment', ''].forEach((label) => row.append(el('th', '', t(label))));
  head.append(row); table.append(head);
  const body = el('tbody');
  for (const override of overrides) {
    const tr = el('tr');
    const domain = el('td'); domain.append(textInput(override.domain, (value) => { override.domain = value; markDirty(); }));
    const params = el('td'); params.append(textInput(override.keepParams.join(', '), (value) => { override.keepParams = value.split(',').map((item) => item.trim()).filter(Boolean); markDirty(); }));
    const fragment = el('td'); fragment.append(check('', override.keepFragment, (value) => { override.keepFragment = value; markDirty(); }));
    const action = el('td'); action.append(button('Remove', 'danger', () => { settings.cache.urlNormalisation.domainOverrides = overrides.filter((item) => item !== override); markDirty(); render(); }));
    tr.append(domain, params, fragment, action); body.append(tr);
  }
  table.append(body); wrap.append(table);
  if (!overrides.length) wrap.append(el('div', 'empty', t('No URL overrides yet.')));
  return card('Per-domain URL overrides', 'Keep query parameters or fragments only for specific domains.', actions, wrap);
}
