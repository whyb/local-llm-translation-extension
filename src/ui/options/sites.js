import { SITE_POLICIES } from '../../shared/settings.js';
import { t } from '../../shared/i18n.js';
import { normalizeDomain } from '../../shared/urls.js';
import { button, card, check, controlGrid, el, field, selectInput, textInput } from './ui-utils.js';

const POLICY_LABELS = Object.freeze({ auto: 'Automatic on allowed sites', ask: 'Ask me', never: 'Never automatically' });

export function renderSites(ctx) {
  const { settings, content, markDirty, render } = ctx;
  const global = controlGrid(
    'two',
    field('Default policy', selectInput(settings.behaviour.autoTranslateDefault, [
      { value: 'ask', label: 'Ask me' },
      { value: 'auto', label: 'Automatic on allowed sites' },
      { value: 'never', label: 'Never automatically' }
    ], (value) => { settings.behaviour.autoTranslateDefault = value; markDirty(); }), 'Permission grants access; policy decides whether translation starts automatically.')
  );
  content.append(card('Global behavior', 'All-sites access is requested once from the toolbar popup. This policy decides whether translation starts automatically.', global));

  const actions = el('div', 'inline-actions');
  actions.append(button('Add site rule', 'secondary', () => {
    settings.behaviour.siteRules.push({ domain: '', url: null, policy: 'ask', targetLang: null, profileId: null, neverSend: false });
    markDirty(); render();
  }));
  content.append(card('Per-site rules', 'More specific rules override the global policy for matching domains and subdomains.', actions, siteRulesTable(ctx)));
}

function siteRulesTable(ctx) {
  const { settings, markDirty, render } = ctx;
  const wrap = el('div', 'table-wrap');
  const table = el('table');
  const head = el('thead'); const row = el('tr');
  ['Domain', 'Policy', 'Target language', 'Provider', 'Never send', ''].forEach((label) => row.append(el('th', '', t(label))));
  head.append(row); table.append(head);
  const body = el('tbody');
  for (const rule of settings.behaviour.siteRules) {
    const tr = el('tr');
    const domain = el('td'); domain.append(textInput(rule.domain, (value) => { rule.domain = normalizeDomain(value); markDirty(); }));
    const policy = el('td'); policy.append(selectInput(rule.policy ?? '', [{ value: '', label: 'Global' }, ...SITE_POLICIES.map((value) => ({ value, label: POLICY_LABELS[value] ?? value }))], (value) => { rule.policy = value || null; rule.neverSend = value === 'never'; markDirty(); }));
    const lang = el('td'); lang.append(textInput(rule.targetLang ?? '', (value) => { rule.targetLang = value || null; markDirty(); }));
    const profile = el('td'); profile.append(selectInput(rule.profileId ?? '', [{ value: '', label: 'Default' }, ...settings.providers.profiles.map((item) => ({ value: item.id, label: item.name, raw: true }))], (value) => { rule.profileId = value || null; markDirty(); }));
    const never = el('td'); never.append(check('', rule.neverSend, (value) => { rule.neverSend = value; markDirty(); }));
    const action = el('td'); action.append(button('Remove', 'danger', () => { settings.behaviour.siteRules = settings.behaviour.siteRules.filter((item) => item !== rule); markDirty(); render(); }));
    tr.append(domain, policy, lang, profile, never, action); body.append(tr);
  }
  table.append(body); wrap.append(table);
  if (!settings.behaviour.siteRules.length) wrap.append(el('div', 'empty', t('No per-site rules. Global behavior applies.')));
  return wrap;
}
