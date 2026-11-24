import {
  getBrowserLanguage,
  languageTerritoryFor,
  searchLanguageOptions
} from '../../shared/languages.js';
import { t } from '../../shared/i18n.js';
import { el } from './ui-utils.js';

let comboboxSequence = 0;

function flagNode(territory, className) {
  const node = el('span', className);
  node.setAttribute('aria-hidden', 'true');
  if (territory) {
    const image = el('img', `${className}-image`);
    image.src = new URL(`../../assets/flags/${territory}.svg`, import.meta.url).href;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      node.replaceChildren(el('span', `${className}-fallback`, '🌐'));
    }, { once: true });
    node.append(image);
  } else {
    node.append(el('span', `${className}-fallback`, '🌐'));
  }
  return node;
}

export function languageField(labelText, value, onChange, hintText = '') {
  const wrap = el('div', 'field language-field');
  const label = el('label', '', t(labelText));
  const controlId = `target-language-${++comboboxSequence}`;
  const menuId = `${controlId}-menu`;
  label.htmlFor = controlId;

  const control = el('div', 'language-combobox');
  const flag = el('span', 'language-combobox-flag');
  flag.setAttribute('aria-hidden', 'true');
  const input = el('input', 'language-combobox-input');
  input.id = controlId;
  input.type = 'text';
  input.value = value ?? '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', menuId);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('placeholder', t('Search languages or enter a custom tag'));

  const toggle = el('button', 'language-combobox-toggle', '⌄');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', t('Show language options'));
  toggle.setAttribute('aria-controls', menuId);
  toggle.setAttribute('aria-expanded', 'false');

  const menu = el('div', 'language-combobox-menu');
  menu.id = menuId;

  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', t('Language options'));

  const footer = el('div', 'language-combobox-footer', t('Custom values are accepted: type a language name or BCP 47 tag.'));
  const popup = el('div', 'language-combobox-popup');
  popup.hidden = true;
  popup.append(menu, footer);
  control.append(flag, input, toggle, popup);
  if (hintText) wrap.append(label, control, el('small', 'hint', t(hintText)));
  else wrap.append(label, control);

  let isOpen = false;
  let activeIndex = -1;
  let results = [];
  let lastValue = input.value;

  function syncFlag() {
    flag.replaceChildren(flagNode(languageTerritoryFor(input.value.trim()), 'language-combobox-flag-content').firstChild);
  }

  function emit(nextValue) {
    if (nextValue === lastValue) return;
    lastValue = nextValue;
    onChange(nextValue);
  }

  function setOpen(nextOpen) {
    isOpen = nextOpen;
    popup.hidden = !isOpen;

    input.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.textContent = isOpen ? '⌃' : '⌄';
    if (!isOpen) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
    }
  }

  function optionMeta(option) {
    if (option.nativeName && option.nativeName.toLowerCase() !== option.name.toLowerCase()) {
      return `${option.nativeName} · ${option.value}`;
    }
    return option.value;
  }

  function setActive(index) {
    const entries = menu.querySelectorAll('.language-combobox-option');
    if (!entries.length) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    activeIndex = (index + entries.length) % entries.length;
    entries.forEach((entry, entryIndex) => {
      const active = entryIndex === activeIndex;
      entry.classList.toggle('active', active);
    });
    const active = entries[activeIndex];
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }

  function choose(option) {
    input.value = option.value;
    emit(option.value);
    syncFlag();
    setOpen(false);
    input.focus();
  }

  function commitInput() {
    const nextValue = input.value.trim();
    input.value = nextValue;
    emit(nextValue);
    syncFlag();
  }

  function renderMenu() {
    results = searchLanguageOptions(input.value, getBrowserLanguage());
    menu.replaceChildren();
    activeIndex = -1;
    input.removeAttribute('aria-activedescendant');

    if (!results.length) {
      menu.append(el('div', 'language-combobox-empty', t('No built-in match. Press Enter or leave the field to use the entered value.')));
      return;
    }

    results.forEach((option, index) => {
      const entry = el('button', 'language-combobox-option');
      entry.type = 'button';
      entry.id = `${menuId}-option-${index}`;
      entry.dataset.language = option.value;
      entry.setAttribute('role', 'option');
      const selected = option.value.toLowerCase() === input.value.trim().toLowerCase();
      entry.setAttribute('aria-selected', String(selected));
      entry.append(
        flagNode(option.territory, 'language-combobox-option-flag'),
        el('span', 'language-combobox-option-copy', `${option.name} · ${optionMeta(option)}`)
      );
      entry.addEventListener('mousedown', (event) => event.preventDefault());
      entry.addEventListener('click', () => choose(option));
      menu.append(entry);
    });
  }

  function openMenu() {
    renderMenu();
    setOpen(true);
  }

  input.addEventListener('focus', openMenu);
  input.addEventListener('input', () => {
    emit(input.value);
    syncFlag();
    openMenu();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) openMenu();
      setActive(activeIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openMenu();
      setActive(activeIndex < 0 ? results.length - 1 : activeIndex - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isOpen && activeIndex >= 0 && results[activeIndex]) choose(results[activeIndex]);
      else {
        commitInput();
        setOpen(false);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      commitInput();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      commitInput();
      setOpen(false);
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (control.contains(document.activeElement)) return;
      commitInput();
      setOpen(false);
    }, 0);
  });
  toggle.addEventListener('click', () => {
    if (isOpen) {
      commitInput();
      setOpen(false);
      input.focus();
      return;
    }
    input.focus();
    openMenu();
  });

  syncFlag();
  return wrap;
}





