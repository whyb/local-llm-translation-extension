import { CORNERS, FRESH_STYLES, GLOW_STYLES } from '../../shared/settings.js';
import { t } from '../../shared/i18n.js';
import { card, check, controlGrid, el, field, numberInput, selectInput, textInput } from './ui-utils.js';
const GLOW_LABELS = Object.freeze({ 'text-glow': 'Text glow', 'subtle-tint': 'Subtle tint', shimmer: 'Shimmer', none: 'None' });
const FRESH_LABELS = Object.freeze({ pop: 'Pop', fade: 'Fade' });
const CORNER_LABELS = Object.freeze({
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right'
});

export function renderAppearance(ctx) {
  const { settings, content, markDirty } = ctx;
  const appearance = settings.appearance;

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
    document.createTextNode('Local LLM Translator can translate '),
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

  const hudPreview = el('div', 'appearance-preview hud-preview');
  hudPreview.setAttribute('role', 'img');
  hudPreview.setAttribute('aria-label', t('Performance HUD'));
  hudPreview.append(el('pre', 'hud-preview-window', 'LLMT translating\n12 / 40 (30%)\nrun-demo-4f2a'));
  const hudCheck = check('Performance HUD', appearance.hudEnabled, (value) => {
    appearance.hudEnabled = value;
    markDirty();
    hudPreview.dataset.enabled = String(value);
  });
  hudPreview.dataset.enabled = String(appearance.hudEnabled);
  content.append(card('Performance HUD', 'Display live run details while translating.', hudCheck, hudPreview));

  const glowPreview = el('div', 'appearance-preview glow-preview');
  glowPreview.setAttribute('role', 'img');
  glowPreview.setAttribute('aria-label', t('Glow feedback'));
  const pendingChip = el('span', 'glow-preview-chip glow-preview-pending', t('Translating'));
  const freshChip = el('span', 'glow-preview-chip glow-preview-fresh', t('Translated'));
  glowPreview.append(pendingChip, freshChip);
  const updateGlowPreview = () => {
    glowPreview.dataset.pendingStyle = appearance.glow.pendingStyle;
    glowPreview.dataset.freshStyle = appearance.glow.freshStyle;
    glowPreview.dataset.enabled = String(appearance.glow.enabled);
    glowPreview.style.setProperty('--preview-pending', appearance.glow.pendingColor);
    glowPreview.style.setProperty('--preview-fresh', appearance.glow.freshColor);
    glowPreview.classList.toggle('is-reduced', appearance.glow.reducedIntensity);
  };
  const glowControls = controlGrid(
    'three',
    check('Glow feedback', appearance.glow.enabled, (value) => {
      appearance.glow.enabled = value;
      markDirty();
      updateGlowPreview();
    }),
    field('Pending color', textInput(appearance.glow.pendingColor, (value) => { appearance.glow.pendingColor = value; markDirty(); updateGlowPreview(); }, 'color')),
    field('Fresh color', textInput(appearance.glow.freshColor, (value) => { appearance.glow.freshColor = value; markDirty(); updateGlowPreview(); }, 'color')),
    field('Cooldown (ms)', numberInput(appearance.glow.cooldownMs, (value) => { appearance.glow.cooldownMs = value ?? 1200; markDirty(); }, { min: '0', step: '100' })),
    field('Pending style', selectInput(appearance.glow.pendingStyle, GLOW_STYLES.map((value) => ({ value, label: GLOW_LABELS[value] ?? value })), (value) => { appearance.glow.pendingStyle = value; markDirty(); updateGlowPreview(); })),
    field('Fresh style', selectInput(appearance.glow.freshStyle, FRESH_STYLES.map((value) => ({ value, label: FRESH_LABELS[value] ?? value })), (value) => { appearance.glow.freshStyle = value; markDirty(); updateGlowPreview(); })),
    check('Reduced intensity', appearance.glow.reducedIntensity, (value) => { appearance.glow.reducedIntensity = value; markDirty(); updateGlowPreview(); }, 'Use subtler highlights for photosensitivity or visual preference.')
  );
  updateGlowPreview();
  content.append(card('Glow feedback', 'Highlight translated content without changing page text or layout.', glowControls, glowPreview));
}
