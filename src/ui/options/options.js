import { getManifest, reportClientError, sendRuntimeMessage } from '../../shared/browser.js';
import { applyI18n, localizeDocument, setUiLocale, t } from '../../shared/i18n.js';
import { loadSettings, normalizeSettings, saveSettings } from '../../shared/settings.js';
import { renderProviders } from './providers.js';
import { renderTranslation } from './translation.js';
import { renderCache } from './cache.js';
import { renderSpeed } from './speed.js';
import { renderAppearance } from './appearance.js';
import { renderSites } from './sites.js';
import { renderExclusions } from './exclusions.js';
import { renderDiagnostics } from './diagnostics.js';
import { renderAbout } from './about.js';

const $ = (selector) => document.querySelector(selector);
const content = $('#content');
const nav = $('#nav');
const saveButton = $('#save');
const saveStatus = $('#save-status');
const title = $('#title');
const eyebrow = $('#eyebrow');
const subtitle = $('#subtitle');

const SECTION_META = {
  providers: ['PROVIDERS', 'Providers', 'Connect local or cloud model endpoints and tune routing.'],
  translation: ['TRANSLATION', 'Translation', 'Control target language, prompt, glossary and layout guards.'],
  cache: ['CACHE', 'Cache', 'Keep repeated navigation fast without making page text ubiquitous.'],
  speed: ['SPEED', 'Speed', 'Control LLM translation speed and speculative work.'],
  appearance: ['APPEARANCE', 'Appearance', 'Make the in-page controls useful without taking over the page.'],
  sites: ['SITES', 'Sites', 'Grant access deliberately. Permission alone never turns a site on.'],
  exclusions: ['EXCLUSIONS', 'Exclusions', 'Decide what must never reach the model.'],
  diagnostics: ['DIAGNOSTICS', 'Diagnostics', 'Observe actual runs, cache health and failures.'],
  about: ['ABOUT', 'About', 'Meet the author and explore the project.']
};

const renderers = {
  providers: renderProviders,
  translation: renderTranslation,
  cache: renderCache,
  speed: renderSpeed,
  appearance: renderAppearance,
  sites: renderSites,
  exclusions: renderExclusions,
  diagnostics: renderDiagnostics,
  about: renderAbout
};

let settings = normalizeSettings(null);
const requestedSection = location.hash.replace(/^#/, '');
let activeSection = SECTION_META[requestedSection] ? requestedSection : 'providers';
if (location.hash !== `#${activeSection}`) history.replaceState(null, '', `#${activeSection}`);
let dirty = false;

function applyDocumentLocale() {
  localizeDocument(document);
  document.title = t('Local LLM Translator Pro — Settings');
  applyI18n(document);
}

function markDirty() {
  dirty = true;
  saveStatus.textContent = t('Unsaved changes');
  saveStatus.className = 'save-status dirty';
}

function markSaved() {
  dirty = false;
  saveStatus.textContent = t('Saved');
  saveStatus.className = 'save-status';
}

function updateHeader() {
  const [small, heading, copy] = SECTION_META[activeSection];
  eyebrow.textContent = t(small);
  title.textContent = t(heading);
  subtitle.textContent = t(copy);
  nav.querySelectorAll('button').forEach((node) => node.classList.toggle('active', node.dataset.section === activeSection));
}

function context() {
  return {
    settings,
    content,
    markDirty,
    render,
    save,
    replaceSettings(next) { settings = normalizeSettings(next); }
  };
}

function render() {
  updateHeader();
  content.replaceChildren();
  const result = renderers[activeSection]?.(context());
  if (result && typeof result.catch === 'function') {
    result.catch((error) => {
      reportClientError('options', error, { phase: 'render', section: activeSection });
      content.append(Object.assign(document.createElement('div'), { className: 'error', textContent: t('Could not render this section: {error}', { error: error.message }) }));
    });
  }
}

async function save(showMessage = true) {
  saveButton.disabled = true;
  try {
    settings = normalizeSettings(await saveSettings(settings));
    setUiLocale(settings.appearance?.uiLocale ?? null);
    applyDocumentLocale();
    markSaved();
    // The options page owns the write. Notify the background for site-script
    // synchronization, but never make the dialog wait on the message channel.
    void Promise.resolve()
      .then(() => sendRuntimeMessage({ type: 'save-settings', settings }))
      .catch(() => {});
    if (showMessage) render();
    return true;
  } catch (error) {
    reportClientError('options', error, { phase: 'save' });
    saveStatus.textContent = t('Save failed: {error}', { error: error instanceof Error ? error.message : String(error) });
    saveStatus.className = 'save-status dirty';
    return false;
  } finally {
    saveButton.disabled = false;
  }
}

nav.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-section]');
  if (!target) return;
  activeSection = target.dataset.section;
  location.hash = activeSection;
  render();
});
window.addEventListener('hashchange', () => {
  const next = location.hash.replace(/^#/, '');
  if (!SECTION_META[next]) {
    history.replaceState(null, '', `#${activeSection}`);
    return;
  }
  if (next !== activeSection) { activeSection = next; render(); }
});
saveButton.addEventListener('click', () => save(true));
window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

(async () => {
  settings = await loadSettings();
  setUiLocale(settings.appearance?.uiLocale ?? null);
  applyDocumentLocale();
  $('#version').textContent = `v${getManifest().version}`;
  markSaved();
  render();
})().catch((error) => {
  setUiLocale(null);
  applyDocumentLocale();
  reportClientError('options', error, { phase: 'load-settings' });
  content.append(Object.assign(document.createElement('div'), { className: 'error', textContent: t('Failed to load settings: {error}', { error: error instanceof Error ? error.message : String(error) }) }));
});

window.addEventListener('error', (event) => {
  reportClientError('options', event.error || event.message, { phase: 'window-error', filename: event.filename, lineno: event.lineno, colno: event.colno });
});
window.addEventListener('unhandledrejection', (event) => {
  reportClientError('options', event.reason, { phase: 'unhandled-rejection' });
});
