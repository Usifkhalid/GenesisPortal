/**
 * pages/admin/quality.js — directory data quality: for each company, what is
 * missing from its people's records (company name, department, job title,
 * manager, business phone, Arabic name), the department names Graph used that
 * the company does not have, and, for a HoldingAdmin, the people no company
 * could be found for. The CSV export lists the same gaps.
 *
 * Counts are real; each list is capped by the server, which says so.
 *
 * It is also where Arabic names are imported: a CSV of email and arabicName
 * is read by the server and shown as a preview (what changes, which emails it
 * does not know, which rows it skipped); only "Apply" writes anything.
 */

import { api } from '../../api.js';
import { describedBy, field, setBusy, setFieldError } from '../../components/form.js';
import { showToast } from '../../components/toast.js';
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

/** How many rows of a preview list are drawn; the counts stay whole. */
const PREVIEW_ROWS = 100;

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

  /* ----------------------------------------------------- Arabic names */
  const n = (value) => formatNumber(value);

  function previewTable(titleKey, columns, rows, total) {
    const title = t(titleKey);
    return `<h3 class="dq-subhead">${esc(title)}
        <span class="dir-panel__count">${esc(n(total))}</span></h3>
      <div class="table-wrap" data-density="compact" tabindex="0" role="region"
        aria-label="${esc(title)}">
        <table class="table">
          <caption class="u-visually-hidden">${esc(title)}</caption>
          <thead><tr>${columns
            .map((c) => `<th scope="col">${esc(c.label)}</th>`)
            .join('')}</tr></thead>
          <tbody>${rows
            .map(
              (row) =>
                `<tr>${columns
                  .map((c) => `<td data-label="${esc(c.label)}">${c.cell(row)}</td>`)
                  .join('')}</tr>`
            )
            .join('')}</tbody>
        </table>
      </div>
      ${
        total > rows.length
          ? `<p class="field__help">${esc(
              t('admin.quality.import.more', { shown: n(rows.length), count: n(total) })
            )}</p>`
          : ''
      }`;
  }

  const ltr = (text) => `<span dir="ltr">${esc(text)}</span>`;
  const arabic = (text) =>
    text
      ? `<span lang="ar" dir="rtl">${esc(text)}</span>`
      : esc(t('admin.quality.import.empty'));
  const col = (key, cell) => ({ label: t(`admin.quality.import.col.${key}`), cell });

  function previewHtml(result) {
    const parts = [
      `<p class="dq-import__summary">${esc(
        t('admin.quality.import.summary', {
          rows: n(result.rows),
          changes: n(result.changes.length),
          unchanged: n(result.unchanged),
          unknown: n(result.unknown.length),
          invalid: n(result.invalid.length),
        })
      )}</p>`,
    ];
    if (result.outOfScope.length > 0) {
      parts.push(
        `<p class="field__help">${esc(
          t('admin.quality.import.outOfScope', { count: n(result.outOfScope.length) })
        )}</p>`
      );
    }
    if (result.changes.length > 0) {
      parts.push(
        previewTable(
          'admin.quality.import.changesTitle',
          [
            col('person', (c) => esc(c.displayNameEn)),
            col('email', (c) => ltr(c.email)),
            col('current', (c) => arabic(c.from)),
            col('next', (c) => arabic(c.to)),
          ],
          result.changes.slice(0, PREVIEW_ROWS),
          result.changes.length
        )
      );
    } else {
      parts.push(`<p class="field__help">${esc(t('admin.quality.import.noChanges'))}</p>`);
    }
    if (result.unknown.length > 0) {
      parts.push(
        previewTable(
          'admin.quality.import.unknownTitle',
          [col('email', (email) => ltr(email))],
          result.unknown.slice(0, PREVIEW_ROWS),
          result.unknown.length
        )
      );
    }
    if (result.invalid.length > 0) {
      parts.push(
        previewTable(
          'admin.quality.import.invalidTitle',
          [
            col('line', (r) => esc(n(r.line))),
            col('email', (r) => ltr(r.email)),
            col('reason', (r) => esc(t(`admin.quality.import.reason.${r.reason}`))),
          ],
          result.invalid.slice(0, PREVIEW_ROWS),
          result.invalid.length
        )
      );
    }
    if (result.changes.length > 0) {
      parts.push(`<div>
        <button type="button" class="btn btn--primary" id="dqImportApply">
          <span class="btn__label">${esc(
            t('admin.quality.import.apply', { count: n(result.changes.length) })
          )}</span>
        </button>
      </div>`);
    }
    return parts.join('');
  }

  function wireImport() {
    const form = root.querySelector('#dqImportForm');
    const input = root.querySelector('#dqImportFile');
    const out = root.querySelector('#dqImportResult');
    const previewButton = form.querySelector('[type="submit"]');

    const fail = (err) => {
      const known = ['csv_invalid', 'csv_too_many_rows'].includes(err?.code)
        ? err.code
        : err?.status === 413
          ? 'tooLarge'
          : 'failed';
      setFieldError(form, 'dqImportFile', t(`admin.quality.import.error.${known}`));
      input.focus();
    };

    const send = (step, file) =>
      api(`/api/admin/directory/arabic-names/${step}`, {
        method: 'POST',
        body: file,
        quiet: true,
      });

    // A new file makes the preview on screen a preview of something else.
    input.addEventListener('change', () => {
      out.replaceChildren();
      setFieldError(form, 'dqImportFile', '');
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFieldError(form, 'dqImportFile', '');
      out.replaceChildren();
      const file = input.files[0];
      if (!file) {
        setFieldError(form, 'dqImportFile', t('admin.quality.import.chooseFile'));
        input.focus();
        return;
      }

      setBusy(previewButton, true, t('admin.quality.import.reading'));
      let result;
      try {
        result = await send('preview', file);
      } catch (err) {
        fail(err);
        return;
      } finally {
        setBusy(previewButton, false, t('admin.quality.import.preview'));
      }
      out.innerHTML = previewHtml(result);

      const apply = out.querySelector('#dqImportApply');
      apply?.addEventListener('click', async () => {
        setBusy(apply, true, t('admin.quality.import.applying'));
        let applied;
        try {
          applied = await send('apply', file);
        } catch (err) {
          out.replaceChildren();
          fail(err);
          return;
        }
        const text = t('admin.quality.import.doneText', { count: n(applied.applied) });
        showToast({ tone: 'success', titleKey: 'admin.quality.import.done', text });
        out.innerHTML = `<p class="dq-import__summary" id="dqImportDone">${esc(text)}</p>`;
        form.reset();
        // "No Arabic name" in the report below has just changed.
        draw();
      });
    });
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

    <section class="card dq-company dq-import" aria-labelledby="dqImportTitle">
      <h2 class="card__title" id="dqImportTitle">${esc(t('admin.quality.import.title'))}</h2>
      <p class="field__help">${esc(t('admin.quality.import.help'))}</p>
      <form class="dq-import__form" id="dqImportForm" novalidate>
        ${field({
          id: 'dqImportFile',
          label: t('admin.quality.import.file'),
          help: t('admin.quality.import.fileHelp'),
          control: `<input class="input" id="dqImportFile" type="file" accept=".csv,text/csv"
            aria-describedby="${describedBy('dqImportFile')}" />`,
        })}
        <div>
          <button type="submit" class="btn btn--secondary">
            <span class="btn__label">${esc(t('admin.quality.import.preview'))}</span>
          </button>
        </div>
      </form>
      <div class="stack stack--tight" id="dqImportResult" role="status" aria-live="polite"></div>
    </section>
  </div>`;

  wireImport();

  root.querySelector('#dqCompany')?.addEventListener('change', (event) => {
    selected = event.target.value;
    draw();
  });

  await draw();
  return undefined;
}
