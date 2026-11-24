import { t } from '../../shared/i18n.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function card(titleText, hintText, ...children) {
  const node = el('section', 'card');
  const header = el('header', 'card-header');
  const copy = el('div', 'card-heading');
  if (titleText) copy.append(el('h2', '', t(titleText)));
  if (hintText) copy.append(el('p', 'hint', t(hintText)));
  if (titleText || hintText) header.append(copy);
  const body = el('div', 'card-body');
  for (const child of children) if (child) body.append(child);
  if (header.childElementCount) node.append(header);
  node.append(body);
  return node;
}

export function controlGrid(columns = 'two', ...children) {
  const node = el('div', `control-grid ${columns}`);
  for (const child of children) if (child) node.append(child);
  return node;
}

export function formSection(titleText, hintText, ...children) {
  const node = el('section', 'form-section');
  if (titleText || hintText) {
    const heading = el('div', 'form-section-heading');
    if (titleText) heading.append(el('h3', '', t(titleText)));
    if (hintText) heading.append(el('p', 'hint', t(hintText)));
    node.append(heading);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

export function field(label, control, hintText) {
  const wrap = el('label', 'field');
  const title = el('span', 'field-label', t(label));
  wrap.append(title, control);
  if (hintText) wrap.append(el('small', 'field-hint', t(hintText)));
  return wrap;
}

export function check(label, checked, onChange, hintText) {
  const wrap = el('label', 'check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.addEventListener('change', () => onChange(input.checked));
  const text = el('span');
  text.append(el('strong', '', t(label)));
  if (hintText) text.append(el('small', 'hint', t(hintText)));
  wrap.append(input, text);
  return wrap;
}

export function textInput(value, onInput, type = 'text', attrs = {}) {
  const input = el('input');
  input.type = type;
  input.value = value ?? '';
  for (const [key, val] of Object.entries(attrs)) input.setAttribute(key, /^(?:placeholder|title|aria-label)$/.test(key) ? t(val) : val);
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function numberInput(value, onInput, attrs = {}) {
  return textInput(value ?? '', (raw) => onInput(raw === '' ? null : Number(raw)), 'number', attrs);
}

export function selectInput(value, options, onChange) {
  const select = el('select');
  for (const option of options) {
    const entry = typeof option === 'string' ? { value: option, label: option } : option;
    const node = el('option', '', entry.raw ? entry.label : t(entry.label ?? entry.value));
    node.value = entry.value;
    select.append(node);
  }
  select.value = value ?? '';
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function textArea(value, onInput, attrs = {}) {
  const input = el('textarea');
  input.value = value ?? '';
  for (const [key, val] of Object.entries(attrs)) input.setAttribute(key, /^(?:placeholder|title|aria-label)$/.test(key) ? t(val) : val);
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function button(labelText, className = 'secondary', onClick = null) {
  const node = el('button', className, t(labelText));
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function redact(value) {
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=:-]+/gi, '[redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
      .replace(/\b(?:api[-_]?key|token|secret|password)\s*[:=]\s*["']?[^\s,;"']+/gi, '[redacted-key]')
      .replace(/[?&](?:key|access_token)=[A-Za-z0-9._~+/=-]+/gi, '[redacted-query-key]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = /api[-_]?key|authorization|auth|bearer|token|secret|password|passwd|credential|cookie/i.test(key)
        ? '[redacted]'
        : redact(item);
    }
    return out;
  }
  return value;
}
