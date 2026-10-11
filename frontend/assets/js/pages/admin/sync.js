/**
 * pages/admin/sync.js — the directory sync: run it now, see the history, and
 * read the latest run's warnings. HoldingAdmin only; the server enforces it.
 *
 * A run is started in the background (202) and this page follows it by
 * asking for the history every couple of seconds until nothing is running.
 * A run stopped by the 20% safety limit offers one confirmed rerun.
 */

import { ApiError, api } from '../../api.js';
import { confirmDialog } from '../../components/dialog.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { showToast } from '../../components/toast.js';
import { formatDateTime, formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';
import { personName } from './shared.js';

const POLL_MS = 2000;
/** The history is a glance, not an archive: older runs stay in the audit log. */
const SHOWN_RUNS = 8;
const STATUS_BADGE = { running: 'info', success: 'success', failed: 'danger' };

/** One warning as a sentence. */
function warningText(w) {
  const key = `admin.sync.warn.${w.code}`;
  const known = t(key) !== key;
  return known
    ? t(key, {
        name: w.name ?? '',
        companyCode: w.companyCode ?? '',
        count: w.count ?? '',
        email: w.email ?? '',
        domain: w.domain ?? '',
        id: w.id ?? '',
        message: w.message ?? '',
        wouldDeactivate: w.wouldDeactivate ?? '',
        active: w.active ?? '',
      })
    : t('admin.sync.warn.other', { code: w.code });
}

const statusBadge = (status) =>
  `<span class="badge badge--${STATUS_BADGE[status] ?? 'info'}">${esc(
    t(`admin.sync.status.${status}`)
  )}</span>`;

/**
 * @param {HTMLElement} root
 */
export async function render(root) {
  let timer = null;
  let items = [];
  let gone = false;

  async function fetchHistory() {
    const result = await api('/api/admin/directory/sync', { quiet: true });
    items = result.items;
  }

  const latest = () => items[0] ?? null;
  const running = () => latest()?.status === 'running';

  function runRow(run) {
    const by = run.requestedBy
      ? personName(run.requestedBy)
      : t(`admin.sync.source.${run.source}`);
    return `<tr>
      <td data-label="${esc(t('admin.sync.col.started'))}">${esc(formatDateTime(run.startedAt))}</td>
      <td data-label="${esc(t('admin.sync.col.source'))}">${esc(by)}</td>
      <td data-label="${esc(t('admin.sync.col.status'))}">${statusBadge(run.status)}</td>
      <td class="table__num" data-label="${esc(t('admin.sync.col.created'))}">${esc(formatNumber(run.created))}</td>
      <td class="table__num" data-label="${esc(t('admin.sync.col.updated'))}">${esc(formatNumber(run.updated))}</td>
      <td class="table__num" data-label="${esc(t('admin.sync.col.deactivated'))}">${esc(formatNumber(run.deactivated))}</td>
      <td class="table__num" data-label="${esc(t('admin.sync.col.warnings'))}">${esc(formatNumber(run.warningCount))}</td>
    </tr>`;
  }

  function draw() {
    const last = latest();
    const limit =
      last?.status === 'failed' && last.warnings.find((w) => w.code === 'deactivation_limit');
    const warnings = last?.warnings ?? [];

    root.innerHTML = `<div class="stack">
      <p class="admin-lead">${esc(t('admin.sync.lead'))}</p>

      <section class="card sync-run" aria-labelledby="syncLatest">
        <div class="cluster cluster--between">
          <div>
            <h2 class="card__title" id="syncLatest">${esc(t('admin.sync.latest'))}</h2>
            <p class="sync-run__line" role="status" aria-live="polite">${
              last
                ? `${esc(formatDateTime(last.startedAt))} ${statusBadge(last.status)}`
                : esc(t('admin.sync.historyEmpty'))
            }</p>
            ${running() ? `<p class="field__help">${esc(t('admin.sync.runningNote'))}</p>` : ''}
          </div>
          <button type="button" class="btn btn--primary" id="syncRun" ${
            running() ? 'disabled aria-busy="true"' : ''
          }>
            ${icon('refresh', 'btn__icon')}
            <span class="btn__label">${esc(
              t(running() ? 'admin.sync.running' : 'admin.sync.runNow')
            )}</span>
          </button>
        </div>
        ${
          limit
            ? `<div class="sync-run__limit">
                 <p>${esc(warningText(limit))}</p>
                 <button type="button" class="btn btn--danger" id="syncAllow">
                   <span class="btn__label">${esc(t('admin.sync.allowButton'))}</span>
                 </button>
               </div>`
            : ''
        }
      </section>

      <section class="card" aria-labelledby="syncWarnHead">
        <h2 class="card__title" id="syncWarnHead">${esc(t('admin.sync.warningsTitle'))}</h2>
        ${
          warnings.length === 0
            ? `<p class="field__help">${esc(t('admin.sync.warningsNone'))}</p>`
            : `<ul class="sync-warnings">${warnings
                .map((w) => `<li>${esc(warningText(w))}</li>`)
                .join('')}</ul>`
        }
      </section>

      <section class="stack" aria-labelledby="syncHistoryHead">
        <h2 class="card__title" id="syncHistoryHead">${esc(t('admin.sync.history'))}</h2>
        ${
          items.length === 0
            ? `<p class="field__help">${esc(t('admin.sync.historyEmpty'))}</p>`
            : `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
                 aria-label="${esc(t('admin.sync.history'))}">
                <table class="table">
                  <caption class="u-visually-hidden">${esc(t('admin.sync.history'))}</caption>
                  <thead><tr>
                    ${['started', 'source', 'status']
                      .map((k) => `<th scope="col">${esc(t(`admin.sync.col.${k}`))}</th>`)
                      .join('')}
                    ${['created', 'updated', 'deactivated', 'warnings']
                      .map(
                        (k) =>
                          `<th scope="col" class="table__num">${esc(t(`admin.sync.col.${k}`))}</th>`
                      )
                      .join('')}
                  </tr></thead>
                  <tbody>${items.slice(0, SHOWN_RUNS).map(runRow).join('')}</tbody>
                </table>
              </div>`
        }
      </section>
    </div>`;

    root.querySelector('#syncRun').addEventListener('click', () => start(false));
    root.querySelector('#syncAllow')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: t('admin.sync.allowTitle'),
        body: t('admin.sync.allowBody', {
          count: limit.wouldDeactivate,
          active: limit.active,
        }),
        confirmLabel: t('admin.sync.allowConfirm'),
      });
      if (ok) start(true);
    });
  }

  function follow() {
    clearTimeout(timer);
    if (gone || !running()) return;
    timer = setTimeout(async () => {
      try {
        await fetchHistory();
      } catch {
        // A missed poll is not worth a message; the next one will do.
      }
      if (gone) return;
      const focus = document.activeElement?.id;
      draw();
      if (focus) root.querySelector(`#${CSS.escape(focus)}`)?.focus();
      follow();
    }, POLL_MS);
  }

  async function start(allowLargeDeactivation) {
    try {
      await api('/api/admin/directory/sync', {
        method: 'POST',
        body: { allowLargeDeactivation },
        quiet: true,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'sync_in_progress') {
        showToast({
          tone: 'warning',
          titleKey: 'admin.sync.running',
          textKey: 'admin.sync.inProgress',
        });
      } else {
        showToast({
          tone: 'danger',
          titleKey: 'error.unknown.title',
          textKey: 'error.unknown.text',
        });
      }
    }
    try {
      await fetchHistory();
    } catch {
      return;
    }
    draw();
    root.querySelector('#syncRun')?.focus();
    follow();
  }

  try {
    await fetchHistory();
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root));
    return undefined;
  }
  draw();
  follow();

  return () => {
    gone = true;
    clearTimeout(timer);
  };
}
