import { t } from '../../shared/i18n.js';
import { card, check, el, button, formSection, textInput } from './ui-utils.js';

export function renderExclusions(ctx) {
  const { settings, content, markDirty, render } = ctx;
  const exclusions = settings.exclusions;
  const detection = el('div', 'toggle-grid');
  detection.append(
    check('Skip structural chrome', exclusions.structural, (value) => { exclusions.structural = value; markDirty(); }),
    check('Skip target-language segments', exclusions.perSegmentLanguage, (value) => { exclusions.perSegmentLanguage = value; markDirty(); }),
    check('Skip non-linguistic content', exclusions.nonLinguistic, (value) => { exclusions.nonLinguistic = value; markDirty(); }),
    check('Inherit page language', exclusions.language.inheritPageLanguage, (value) => { exclusions.language.inheritPageLanguage = value; markDirty(); })
  );
  const zones = el('div', 'toggle-grid');
  zones.append(
    check('Skip ads', exclusions.zones.ads, (value) => { exclusions.zones.ads = value; markDirty(); }),
    check('Skip cookie / consent banners', exclusions.zones.cookieBanners, (value) => { exclusions.zones.cookieBanners = value; markDirty(); }),
    check('Skip editable fields', exclusions.zones.editableFields, (value) => { exclusions.zones.editableFields = value; markDirty(); }),
    check('Skip third-party iframes', exclusions.zones.thirdPartyIframes, (value) => { exclusions.zones.thirdPartyIframes = value; markDirty(); }),
    check('Skip hidden content', exclusions.zones.hiddenContent, (value) => { exclusions.zones.hiddenContent = value; markDirty(); })
  );
  content.append(card(
    'Page zones',
    'Default behavior skips hidden text, editable content, cookie banners and password fields. Third-party iframe skipping is opt-in.',
    formSection('Text detection', 'Choose which text units are eligible for translation.', detection),
    formSection('Page regions', 'Skip non-content regions before they reach the model.', zones)
  ));

  const attrs = el('div', 'toggle-grid');
  attrs.append(
    check('Translate title', exclusions.attributes.title, (value) => { exclusions.attributes.title = value; markDirty(); }),
    check('Translate alt', exclusions.attributes.alt, (value) => { exclusions.attributes.alt = value; markDirty(); }),
    check('Translate placeholder', exclusions.attributes.placeholder, (value) => { exclusions.attributes.placeholder = value; markDirty(); }),
    check('Translate aria-label', exclusions.attributes.ariaLabel, (value) => { exclusions.attributes.ariaLabel = value; markDirty(); }),
    check('Translate button value', exclusions.attributes.buttonValue, (value) => { exclusions.attributes.buttonValue = value; markDirty(); })
  );
  content.append(card('Attributes', 'Only enabled attributes are read and written. Title, alt and aria-label are off by default.', attrs));
  content.append(selectorRules(ctx));
}

function selectorRules(ctx) {
  const { settings, markDirty, render } = ctx;
  const rules = settings.exclusions.domainSelectorRules;
  const actions = el('div', 'inline-actions');
  actions.append(button('Add selector rule', 'secondary', () => { rules.push({ domain: '', allow: [], deny: [] }); markDirty(); render(); }));
  const wrap = el('div', 'table-wrap');
  const table = el('table'); const head = el('thead'); const row = el('tr');
  ['Domain', 'Allow selectors', 'Deny selectors', ''].forEach((label) => row.append(el('th', '', t(label))));
  head.append(row); table.append(head);
  const body = el('tbody');
  for (const rule of rules) {
    const tr = el('tr');
    const domain = el('td'); domain.append(textInput(rule.domain, (value) => { rule.domain = value; markDirty(); }, 'text', { placeholder: 'example.com' }));
    const allow = el('td'); allow.append(textInput(rule.allow.join(', '), (value) => { rule.allow = value.split(',').map((item) => item.trim()).filter(Boolean); markDirty(); }, 'text', { placeholder: '.article-body' }));
    const deny = el('td'); deny.append(textInput(rule.deny.join(', '), (value) => { rule.deny = value.split(',').map((item) => item.trim()).filter(Boolean); markDirty(); }, 'text', { placeholder: '.ad, .cookie-banner' }));
    const action = el('td'); action.append(button('Remove', 'danger', () => { settings.exclusions.domainSelectorRules = rules.filter((item) => item !== rule); markDirty(); render(); }));
    tr.append(domain, allow, deny, action); body.append(tr);
  }
  table.append(body); wrap.append(table);
  if (!rules.length) wrap.append(el('div', 'empty', t('No selector rules yet.')));
  return card('Per-domain selector rules', 'Deny selectors win; allow selectors override detectors for matching domains. Use CSS selectors only.', actions, wrap);
}
