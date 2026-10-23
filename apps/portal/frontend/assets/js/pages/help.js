/**
 * pages/help.js — short answers per module, and how to reach IT.
 *
 * The answers are in assets/i18n/help-<lang>.json (topic.q1/a1 … q3/a3), a file of their own so no first load carries them; the
 * topics and the number of answers are fixed here, so adding one is a key
 * in both files and a line in TOPICS.
 */

import { esc } from '../html.js';
import { icon } from '../components/icons.js';
import { getLocale, t } from '../i18n.js';

/** Fetched from help-<lang>.json: { topic: { title, q1, a1, … } }. */
const TOPICS = [
  { key: 'signin', icon: 'user' },
  { key: 'rooms', icon: 'rooms' },
  { key: 'itSupport', icon: 'tickets' },
  { key: 'announcements', icon: 'announcements' },
  { key: 'directory', icon: 'directory' },
  { key: 'notifications', icon: 'notifications' },
  { key: 'install', icon: 'phone' },
];
const ANSWERS = [1, 2, 3];

function topicHtml(words, { key, icon: name }) {
  return `<section class="help__topic card" id="help-${key}" aria-labelledby="help-${key}-h">
    <h2 class="help__topic-title" id="help-${key}-h">
      ${icon(name)}<span>${esc(words[key].title)}</span>
    </h2>
    <div class="help__answers">
      ${ANSWERS.map(
        (n) => `<details class="help__item">
          <summary>${esc(words[key][`q${n}`])}</summary>
          <p>${esc(words[key][`a${n}`])}</p>
        </details>`
      ).join('')}
    </div>
  </section>`;
}

/** @param {{ helpdeskUrl: string | null }} ctx */
export async function render(root, ctx) {
  // The answers are their own file, so every first load does not carry them.
  const words = await (await fetch(`assets/i18n/help-${getLocale()}.json`)).json();
  root.innerHTML = `<div class="stack help">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t('help.title'))}</h1>
        <p class="page__lead">${esc(t('help.lead'))}</p>
      </div>
    </header>
    <nav class="help__jump" aria-label="${esc(t('help.sections'))}">
      ${TOPICS.map(
        ({ key }) =>
          `<a class="btn btn--secondary btn--sm" href="#help" data-jump="help-${key}">${esc(words[key].title)}</a>`
      ).join('')}
    </nav>
    <div class="help__grid">${TOPICS.map((topic) => topicHtml(words, topic)).join('')}</div>
    <section class="help__contact card" aria-labelledby="help-contact-h">
      <div>
        <h2 id="help-contact-h">${esc(t('help.contact.title'))}</h2>
        <p>${esc(t(ctx.helpdeskUrl ? 'help.contact.text' : 'help.noLink.text'))}</p>
      </div>
      ${
        ctx.helpdeskUrl
          ? `<a class="btn btn--primary" href="${esc(ctx.helpdeskUrl)}/#tickets/new" target="_blank" rel="noopener">
               <span class="btn__label">${esc(t('help.contact.action'))}</span>
               <span class="u-visually-hidden">${esc(t('a11y.opensNewTab'))}</span>
             </a>`
          : ''
      }
    </section>
  </div>`;

  // The addresses are hashes, so a plain #fragment link would be a route:
  // scroll to the topic instead.
  root.querySelector('.help__jump').addEventListener('click', (event) => {
    const link = event.target.closest('[data-jump]');
    if (!link) return;
    event.preventDefault();
    const target = root.querySelector(`#${link.dataset.jump}`);
    target?.scrollIntoView({ block: 'start' });
    target?.querySelector('summary')?.focus();
  });
}
