/**
 * components/people-search.js — the top bar's search: a typeahead over what
 * the portal can find, today people.
 *
 * Typing shows the first few matches under the field. Arrow keys move through
 * them, Enter opens the highlighted person, or the Directory with the query
 * when nothing is highlighted. Escape closes. The field is a combobox with a
 * listbox, so a screen reader hears the same thing.
 *
 * HOOK for rooms and tickets: SOURCES below is the whole list of things the
 * search asks. A module adds one entry with `search(query, signal)` returning
 * rows `{ id, title, subtitle?, href }`, and `allHref(query)` for its "see
 * all" page. Results are grouped under the source's `label` as soon as more
 * than one source answers.
 */

import { api } from '../api.js';
import { esc } from '../html.js';
import { getLocale, localized, t } from '../i18n.js';
import { namesOf } from './person.js';

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;
const LIMIT = 5;

/** @type {{ key: string, label: string, search: Function, allHref: Function }[]} */
const SOURCES = [
  {
    key: 'people',
    label: 'search.group.people',
    async search(query) {
      const params = new URLSearchParams({
        q: query,
        pageSize: String(LIMIT),
        lang: getLocale(),
      });
      const result = await api(`/api/directory/people?${params}`, { quiet: true });
      return result.items.map((person) => {
        const { primary } = namesOf(person);
        const where = [person.jobTitle, localized(person.company)].filter(Boolean).join(' · ');
        return {
          id: person.id,
          title: primary.text,
          lang: primary.lang,
          subtitle: where,
          href: `#directory/${person.id}`,
        };
      });
    },
    allHref: (query) => `#directory?q=${encodeURIComponent(query)}`,
  },
];

/** @param {HTMLInputElement} input */
export function initPeopleSearch(input) {
  const host = input.closest('.topbar__search');
  if (!host || host.dataset.typeahead) return;
  host.dataset.typeahead = 'true';

  const listbox = document.createElement('div');
  listbox.className = 'typeahead';
  listbox.id = 'searchResults';
  listbox.hidden = true;
  listbox.innerHTML = `<ul class="typeahead__list" role="listbox" aria-label="${esc(
    t('search.results')
  )}"></ul>
    <a class="typeahead__all" id="searchAll" href="#directory"></a>
    <p class="u-visually-hidden" role="status" aria-live="polite" id="searchStatus"></p>`;
  host.append(listbox);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'searchResults');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('enterkeyhint', 'search');

  const list = listbox.querySelector('.typeahead__list');
  const all = listbox.querySelector('#searchAll');
  const status = listbox.querySelector('#searchStatus');

  let timer = null;
  let turn = 0;
  let rows = [];
  let active = -1;

  const open = () => {
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  function highlight(index) {
    active = index;
    for (const [i, el] of list.querySelectorAll('[role="option"]').entries()) {
      el.setAttribute('aria-selected', String(i === index));
    }
    const el = list.querySelectorAll('[role="option"]')[index];
    if (el) input.setAttribute('aria-activedescendant', el.id);
    else input.removeAttribute('aria-activedescendant');
  }

  function draw(query, groups) {
    rows = groups.flatMap((g) => g.rows);
    const grouped = groups.filter((g) => g.rows.length).length > 1;
    let index = 0;
    list.innerHTML = groups
      .filter((g) => g.rows.length)
      .map(
        (
          g
        ) => `${grouped ? `<li role="presentation" class="typeahead__group">${esc(t(g.label))}</li>` : ''}
        ${g.rows
          .map((row) => {
            const id = `searchOption${index}`;
            index += 1;
            return `<li role="option" id="${id}" aria-selected="false" class="typeahead__option"
              data-href="${esc(row.href)}">
              <span class="typeahead__title" lang="${esc(row.lang ?? getLocale())}">${esc(row.title)}</span>
              ${row.subtitle ? `<span class="typeahead__subtitle">${esc(row.subtitle)}</span>` : ''}
            </li>`;
          })
          .join('')}`
      )
      .join('');

    const empty = rows.length === 0;
    if (empty) {
      list.innerHTML = `<li role="presentation" class="typeahead__none">${esc(
        t('search.none', { query })
      )}</li>`;
    }
    all.textContent = t('search.all', { query });
    all.href = SOURCES[0].allHref(query);
    all.hidden = empty;
    status.textContent = empty
      ? t('search.none', { query })
      : t('search.count', { count: rows.length });
    highlight(-1);
    open();
  }

  async function run() {
    const query = input.value.trim();
    if (query.length < MIN_CHARS) {
      turn += 1;
      close();
      return;
    }
    const mine = ++turn;
    try {
      const groups = await Promise.all(
        SOURCES.map(async (s) => ({ label: s.label, rows: await s.search(query) }))
      );
      if (mine === turn) draw(query, groups);
    } catch {
      if (mine !== turn) return;
      list.innerHTML = `<li role="presentation" class="typeahead__none">${esc(t('search.failed'))}</li>`;
      all.hidden = true;
      open();
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (event) => {
    const count = rows.length;
    if (event.key === 'ArrowDown' && !listbox.hidden && count) {
      event.preventDefault();
      highlight((active + 1) % count);
    } else if (event.key === 'ArrowUp' && !listbox.hidden && count) {
      event.preventDefault();
      highlight((active - 1 + count) % count);
    } else if (event.key === 'Escape') {
      if (!listbox.hidden) {
        event.preventDefault();
        close();
      }
    } else if (event.key === 'Enter') {
      const query = input.value.trim();
      if (!query) return;
      event.preventDefault();
      clearTimeout(timer);
      turn += 1;
      const href = active >= 0 ? rows[active].href : SOURCES[0].allHref(query);
      close();
      input.blur();
      location.hash = href;
    }
  });

  // mousedown, not click: the field's blur would close the list first.
  list.addEventListener('mousedown', (event) => {
    const option = event.target.closest('[role="option"]');
    if (!option) return;
    event.preventDefault();
    close();
    location.hash = option.dataset.href;
  });
  all.addEventListener('click', () => close());

  input.addEventListener('focus', () => {
    if (rows.length && input.value.trim().length >= MIN_CHARS) open();
  });
  document.addEventListener('click', (event) => {
    if (!host.contains(event.target)) close();
  });
  host.addEventListener('focusout', (event) => {
    if (!host.contains(event.relatedTarget)) close();
  });
}
