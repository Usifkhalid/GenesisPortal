/**
 * components/people-picker.js — choose people from the directory: a search
 * field with a list of matches under it, and the people chosen so far as
 * chips that can each be taken out again.
 *
 * It is a combobox with a listbox, so a screen reader hears the same thing a
 * sighted person sees. Escape closes the list first and only then the dialog
 * the picker sits in. Results are the directory's: group-wide, in the name
 * the language in use asks for.
 *
 * @example
 *   const picker = createPeoplePicker({ host, id: 'invite', label: 'Invite people' });
 *   picker.ids;        // the chosen people's ids
 *   picker.onChange = () => {};
 */

import { api } from '../api.js';
import { esc } from '../html.js';
import { getLocale, localized, t } from '../i18n.js';
import { icon } from './icons.js';
import { avatarHtml, langAttrs, namesOf } from './person.js';

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;
const LIMIT = 6;

/**
 * @param {object} options
 * @param {HTMLElement} options.host  where the picker is drawn
 * @param {string} options.id  the input's id; the label points at it
 * @param {string} options.label  translated
 * @param {string} [options.help]  translated
 * @param {number} [options.max]  most people that may be chosen
 * @param {boolean} [options.required]  say "required" in place of "optional"
 * @param {string} [options.source]  the search address: the directory's, or the
 *   IT Helpdesk's own (/api/helpdesk/people), which IT team members use (D135)
 */
export function createPeoplePicker({
  host,
  id,
  label,
  help = '',
  max = 50,
  required = false,
  source = '/api/directory/people',
}) {
  /** @type {Map<string, object>} */
  const chosen = new Map();
  let found = [];
  let active = -1;
  let timer = null;
  let turn = 0;

  host.classList.add('picker');
  host.innerHTML = `
    <label class="field__label" for="${esc(id)}"><span>${esc(label)}</span>
      <span class="${required ? 'field__required' : 'field__optional'}">(${esc(
        t(required ? 'field.required' : 'field.optional')
      )})</span></label>
    <div class="input-group">
      ${icon('search', 'input-group__icon')}
      <input class="input" id="${esc(id)}" type="search" autocomplete="off"
        enterkeyhint="search" role="combobox" aria-autocomplete="list" aria-expanded="false"
        aria-controls="${esc(id)}-list" aria-describedby="${esc(id)}-help ${esc(id)}-status" />
    </div>
    ${help ? `<p class="field__help" id="${esc(id)}-help">${esc(help)}</p>` : `<span id="${esc(id)}-help"></span>`}
    <ul class="picker__list" id="${esc(id)}-list" role="listbox"
      aria-label="${esc(t('picker.results'))}" hidden></ul>
    <p class="u-visually-hidden" id="${esc(id)}-status" role="status" aria-live="polite"></p>
    <ul class="picker__chips" aria-label="${esc(t('picker.chosen'))}"></ul>`;

  const input = host.querySelector('input');
  const list = host.querySelector('.picker__list');
  const chips = host.querySelector('.picker__chips');
  const status = host.querySelector('[role="status"]');

  const picker = {
    /** Called after the chosen people change. */
    onChange: () => {},
    get ids() {
      return [...chosen.keys()];
    },
    get count() {
      return chosen.size;
    },
    /** The chosen people, as the directory sent them. */
    get people() {
      return [...chosen.values()];
    },
    input,
  };

  const open = () => {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function highlight(index) {
    active = index;
    const options = [...list.querySelectorAll('[role="option"]')];
    options.forEach((el, i) => el.setAttribute('aria-selected', String(i === index)));
    if (options[index]) input.setAttribute('aria-activedescendant', options[index].id);
    else input.removeAttribute('aria-activedescendant');
    options[index]?.scrollIntoView({ block: 'nearest' });
  }

  function drawChips() {
    chips.innerHTML = [...chosen.values()]
      .map((person) => {
        const { primary } = namesOf(person);
        return `<li class="picker__chip">
          ${avatarHtml(person, 'sm')}
          <span class="picker__name" ${langAttrs(primary.lang)}>${esc(primary.text)}</span>
          <button type="button" class="btn btn--ghost btn--sm btn--icon" data-remove="${esc(person.id)}"
            aria-label="${esc(t('picker.remove', { name: primary.text }))}">
            ${icon('x', 'btn__icon')}
          </button>
        </li>`;
      })
      .join('');
    chips.hidden = chosen.size === 0;
  }

  function add(person) {
    if (chosen.size >= max) {
      status.textContent = t('picker.full', { count: max });
      return;
    }
    chosen.set(person.id, person);
    drawChips();
    input.value = '';
    close();
    status.textContent = t('picker.added', { name: namesOf(person).primary.text });
    picker.onChange();
  }

  function remove(personId) {
    const person = chosen.get(personId);
    if (!person) return;
    // Keep the keyboard where it was: on the next chip, or the field.
    const buttons = [...chips.querySelectorAll('[data-remove]')];
    const at = buttons.findIndex((b) => b.dataset.remove === personId);
    chosen.delete(personId);
    drawChips();
    status.textContent = t('picker.removed', { name: namesOf(person).primary.text });
    const rest = [...chips.querySelectorAll('[data-remove]')];
    (rest[Math.min(at, rest.length - 1)] ?? input).focus();
    picker.onChange();
  }

  function drawResults(query) {
    const rows = found.filter((p) => !chosen.has(p.id));
    if (rows.length === 0) {
      list.innerHTML = `<li class="picker__none" role="presentation">${esc(
        t('picker.none', { query })
      )}</li>`;
      status.textContent = t('picker.none', { query });
    } else {
      list.innerHTML = rows
        .map((person, i) => {
          const { primary } = namesOf(person);
          const where = [person.jobTitle, localized(person.company)]
            .filter(Boolean)
            .join(' · ');
          return `<li role="option" id="${esc(id)}-opt-${i}" aria-selected="false"
              class="picker__option" data-id="${esc(person.id)}">
            ${avatarHtml(person, 'sm')}
            <span class="picker__text">
              <span class="picker__name" ${langAttrs(primary.lang)}>${esc(primary.text)}</span>
              ${where ? `<span class="picker__where">${esc(where)}</span>` : ''}
            </span>
          </li>`;
        })
        .join('');
      status.textContent = t('picker.count', { count: rows.length });
    }
    found = rows;
    active = -1;
    open();
  }

  async function search() {
    const query = input.value.trim();
    if (query.length < MIN_CHARS) {
      turn += 1;
      close();
      return;
    }
    const mine = ++turn;
    try {
      const params = new URLSearchParams({
        q: query,
        pageSize: String(LIMIT + chosen.size),
        lang: getLocale(),
      });
      const result = await api(`${source}?${params}`, { quiet: true });
      if (mine !== turn) return;
      found = result.items;
      drawResults(query);
    } catch {
      if (mine !== turn) return;
      found = [];
      list.innerHTML = `<li class="picker__none" role="presentation">${esc(t('picker.failed'))}</li>`;
      status.textContent = t('picker.failed');
      open();
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (event) => {
    const count = list.querySelectorAll('[role="option"]').length;
    if (event.key === 'ArrowDown' && !list.hidden && count) {
      event.preventDefault();
      highlight((active + 1) % count);
    } else if (event.key === 'ArrowUp' && !list.hidden && count) {
      event.preventDefault();
      highlight((active - 1 + count) % count);
    } else if (event.key === 'Enter') {
      // Enter in this field never submits the booking behind it.
      event.preventDefault();
      if (!list.hidden && active >= 0 && found[active]) add(found[active]);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });

  // mousedown, not click: the field's blur would close the list first.
  list.addEventListener('mousedown', (event) => {
    const option = event.target.closest('[role="option"]');
    if (!option) return;
    event.preventDefault();
    const person = found.find((p) => p.id === option.dataset.id);
    if (person) add(person);
    input.focus();
  });

  chips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (button) remove(button.dataset.remove);
  });

  host.addEventListener('focusout', (event) => {
    if (!host.contains(event.relatedTarget)) close();
  });

  drawChips();
  return picker;
}
