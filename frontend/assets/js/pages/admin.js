/**
 * pages/admin.js — the Company admin area: companies, departments and the
 * administrators of each. One page with a section per address:
 *
 *   #admin/companies               list          (holding admin)
 *   #admin/companies/new           create form   (holding admin)
 *   #admin/companies/<id>          edit form     (holding admin)
 *   #admin/departments[/<id>]      per company   (holding admin; company admin: theirs)
 *   #admin/admins                  roles         (holding admin)
 *   #admin/rooms[/new|/<id>]       meeting rooms (holding admin)
 *   #admin/bookings                every booking, with cancel (both)
 *   #admin/it-team                 who is on the IT team (holding admin; D135)
 *
 * What a person may open follows GET /api/admin/scope; the routes behind it
 * enforce the same thing themselves. Work pages run compact (DESIGN.md).
 */

import { api } from '../api.js';
import { esc } from '../html.js';
import { t } from '../i18n.js';
import { loadFailedNotice } from '../components/notice.js';

const SECTIONS = [
  { key: 'companies', label: 'admin.nav.companies', holdingOnly: true },
  { key: 'departments', label: 'admin.nav.departments', holdingOnly: false },
  { key: 'admins', label: 'admin.nav.admins', holdingOnly: true },
  { key: 'quality', label: 'admin.nav.quality', holdingOnly: false },
  { key: 'sync', label: 'admin.nav.sync', holdingOnly: true },
  { key: 'rooms', label: 'admin.nav.rooms', holdingOnly: true },
  { key: 'bookings', label: 'admin.nav.bookings', holdingOnly: false },
  { key: 'it-team', label: 'admin.nav.itTeam', holdingOnly: true },
];

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match, company: object }} ctx
 */
export async function render(root, ctx) {
  let scope;
  try {
    scope = await api('/api/admin/scope', { quiet: true });
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  const allowed = SECTIONS.filter((s) => scope.holdingAdmin || !s.holdingOnly);
  const [asked, ...params] = ctx.route.params;
  const section = allowed.find((s) => s.key === asked) ?? allowed[0];

  root.innerHTML = `<div class="stack admin" data-density="compact">
    <header class="page__heading">
      <h1>${esc(t('nav.admin'))}</h1>
      <p class="page__lead">${esc(t('admin.lead'))}</p>
    </header>
    <nav class="subnav" aria-label="${esc(t('admin.nav.label'))}">
      ${allowed
        .map(
          (s) =>
            `<a class="subnav__link" href="#admin/${s.key}" ${
              s.key === section.key ? 'aria-current="page"' : ''
            }>${esc(t(s.label))}</a>`
        )
        .join('')}
    </nav>
    <div id="adminSection" class="stack"></div>
  </div>`;

  const module = await import(`./admin/${section.key}.js`);
  const container = root.querySelector('#adminSection');
  return module.render(container, { scope, params, ctx, reload: () => render(root, ctx) });
}
