/**
 * pages/administration.js — the IT Helpdesk's Administration, for its
 * HoldingAdmins (D144). One page with a section per address:
 *
 *   #admin/it-team      who is on the IT team, and as what
 *   #admin/companies    the companies served and their mail domains
 *
 * The routes behind it answer 403 to anyone else.
 */

import { esc } from '../html.js';
import { t } from '../i18n.js';

const SECTIONS = [
  { key: 'it-team', label: 'hdApp.admin.itTeam' },
  { key: 'companies', label: 'hdApp.admin.companies' },
];

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match }} ctx
 */
export async function render(root, ctx) {
  const [asked] = ctx.route.params;
  const section = SECTIONS.find((s) => s.key === asked) ?? SECTIONS[0];

  root.innerHTML = `<div class="stack admin" data-density="compact">
    <header class="page__heading">
      <h1>${esc(t('hdApp.nav.admin'))}</h1>
      <p class="page__lead">${esc(t('hdApp.admin.lead'))}</p>
    </header>
    <nav class="subnav" aria-label="${esc(t('hdApp.admin.sections'))}">
      ${SECTIONS.map(
        (s) =>
          `<a class="subnav__link" href="#admin/${s.key}" ${
            s.key === section.key ? 'aria-current="page"' : ''
          }>${esc(t(s.label))}</a>`
      ).join('')}
    </nav>
    <div id="adminSection" class="stack"></div>
  </div>`;

  const module = await import(`./administration/${section.key}.js`);
  return module.render(root.querySelector('#adminSection'), ctx);
}
