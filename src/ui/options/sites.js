import { onPermissionsAdded, onPermissionsRemoved } from '../../shared/browser.js';
import { ALL_URLS, hasAllSitesPermission, requestAllSitesPermission } from '../../background/site-permissions.js';
import { SITE_POLICIES } from '../../shared/settings.js';
import { t } from '../../shared/i18n.js';
import { normalizeDomain } from '../../shared/urls.js';
import { button, card, check, controlGrid, el, field, selectInput, textInput } from './ui-utils.js';

const POLICY_LABELS = Object.freeze({ auto: 'Automatic on allowed sites', ask: 'Ask me', never: 'Never automatically' });
let refreshActivePermissionCard = null;
let permissionSettings = null;

function handlePermissionChange(permissions, granted) {
  if (!(permissions?.origins ?? []).includes(ALL_URLS)) return;
  if (permissionSettings?.behaviour) permissionSettings.behaviour.allSitesEnabled = granted;
  refreshActivePermissionCard?.();
}

onPermissionsAdded((permissions) => handlePermissionChange(permissions, true));
onPermissionsRemoved((permissions) => handlePermissionChange(permissions, false));

export function renderSites(ctx) {
  const { settings, content, markDirty, render } = ctx;
  permissionSettings = settings;
  const permissionPanel = allSitesPermissionPanel(settings);
  refreshActivePermissionCard = permissionPanel.refresh;
  content.append(permissionPanel.node);

  const global = controlGrid(
    'two',
    field('Default policy', selectInput(settings.behaviour.autoTranslateDefault, [
      { value: 'ask', label: 'Ask me' },
      { value: 'auto', label: 'Automatic on allowed sites' },
      { value: 'never', label: 'Never automatically' }
    ], (value) => { settings.behaviour.autoTranslateDefault = value; markDirty(); }), 'Permission grants access; policy decides whether translation starts automatically.')
  );
  content.append(card('Global behavior', 'Permission grants access; policy decides whether translation starts automatically.', global));

  const actions = el('div', 'inline-actions');
  actions.append(button('Add site rule', 'secondary', () => {
    settings.behaviour.siteRules.push({ domain: '', url: null, policy: 'ask', targetLang: null, profileId: null, neverSend: false });
    markDirty(); render();
  }));
  content.append(card('Per-site rules', 'More specific rules override the global policy for matching domains and subdomains.', actions, siteRulesTable(ctx)));
  void permissionPanel.refresh({ showChecking: true });
}

function allSitesPermissionPanel(settings) {
  const notice = el('div', 'notice permission-status');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  const copy = el('div', 'permission-status-copy');
  const heading = el('div', 'permission-status-heading');
  const badge = el('span', 'badge warn', t('Checking…'));
  const detail = el('p', 'hint', t('Allow access to all websites once. Nothing is read or changed until you allow it.'));
  heading.append(badge);
  copy.append(heading, detail);

  const allowButton = button('Checking…', 'primary');
  allowButton.disabled = true;
  notice.append(copy, allowButton);
  const node = card('Site access required', null, notice);
  const cardTitle = node.querySelector('.card-heading h2');

  const setChecking = () => {
    notice.classList.remove('warn');
    badge.className = 'badge';
    badge.textContent = t('Checking…');
    allowButton.disabled = true;
    allowButton.textContent = t('Checking…');
  };

  const setGranted = (granted) => {
    notice.classList.toggle('warn', !granted);
    badge.className = granted ? 'badge' : 'badge warn';
    badge.textContent = granted ? t('All sites allowed') : t('Required');
    if (cardTitle) cardTitle.textContent = t(granted ? 'All sites allowed' : 'Site access required');
    allowButton.disabled = granted;
    allowButton.textContent = granted ? t('Enabled') : t('Allow all sites');
    detail.textContent = t('Allow access to all websites once. Nothing is read or changed until you allow it.');
    settings.behaviour.allSitesEnabled = granted;
  };

  async function refresh({ showChecking = false } = {}) {
    if (!node.isConnected) return;
    if (showChecking) setChecking();
    const granted = await hasAllSitesPermission();
    if (!node.isConnected) return;
    setGranted(granted);
  }

  allowButton.addEventListener('click', async () => {
    if (allowButton.disabled) return;
    notice.classList.remove('warn');
    badge.className = 'badge';
    badge.textContent = t('Requesting…');
    allowButton.disabled = true;
    allowButton.textContent = t('Requesting…');
    const granted = await requestAllSitesPermission();
    if (!node.isConnected) return;
    await refresh();
    if (!granted && node.isConnected) {
      notice.classList.add('warn');
      badge.className = 'badge error';
      badge.textContent = t('Required');
      detail.textContent = t('Site permission was not granted.');
      allowButton.disabled = false;
      allowButton.textContent = t('Allow all sites');
    }
  });

  return { node, refresh };
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
