/**
 * pages/admin/quality.js — directory data quality: for each company, what is
 * missing from its people's records (company name, department, job title,
 * manager, business phone, Arabic name), the department names Graph used that
 * the company does not have, and, for a HoldingAdmin, the people no company
 * could be found for. The CSV export lists the same gaps.
 *
 * Counts are real; each list is capped by the server, which says so.
 */

import { api } from '../../api.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { displayName } from '../../components/person.js';
import { formatDateTime, formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';

const ISSUES = [
  'missingCompany',
  'missingDepartment',
  'missingJobTitle',
  'missingManager',
  'missingBusinessPhone',
  'missingArabicName',
];

/**
 * @param {HTMLElement} root
 * @param {{ scope: { holdingAdmin: boolean, companies: object[] } }} options
 */
export async function render(root, { scope }) {
  let selected = '';
  const choices = scope.companies.filter((c) => c.isActive);

  function exportHref() {
    const qs = selected ? `?companyId=${encodeURIComponent(selected)}` : '';
    return `/api/admin/directory/quality/export.csv${qs}`;
  }

  function issueHtml(entry, key) {
    const count = entry.counts[key];
    const label = t(`admin.quality.issue.${key}`);
    if (count === 0) {
      return `<li class="dq-issue dq-issue--none">
        <span class="dq-issue__label">${esc(label)}</span>
        <span class="badge badge--success">${esc(t('admin.quality.none'))}</span>
      </li>`;
    }
    const people = entry.lists[key];
    return `<li class="dq-issue">
      <details>
        <summary class="dq-issue__summary">
          <span class="dq-issue__label">${esc(label)}</span>
          <span class="badge badge--warning" aria-label="${esc(
            t('admin.quality.issueCount', { label, count })
          )}">${esc(formatNumber(count))}</span>
        </summary>
        <ul class="dq-people">
          ${people
            .map(
              (p) => `<li class="dq-people__row">
                <span class="dq-people__name">${esc(displayName(p))}</span>
                <span class="dq-people__meta" dir="ltr">${esc(p.email)}</span>
                ${p.jobTitle ? `<span class="dq-people__meta">${esc(p.jobTitle)}</span>` : ''}
              </li>`
            )
            .join('')}
        </ul>
        ${
          count > people.length
            ? `<p class="field__help">${esc(
                t('admin.quality.more', { shown: people.length, count })
              )}</p>`
            : ''
        }
      </details>
    </li>`;
  }

  function unmatchedHtml(entry) {
    if (entry.unmatchedDepartments.length === 0) {
      return `<p class="field__help">${esc(t('admin.quality.unmatchedNone'))}</p>`;
    }
    return `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
        aria-label="${esc(t('admin.quality.unmatchedTitle'))}">
      <table class="table">
        <caption class="u-visually-hidden">${esc(t('admin.quality.unmatchedTitle'))}</caption>
        <thead><tr>
          <th scope="col">${esc(t('admin.quality.col.department'))}</th>
          <th scope="col" class="table__num">${esc(t('admin.quality.col.count'))}</th>
        </tr></thead>
        <tbody>${entry.unmatchedDepartments
          .map(
            (d) => `<tr>
              <td data-label="${esc(t('admin.quality.col.department'))}">${esc(d.name)}</td>
              <td class="table__num" data-label="${esc(t('admin.quality.col.count'))}">${esc(
                formatNumber(d.count)
              )}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table>
    </div>`;
  }

  function companyHtml(entry) {
    return `<section class="card dq-company" aria-labelledby="dq-${esc(entry.company.id)}">
      <div class="card__header">
        <h2 class="card__title" id="dq-${esc(entry.company.id)}">
          <span class="admin-code">${esc(entry.company.code)}</span>
          ${esc(localized(entry.company))}
        </h2>
        <p class="dq-company__count">${esc(
          t('admin.quality.people', { count: formatNumber(entry.activeUsers) })
        )}</p>
      </div>
      <ul class="dq-issues">${ISSUES.map((key) => issueHtml(entry, key)).join('')}</ul>
      ${
        entry.unmatchedDepartments.length
          ? `<h3 class="dq-subhead">${esc(t('admin.quality.unmatchedTitle'))}</h3>
             <p class="field__help">${esc(t('admin.quality.unmatchedHelp'))}</p>
             ${unmatchedHtml(entry)}`
          : `<p class="field__help">${esc(t('admin.quality.unmatchedNone'))}</p>`
      }
    </section>`;
  }

  function unplacedHtml(people) {
    return `<section class="card dq-company" aria-labelledby="dqUnplaced">
      <h2 class="card__title" id="dqUnplaced">${esc(t('admin.quality.unplacedTitle'))}</h2>
      <p class="field__help">${esc(t('admin.quality.unplacedHelp'))}</p>
      ${
        people.length === 0
          ? `<p class="field__help">${esc(t('admin.quality.unplacedNone'))}</p>`
          : `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
               aria-label="${esc(t('admin.quality.unplacedTitle'))}">
              <table class="table">
                <caption class="u-visually-hidden">${esc(t('admin.quality.unplacedTitle'))}</caption>
                <thead><tr>
                  <th scope="col">${esc(t('admin.quality.col.name'))}</th>
                  <th scope="col">${esc(t('admin.quality.col.email'))}</th>
                  <th scope="col">${esc(t('admin.quality.col.company'))}</th>
                  <th scope="col">${esc(t('admin.quality.col.domain'))}</th>
                </tr></thead>
                <tbody>${people
                  .map(
                    (p) => `<tr>
                      <td data-label="${esc(t('admin.quality.col.name'))}">${esc(p.displayName ?? '')}</td>
                      <td data-label="${esc(t('admin.quality.col.email'))}" dir="ltr">${esc(p.email)}</td>
                      <td data-label="${esc(t('admin.quality.col.company'))}">${esc(p.companyName ?? '—')}</td>
                      <td data-label="${esc(t('admin.quality.col.domain'))}" dir="ltr">${esc(p.domain ?? '')}</td>
                    </tr>`
                  )
                  .join('')}</tbody>
              </table>
            </div>`
      }
    </section>`;
  }

  async function draw() {
    const body = root.querySelector('#dqBody');
    body.setAttribute('aria-busy', 'true');
    let report;
    try {
      const qs = selected ? `?companyId=${encodeURIComponent(selected)}` : '';
      report = await api(`/api/admin/directory/quality${qs}`, { quiet: true });
    } catch {
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = loadFailedNotice();
      body.querySelector('[data-retry]').addEventListener('click', draw);
      return;
    }

    root.querySelector('#dqExport').href = exportHref();
    root.querySelector('#dqLastRun').textContent = report.latestRun
      ? `${t('admin.quality.lastRun')}: ${formatDateTime(report.latestRun.startedAt)} · ${t(
          `admin.sync.status.${report.latestRun.status}`
        )}`
      : t('admin.quality.never');

    body.setAttribute('aria-busy', 'false');
    body.innerHTML = `${report.companies.map(companyHtml).join('')}${
      scope.holdingAdmin && !selected ? unplacedHtml(report.unplaced) : ''
    }`;
  }

  root.innerHTML = `<div class="stack">
    <p class="admin-lead">${esc(t('admin.quality.lead'))}</p>
    <div class="admin__bar">
      ${
        choices.length > 1
          ? `<div class="field">
               <label class="field__label" for="dqCompany">${esc(
                 t('admin.quality.companyLabel')
               )}</label>
               <select class="select" id="dqCompany">
                 <option value="">${esc(t('admin.quality.allCompanies'))}</option>
                 ${choices
                   .map((c) => `<option value="${esc(c.id)}">${esc(localized(c))}</option>`)
                   .join('')}
               </select>
             </div>`
          : ''
      }
      <a class="btn btn--secondary" id="dqExport" href="${esc(exportHref())}" download>
        ${icon('download', 'btn__icon')}
        <span class="btn__label">${esc(t('admin.quality.export'))}</span>
      </a>
    </div>
    <p class="dq-lastrun" id="dqLastRun"></p>
    <div class="stack" id="dqBody" aria-busy="true"></div>
  </div>`;

  root.querySelector('#dqCompany')?.addEventListener('change', (event) => {
    selected = event.target.value;
    draw();
  });

  await draw();
  return undefined;
}
