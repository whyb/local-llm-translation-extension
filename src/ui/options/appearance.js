import { CORNERS } from '../../shared/settings.js';
import {
  applyI18n,
  LOCALE_LABELS,
  localizeDocument,
  setUiLocale,
  SUPPORTED_LOCALES,
  t
} from '../../shared/i18n.js';
import { card, check, controlGrid, el, field, selectInput } from './ui-utils.js';

const CORNER_LABELS = Object.freeze({
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right'
});

export function renderAppearance(ctx) {
  const { settings, content, markDirty, render } = ctx;
  const appearance = settings.appearance;

  const languageOptions = [
    { value: '', label: 'Browser language' },
    ...SUPPORTED_LOCALES.map((locale) => ({
      value: locale,
      label: LOCALE_LABELS[locale] ?? locale,
      raw: true
    }))
  ];
  const languageControls = controlGrid(
    'two',
    field('Display language', selectInput(appearance.uiLocale ?? '', languageOptions, (value) => {
      appearance.uiLocale = value || null;
      setUiLocale(appearance.uiLocale);
      localizeDocument(document);
      document.title = t('Local LLM Translator Pro — Settings');
      applyI18n(document);
      markDirty();
      render();
    }))
  );
  content.append(card('Language options', null, languageControls));

  const floatingPreview = el('div', 'appearance-preview floating-preview');
  floatingPreview.setAttribute('role', 'img');
  floatingPreview.setAttribute('aria-label', t('Floating button'));
  const floatingPage = el('div', 'appearance-preview-page');
  floatingPage.append(
    el('span', 'appearance-preview-line wide'),
    el('span', 'appearance-preview-line'),
    el('span', 'appearance-preview-line short')
  );
  const floatingShell = el('div', 'appearance-fab-shell');
  floatingShell.style.setProperty('--preview-progress', '38%');
  floatingShell.append(el('span', 'appearance-fab', '38%'));
  floatingPreview.append(floatingPage, floatingShell);
  const updateFloatingPreview = () => {
    floatingPreview.dataset.corner = appearance.floatingButtonCorner;
    floatingPreview.dataset.enabled = String(appearance.floatingButtonEnabled);
  };
  const floatingControls = controlGrid(
    'two',
    check('Floating button', appearance.floatingButtonEnabled, (value) => {
      appearance.floatingButtonEnabled = value;
      markDirty();
      updateFloatingPreview();
    }),
    field('Floating corner', selectInput(appearance.floatingButtonCorner, CORNERS.map((value) => ({ value, label: CORNER_LABELS[value] ?? value })), (value) => {
      appearance.floatingButtonCorner = value;
      markDirty();
      updateFloatingPreview();
    }), 'Where the floating translate button is anchored.')
  );
  updateFloatingPreview();
  content.append(card('Floating button', 'All controls use a shadow root so page CSS cannot style them.', floatingControls, floatingPreview));

  const selectionPreview = el('div', 'appearance-preview selection-preview');
  selectionPreview.setAttribute('role', 'img');
  selectionPreview.setAttribute('aria-label', t('Selection button'));
  const selectionCopy = el('p', 'selection-preview-copy');
  selectionCopy.append(
    document.createTextNode('Local LLM Translator Pro can translate '),
    el('mark', 'selection-preview-mark', 'this selected passage'),
    document.createTextNode(' without changing its HTML context.')
  );
  const selectionButton = el('span', 'selection-preview-button', '译');
  selectionPreview.append(selectionCopy, selectionButton);
  const selectionCheck = check('Selection button', appearance.selectionButtonEnabled, (value) => {
    appearance.selectionButtonEnabled = value;
    markDirty();
    selectionPreview.dataset.enabled = String(value);
  });
  selectionPreview.dataset.enabled = String(appearance.selectionButtonEnabled);
  content.append(card('Selection button', 'Show a compact translation action next to selected page text.', selectionCheck, selectionPreview));
}
