/**
 * pages/helpdesk/reports.js — #reports?from=&to=: what came in over a range of
 * days and how the team did against its targets (GET /api/helpdesk/reports).
 *
 * A label strip with the totals and the averages, then one table per way of
 * counting: status, priority, category, company, location, and the SLA
 * (first response and resolution: met, breached, still running). The CSV is
 * the same range, one row per ticket, straight from the API.
 *
 * Times are business hours on the team's clock (Sunday to Thursday, 08:00 to
 * 17:00 unless IT settings say otherwise), as the targets are.
 */

import { api } from '../../api.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { addDays, cairoToday, formatDay, formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { pair, priorityLabel, statusLabel } from '../tickets/shared.js';

const DEFAULT_DAYS = 30;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "6 h 30 min" of business time; "—" when nothing was measured. */
function businessTime(minutes) {
  if (minutes == null) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) {
    return t('tk.dur.hourMin', { hours: formatNumber(hours), minutes: formatNumber(rest) });
  }
  if (hours) return t('tk.dur.hour', { hours: formatNumber(hours) });
  return t('tk.dur.min', { minutes: formatNumber(rest) });
}

/** "92%" of the decided ones (met or breached); "—" when none is decided yet. */
function share(met, breached) {
  const decided = met + breached;
  return decided ? `${formatNumber(Math.round((met / decided) * 100))}%` : '—';
}

/** One table of counts: a name column and a number column. */
function countTable(id, title, rows) {
  const body = rows.length
    ? rows
        .map(
          (r) => `<tr>
            <th scope="row">${r.name}</th>
            <td class="hd-report__num" data-label="${esc(t('hd.reports.tickets'))}">${esc(
              formatNumber(r.count)
            )}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="2">${esc(t('hd.reports.none'))}</td></tr>`;
  return `<section class="card hd-report__card" aria-labelledby="${id}">
    <h2 class="card__title" id="${id}">${esc(title)}</h2>
    <div class="table-wrap" data-density="compact">
      <table class="table">
        <thead><tr>
          <th scope="col">${esc(title)}</th>
          <th scope="col" class="hd-report__num">${esc(t('hd.reports.tickets'))}</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </section>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../../router.js').Match }} ctx
 */
export async function render(root, ctx) {
  const asked = ctx.route.query;
  const today = cairoToday();
  const state = {
    to: YMD.test(asked.get('to') ?? '') ? asked.get('to') : today,
    from: '',
  };
  state.from = YMD.test(asked.get('from') ?? '')
    ? asked.get('from')
    : addDays(state.to, -(DEFAULT_DAYS - 1));

  root.innerHTML = `<div class="stack hd-report" data-density="compact">
    <header class="page__heading">
      <h1>${esc(t('hd.nav.reports'))}</h1>
      <p class="page__lead">${esc(t('hd.lead.reports'))}</p>
    </header>
    <form class="card admin-filters hd-report__range" id="hdRange" novalidate
      aria-label="${esc(t('hd.reports.range'))}">
      <div class="field">
        <label class="field__label" for="hdFrom">${esc(t('hd.reports.from'))}</label>
        <input class="input" id="hdFrom" name="from" type="date" required value="${esc(state.from)}" />
      </div>
      <div class="field">
        <label class="field__label" for="hdTo">${esc(t('hd.reports.to'))}</label>
        <input class="input" id="hdTo" name="to" type="date" required value="${esc(state.to)}" />
      </div>
      <div class="btn-row hd-report__actions">
        <button type="submit" class="btn btn--primary btn--sm">
          <span class="btn__label">${esc(t('hd.reports.show'))}</span>
        </button>
        <a class="btn btn--secondary btn--sm" id="hdCsv" download>
          ${icon('download', 'btn__icon')}<span class="btn__label">${esc(t('hd.reports.csv'))}</span>
        </a>
      </div>
    </form>
    <p class="field__error" id="hdRangeError" role="alert" hidden></p>
    <div id="hdReport" class="stack" aria-live="polite"></div>
  </div>`;

  const form = root.querySelector('#hdRange');
  const host = root.querySelector('#hdReport');
  const csv = root.querySelector('#hdCsv');
  const error = root.querySelector('#hdRangeError');
  let turn = 0;

  const params = () => new URLSearchParams({ from: state.from, to: state.to }).toString();

  function draw(r) {
    const fr = r.sla.firstResponse;
    const rs = r.sla.resolution;
    const summary = [
      pair(t('hd.reports.total'), esc(formatNumber(r.total))),
      pair(t('hd.reports.firstResponseMet'), esc(share(fr.met, fr.breached))),
      pair(t('hd.reports.resolutionMet'), esc(share(rs.met, rs.breached))),
      pair(
        t('hd.reports.avgFirstResponse'),
        esc(businessTime(r.averages.firstResponseMinutes))
      ),
      pair(t('hd.reports.avgResolve'), esc(businessTime(r.averages.resolveMinutes))),
    ].join('');

    const named = (row) =>
      row.id
        ? esc(localized(row))
        : `<span class="hd-report__muted">${esc(t('hd.reports.noneSet'))}</span>`;
    const slaRow = (key, s) => `<tr>
      <th scope="row">${esc(t(`hd.reports.${key}`))}</th>
      <td class="hd-report__num" data-label="${esc(t('hd.reports.met'))}">${esc(formatNumber(s.met))}</td>
      <td class="hd-report__num" data-label="${esc(t('hd.reports.breached'))}">${esc(formatNumber(s.breached))}</td>
      <td class="hd-report__num" data-label="${esc(t('hd.reports.pending'))}">${esc(formatNumber(s.pending))}</td>
    </tr>`;

    host.innerHTML = `<section class="card" aria-labelledby="hdSummaryTitle">
        <h2 class="card__title" id="hdSummaryTitle">${esc(
          t('hd.reports.summary', {
            from: formatDay(r.from, { weekday: 'short', year: true }),
            to: formatDay(r.to, { weekday: 'short', year: true }),
          })
        )}</h2>
        <dl class="labelstrip labelstrip--compact">${summary}</dl>
        <p class="hd-report__note">${esc(t('hd.reports.businessNote'))}</p>
      </section>
      <section class="card hd-report__card" aria-labelledby="hdSlaTitle">
        <h2 class="card__title" id="hdSlaTitle">${esc(t('hd.reports.sla'))}</h2>
        <div class="table-wrap" data-density="compact">
          <table class="table">
            <thead><tr>
              <th scope="col">${esc(t('hd.reports.target'))}</th>
              <th scope="col" class="hd-report__num">${esc(t('hd.reports.met'))}</th>
              <th scope="col" class="hd-report__num">${esc(t('hd.reports.breached'))}</th>
              <th scope="col" class="hd-report__num">${esc(t('hd.reports.pending'))}</th>
            </tr></thead>
            <tbody>${slaRow('firstResponse', fr)}${slaRow('resolution', rs)}</tbody>
          </table>
        </div>
      </section>
      <div class="hd-report__grid">
        ${countTable(
          'hdByStatus',
          t('hd.reports.byStatus'),
          r.byStatus.map((s) => ({ name: esc(statusLabel(s.status, true)), count: s.count }))
        )}
        ${countTable(
          'hdByPriority',
          t('hd.reports.byPriority'),
          r.byPriority.map((p) => ({
            name: esc(priorityLabel(p.priority, true)),
            count: p.count,
          }))
        )}
        ${countTable(
          'hdByCategory',
          t('hd.reports.byCategory'),
          r.byCategory.map((c) => ({ name: named(c), count: c.count }))
        )}
        ${countTable(
          'hdByCompany',
          t('hd.reports.byCompany'),
          r.byCompany.map((c) => ({ name: named(c), count: c.count }))
        )}
        ${countTable(
          'hdByLocation',
          t('hd.reports.byLocation'),
          r.byLocation.map((l) => ({ name: named(l), count: l.count }))
        )}
      </div>`;
  }

  async function load() {
    const mine = ++turn;
    history.replaceState(null, '', `#reports?${params()}`);
    csv.href = `/api/helpdesk/reports/export.csv?${params()}`;
    host.setAttribute('aria-busy', 'true');
    try {
      const report = await api(`/api/helpdesk/reports?${params()}`, { quiet: true });
      if (mine !== turn) return;
      draw(report);
    } catch {
      if (mine !== turn) return;
      host.innerHTML = loadFailedNotice();
      host.querySelector('[data-retry]').addEventListener('click', load);
    }
    host.setAttribute('aria-busy', 'false');
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const from = form.elements.from.value;
    const to = form.elements.to.value;
    const bad = !YMD.test(from) || !YMD.test(to) || from > to;
    error.hidden = !bad;
    error.textContent = bad ? t('hd.reports.badRange') : '';
    form.elements.from.setAttribute('aria-invalid', String(bad));
    form.elements.to.setAttribute('aria-invalid', String(bad));
    if (bad) return;
    state.from = from;
    state.to = to;
    load();
  });

  await load();
  return undefined;
}
