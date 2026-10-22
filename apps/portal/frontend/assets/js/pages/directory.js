/**
 * pages/directory.js — find a colleague.
 *
 *   #directory                       search and filters, as cards
 *   #directory?q=nadia&company=<id>  the same, with the search typed in
 *   #directory/<id>                  a person's panel open over the list
 *
 * Results come as you type (debounced) and the address follows the search
 * through replaceState, so a view can be bookmarked without every keystroke
 * becoming a history entry or a re-render. A person opens in a side panel,
 * where manager and direct reports are people to open in turn.
 *
 * The directory is group-wide: everyone finds the active people of every
 * company, so the company filter lists them all. An administrator of a
 * person's company can set their Arabic name from the panel.
 */

import { api } from '../api.js';
import { openModal } from '../components/dialog.js';
import { describedBy, field, setBusy, setFieldError } from '../components/form.js';
import { icon } from '../components/icons.js';
import { loadFailedNotice } from '../components/notice.js';
import { showToast } from '../components/toast.js';
import {
  avatarHtml,
  dirOf,
  langAttrs,
  namesOf,
  personCardHtml,
  teamsUrl,
  telUrl,
} from '../components/person.js';
import { formatNumber } from '../format.js';
import { esc } from '../html.js';
import { getLocale, localized, t } from '../i18n.js';

const PAGE_SIZE = 24;
const DEBOUNCE_MS = 250;

const SKELETON = `<ul class="dir-grid" aria-hidden="true">
  ${Array.from(
    { length: 6 },
    () => `<li class="dir-card dir-card--skeleton">
      <span class="skeleton skeleton--avatar"></span>
      <div class="dir-card__text">
        <span class="skeleton skeleton--title"></span>
        <span class="skeleton skeleton--text skeleton--line-short"></span>
      </div>
    </li>`
  ).join('')}
</ul>`;

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match }} ctx
 */
export async function render(root, ctx) {
  const { query, params } = ctx.route;
  const state = {
    q: query.get('q') ?? '',
    company: query.get('company') ?? '',
    department: query.get('department') ?? '',
    items: [],
    total: 0,
    page: 1,
  };
  let turn = 0;
  let timer = null;
  let panel = null;

  let filters;
  try {
    filters = await api('/api/directory/filters', { quiet: true });
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  const multiCompany = filters.companies.length > 1;
  const departmentsFor = (companyId) =>
    filters.departments.filter((d) => !companyId || d.companyId === companyId);
  if (state.company && !filters.companies.some((c) => c.id === state.company)) {
    state.company = '';
  }

  const listAddress = () => {
    const next = new URLSearchParams();
    if (state.q) next.set('q', state.q);
    if (state.company) next.set('company', state.company);
    if (state.department) next.set('department', state.department);
    const qs = next.toString();
    return `#directory${qs ? `?${qs}` : ''}`;
  };

  /* ----------------------------------------------------------------- shell */
  root.innerHTML = `<div class="stack dir">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t('directory.title'))}</h1>
        <p class="page__lead">${esc(t('directory.lead'))}</p>
      </div>
    </header>

    <form class="dir-filters" role="search" id="dirForm" aria-label="${esc(
      t('directory.filtersLabel')
    )}">
      <div class="field dir-filters__q">
        <label class="field__label" for="dirQ">${esc(t('directory.searchLabel'))}</label>
        <div class="input-group">
          ${icon('search', 'input-group__icon')}
          <input class="input" type="search" id="dirQ" name="q" autocomplete="off"
            enterkeyhint="search" value="${esc(state.q)}" />
        </div>
      </div>
      ${
        multiCompany
          ? `<div class="field dir-filters__select">
               <label class="field__label" for="dirCompany">${esc(t('directory.company'))}</label>
               <select class="select" id="dirCompany"></select>
             </div>`
          : ''
      }
      <div class="field dir-filters__select">
        <label class="field__label" for="dirDepartment">${esc(t('directory.department'))}</label>
        <select class="select" id="dirDepartment"></select>
      </div>
    </form>

    <p class="dir-status" id="dirStatus" role="status" aria-live="polite"></p>
    <div id="dirBody" aria-busy="true">${SKELETON}</div>
    <div class="dir-more" id="dirMore" hidden>
      <button type="button" class="btn btn--secondary" id="dirLoadMore">
        <span class="btn__label">${esc(t('directory.loadMore'))}</span>
      </button>
    </div>
  </div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const form = $('dirForm');
  const status = $('dirStatus');
  const body = $('dirBody');
  const more = $('dirMore');

  function drawSelects() {
    if (multiCompany) {
      $('dirCompany').innerHTML = [
        `<option value="">${esc(t('directory.companyAll'))}</option>`,
        ...filters.companies.map(
          (c) =>
            `<option value="${esc(c.id)}" ${c.id === state.company ? 'selected' : ''}>${esc(
              localized(c)
            )}</option>`
        ),
      ].join('');
    }
    const departments = departmentsFor(state.company);
    if (state.department && !departments.some((d) => d.id === state.department)) {
      state.department = '';
    }
    const codeOf = (d) => filters.companies.find((c) => c.id === d.companyId)?.code ?? '';
    // Two companies may both have "Finance": name the company when it matters.
    const suffix = (d) => (multiCompany && !state.company ? ` · ${codeOf(d)}` : '');
    $('dirDepartment').innerHTML = [
      `<option value="">${esc(t('directory.departmentAll'))}</option>`,
      ...departments.map(
        (d) =>
          `<option value="${esc(d.id)}" ${d.id === state.department ? 'selected' : ''}>${esc(
            localized(d) + suffix(d)
          )}</option>`
      ),
    ].join('');
  }

  const filtered = () => Boolean(state.q || state.company || state.department);

  function drawResults() {
    body.setAttribute('aria-busy', 'false');
    if (state.items.length === 0) {
      status.textContent = '';
      body.innerHTML = `<div class="empty">
        <div class="empty__copy">
          <p class="empty__title">${esc(
            t(filtered() ? 'directory.emptyTitle' : 'directory.noneTitle')
          )}</p>
          <p class="empty__text">${esc(
            t(filtered() ? 'directory.emptyText' : 'directory.noneText')
          )}</p>
          ${
            filtered()
              ? `<button type="button" class="btn btn--secondary" id="dirClear">
                   <span class="btn__label">${esc(t('directory.clear'))}</span>
                 </button>`
              : ''
          }
        </div>
      </div>`;
      body.querySelector('#dirClear')?.addEventListener('click', () => {
        state.q = '';
        state.company = '';
        state.department = '';
        $('dirQ').value = '';
        drawSelects();
        replaceAddress();
        load();
        $('dirQ').focus();
      });
      more.hidden = true;
      return;
    }

    body.innerHTML = `<ul class="dir-grid" aria-label="${esc(t('directory.list'))}">${state.items
      .map(personCardHtml)
      .join('')}</ul>`;
    status.textContent = t('directory.status', {
      shown: formatNumber(state.items.length),
      total: formatNumber(state.total),
    });
    more.hidden = state.items.length >= state.total;
  }

  function replaceAddress() {
    history.replaceState(null, '', listAddress());
  }

  async function load({ append = false } = {}) {
    const mine = ++turn;
    if (!append) {
      state.page = 1;
      body.setAttribute('aria-busy', 'true');
      if (state.items.length === 0) body.innerHTML = SKELETON;
    }
    const params = new URLSearchParams({
      page: String(append ? state.page + 1 : 1),
      pageSize: String(PAGE_SIZE),
      lang: getLocale(),
    });
    if (state.q) params.set('q', state.q);
    if (state.company) params.set('companyId', state.company);
    if (state.department) params.set('departmentId', state.department);

    let result;
    try {
      result = await api(`/api/directory/people?${params}`, { quiet: true });
    } catch {
      if (mine !== turn) return;
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = loadFailedNotice();
      body.querySelector('[data-retry]').addEventListener('click', () => load({ append }));
      return;
    }
    if (mine !== turn) return;

    state.page = result.page;
    state.total = result.total;
    state.items = append ? [...state.items, ...result.items] : result.items;
    drawResults();
  }

  /* ----------------------------------------------------------------- events */
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    state.q = $('dirQ').value.trim();
    replaceAddress();
    load();
  });

  $('dirQ').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = $('dirQ').value.trim();
      if (next === state.q) return;
      state.q = next;
      replaceAddress();
      load();
    }, DEBOUNCE_MS);
  });

  if (multiCompany) {
    $('dirCompany').addEventListener('change', (event) => {
      state.company = event.target.value;
      state.department = '';
      drawSelects();
      replaceAddress();
      load();
    });
  }
  $('dirDepartment').addEventListener('change', (event) => {
    state.department = event.target.value;
    replaceAddress();
    load();
  });

  $('dirLoadMore').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.setAttribute('aria-busy', 'true');
    const before = state.items.length;
    await load({ append: true });
    button.removeAttribute('aria-busy');
    // Keyboard focus moves to the first new card, which is where reading resumes.
    body.querySelectorAll('.dir-card__link')[before]?.focus();
  });

  // A card opens the panel in place; a modified click keeps its own address.
  body.addEventListener('click', (event) => {
    const link = event.target.closest('[data-person]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openPanel(link.dataset.person);
  });

  /* ------------------------------------------------------------------ panel */
  function personRow(person) {
    const { primary } = namesOf(person);
    return `<li>
      <button type="button" class="dir-row" data-person="${esc(person.id)}"
        aria-label="${esc(t('directory.openPerson', { name: primary.text }))}">
        ${avatarHtml(person, 'sm')}
        <span class="dir-row__text">
          <span class="dir-row__name" ${langAttrs(primary.lang)}>${esc(primary.text)}</span>
          ${person.jobTitle ? `<span class="dir-row__title">${esc(person.jobTitle)}</span>` : ''}
        </span>
        ${icon('chevronEnd', 'dir-row__go icon--dir')}
      </button>
    </li>`;
  }

  const pair = (key, value) => `<div class="labelstrip__pair">
      <dt class="labelstrip__key">${esc(key)}</dt>
      <dd class="labelstrip__value">${value}</dd>
    </div>`;
  const ltr = (text) => `<span dir="ltr">${esc(text)}</span>`;

  function panelHtml(p) {
    const { other } = namesOf(p);
    const action = (href, iconName, label, { primary = false, external = false } = {}) =>
      `<a class="btn ${primary ? 'btn--primary' : 'btn--secondary'}" href="${esc(href)}"
        ${external ? 'target="_blank" rel="noopener noreferrer"' : ''}
        ${external ? `aria-label="${esc(t('directory.panel.teamsNew'))}"` : ''}>
        ${icon(iconName, 'btn__icon')}<span class="btn__label">${esc(label)}</span>
      </a>`;

    return `<div class="dir-panel">
      <div class="dir-panel__who">
        ${avatarHtml(p, 'xl')}
        <div class="dir-panel__names">
          ${
            other
              ? `<p class="dir-panel__other"><span ${langAttrs(other.lang)}>${esc(other.text)}</span></p>`
              : ''
          }
          ${p.jobTitle ? `<p class="dir-panel__title">${esc(p.jobTitle)}</p>` : ''}
        </div>
      </div>

      <div class="dir-actions" role="group" aria-label="${esc(t('directory.panel.actions'))}">
        ${action(`mailto:${p.email}`, 'mail', t('directory.panel.email'), { primary: true })}
        ${p.phone ? action(telUrl(p.phone), 'phone', t('directory.panel.call')) : ''}
        ${
          p.mobilePhone
            ? action(telUrl(p.mobilePhone), 'phone', t('directory.panel.callMobile'))
            : ''
        }
        ${action(teamsUrl(p.email), 'chat', t('directory.panel.teams'), { external: true })}
      </div>

      <dl class="labelstrip labelstrip--open dir-panel__strip">
        ${pair(
          t('directory.panel.department'),
          p.department ? esc(localized(p.department)) : esc(t('directory.panel.notListed'))
        )}
        ${pair(t('directory.panel.company'), esc(localized(p.company)))}
        ${pair(t('directory.panel.office'), p.officeLocation ? esc(p.officeLocation) : '—')}
        ${pair(t('directory.panel.phone'), p.phone ? ltr(p.phone) : '—')}
        ${p.mobilePhone ? pair(t('directory.panel.mobile'), ltr(p.mobilePhone)) : ''}
        ${pair(t('directory.panel.emailKey'), ltr(p.email))}
      </dl>

      <section aria-labelledby="dirMgr">
        <h3 class="card__title" id="dirMgr">${esc(t('directory.panel.manager'))}</h3>
        ${
          p.manager
            ? `<ul class="dir-people">${personRow(p.manager)}</ul>`
            : `<p class="dir-panel__none">${esc(t('directory.panel.noManager'))}</p>`
        }
      </section>

      <section aria-labelledby="dirReports">
        <h3 class="card__title" id="dirReports">${esc(t('directory.panel.reports'))}
          <span class="dir-panel__count">${esc(formatNumber(p.directReports.length))}</span></h3>
        ${
          p.directReports.length
            ? `<ul class="dir-people">${p.directReports.map(personRow).join('')}</ul>`
            : `<p class="dir-panel__none">${esc(t('directory.panel.noReports'))}</p>`
        }
      </section>
      ${p.canEditArabicName ? arabicNameHtml(p) : ''}
    </div>`;
  }

  /** For an administrator of this person's company only (the API says who). */
  function arabicNameHtml(p) {
    return `<details class="dir-arname">
      <summary class="dir-arname__summary">${esc(t('directory.panel.arabicEdit'))}</summary>
      <form class="dir-arname__form" id="dirArForm" novalidate>
        ${field({
          id: 'dirArName',
          label: t('directory.panel.arabicLabel'),
          help: t('directory.panel.arabicHelp'),
          control: `<input class="input" id="dirArName" name="displayNameAr" type="text"
            lang="ar" dir="rtl" maxlength="200" autocomplete="off"
            value="${esc(p.displayNameAr ?? '')}" aria-describedby="${describedBy('dirArName')}" />`,
        })}
        <div>
          <button type="submit" class="btn btn--primary">
            <span class="btn__label">${esc(t('action.save'))}</span>
          </button>
        </div>
      </form>
    </details>`;
  }

  function wireArabicName(content, person) {
    const form = content.querySelector('#dirArForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      setFieldError(form, 'dirArName', '');
      setBusy(button, true, t('action.saving'));
      let saved;
      try {
        saved = await api(`/api/admin/directory/people/${encodeURIComponent(person.id)}`, {
          method: 'PATCH',
          body: { displayNameAr: form.elements.displayNameAr.value },
          quiet: true,
        });
      } catch (err) {
        setBusy(button, false, t('action.save'));
        setFieldError(
          form,
          'dirArName',
          t(
            err?.status === 403
              ? 'directory.panel.arabicForbidden'
              : 'directory.panel.arabicFailed'
          )
        );
        form.elements.displayNameAr.focus();
        return;
      }
      showToast({ tone: 'success', titleKey: 'directory.panel.arabicSaved' });
      drawPerson(saved, { focusTitle: true });
      // The cards behind the panel carry the name too.
      load();
    });
  }

  function drawPerson(person, { focusTitle = false } = {}) {
    // Closed while a save was on its way: nothing to draw into.
    if (!panel) return;
    const { dialog } = panel;
    const content = dialog.querySelector('.dialog__body');
    const title = dialog.querySelector('.dialog__title');
    const { primary } = namesOf(person);
    title.textContent = primary.text;
    title.setAttribute('lang', primary.lang);
    title.setAttribute('dir', dirOf(primary.lang));
    content.innerHTML = panelHtml(person);
    content.setAttribute('aria-busy', 'false');
    history.replaceState(null, '', `#directory/${person.id}`);

    for (const button of content.querySelectorAll('[data-person]')) {
      button.addEventListener('click', () =>
        showPerson(button.dataset.person, { focusTitle: true })
      );
    }
    wireArabicName(content, person);
    if (focusTitle) {
      title.setAttribute('tabindex', '-1');
      title.focus();
    }
  }

  async function showPerson(id, { focusTitle = false } = {}) {
    const { dialog } = panel;
    const content = dialog.querySelector('.dialog__body');
    const title = dialog.querySelector('.dialog__title');
    content.setAttribute('aria-busy', 'true');

    let person;
    try {
      person = await api(`/api/directory/people/${encodeURIComponent(id)}`, { quiet: true });
    } catch {
      content.setAttribute('aria-busy', 'false');
      title.textContent = t('directory.title');
      content.innerHTML = `<p>${esc(t('directory.panel.failed'))}</p>
        <button type="button" class="btn btn--secondary" data-again>
          <span class="btn__label">${esc(t('directory.panel.retry'))}</span>
        </button>`;
      content.querySelector('[data-again]').addEventListener('click', () => showPerson(id));
      return;
    }

    drawPerson(person, { focusTitle });
  }

  async function openPanel(id) {
    panel?.close();
    panel = openModal({
      kind: 'drawer',
      title: t('directory.panel.loading'),
      bodyHtml: `<div class="skeleton skeleton--title" aria-hidden="true"></div>`,
    });
    const mine = panel;
    mine.dialog.classList.add('dir-drawer');
    mine.closed.then(() => {
      if (panel === mine) {
        panel = null;
        history.replaceState(null, '', listAddress());
      }
    });
    await showPerson(id);
  }

  /* ------------------------------------------------------------------ start */
  drawSelects();
  await load();

  if (params[0]) openPanel(params[0]);

  return () => {
    clearTimeout(timer);
    turn += 1;
    const open = panel;
    panel = null;
    open?.close();
  };
}
