import { getManifest } from '../../shared/browser.js';
import { t } from '../../shared/i18n.js';
import { card, el } from './ui-utils.js';

const AUTHOR_URL = 'https://github.com/whyb';
const PROJECT_URL = 'https://github.com/whyb/local-llm-translation-extension';

function externalLink(className, href, text) {
  const link = el('a', className, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

export function renderAbout(ctx) {
  const { content } = ctx;
  const avatar = el('img', 'about-avatar');
  avatar.src = '../../assets/author-avatar.png';
  avatar.alt = t('Portrait of 張小凡');
  avatar.width = 96;
  avatar.height = 96;
  avatar.decoding = 'async';

  const identity = el('div', 'about-identity');
  identity.append(
    el('h3', 'about-name', '張小凡'),
    externalLink('about-handle', AUTHOR_URL, 'GitHub · @whyb'),
    el('p', 'about-role', t('Author & maintainer'))
  );

  const profile = el('div', 'about-profile');
  profile.append(avatar, identity);

  const actions = el('div', 'about-actions');
  actions.append(
    externalLink('about-link primary', PROJECT_URL, t('View project on GitHub')),
    externalLink('about-link', AUTHOR_URL, t('Author on GitHub'))
  );

  content.append(card(
    'About',
    'Meet the author and explore the project.',
    profile,
    el('p', 'about-copy', t('Local LLM Translator Pro is built by 張小凡 to keep browser translation private, local-first and under your control.')),
    actions,
    el('p', 'about-version', t('Version {version}', { version: getManifest().version }))
  ));
}