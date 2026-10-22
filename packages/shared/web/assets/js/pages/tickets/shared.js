/**
 * pages/tickets/shared.js — what the helpdesk screens have in common: how a
 * status, an urgency and a due time are written for a requester and for IT,
 * the calls every view makes, attachments (checked here, sent with progress),
 * and what each refusal says.
 *
 * A requester sees plain words: "How urgent", "Reply expected by". The codes
 * (P1..P4) and the clock words (SLA, breached) are for IT views only, and
 * every function that writes one takes `staff`.
 */

import { ApiError, api, errorKey, upload } from '../../api.js';
import { icon } from '../../components/icons.js';
import { displayName } from '../../components/person.js';
import { cairoYmd, formatDay, formatNumber, formatTime } from '../../format.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
/** Open until the requester says it is solved: a Resolved ticket is still open (D143). */
export const OPEN_STATUSES = ['New', 'Open', 'Pending', 'Resolved'];
/** What an agent may set by hand. Closing is the requester's, or a Lead's with a reason. */
export const SETTABLE = ['Open', 'Pending', 'Resolved'];

/** Each status has its own tone and its own silhouette: colour is never alone. */
const STATUS = {
  New: { tone: '', icon: 'statusOpen' },
  Open: { tone: 'badge--info', icon: 'statusProgress' },
  Pending: { tone: 'badge--warning', icon: 'statusWaiting' },
  Resolved: { tone: 'badge--success', icon: 'statusResolved' },
  Closed: { tone: '', icon: 'statusResolved' },
};

const PRIORITY_TONE = { P1: 'badge--danger', P2: 'badge--warning', P3: '', P4: '' };

/* ----------------------------------------------------------------- writing */

/**
 * The status in words. Rows and history written before D143 still say
 * WaitingOnRequester: it reads as Pending. The second argument is kept so the
 * callers that say who is reading need no change; both read the same words.
 */
export const statusLabel = (status) =>
  t(`ticket.status.${status === 'WaitingOnRequester' ? 'Pending' : status}`);

export function statusBadge(status) {
  const look = STATUS[status === 'WaitingOnRequester' ? 'Pending' : status] ?? STATUS.New;
  return `<span class="badge ${look.tone}">${icon(look.icon, 'badge__icon')}<span>${esc(
    statusLabel(status)
  )}</span></span>`;
}

/** "Urgent" for a requester, "P1 · Urgent" for IT. */
export const priorityLabel = (priority, staff = false) =>
  staff
    ? `${priority} · ${t(`ticket.priority.${priority}`)}`
    : t(`ticket.priority.${priority}`);

export function priorityBadge(priority, { staff = false } = {}) {
  return `<span class="badge ${PRIORITY_TONE[priority] ?? ''}"><span>${esc(
    priorityLabel(priority, staff)
  )}</span></span>`;
}

/** A person's name, or the system's for an event nobody did. */
export const who = (person) => (person ? displayName(person) : t('tk.system'));

/** An instant as "Sun, 11 Oct 14:30". */
export function dueDate(value) {
  return `${formatDay(cairoYmd(value), { weekday: 'short' })} ${formatTime(value)}`;
}

/** "3 h 10 min", "45 min", "2 d 4 h": a span of milliseconds, rounded to the minute. */
export function spanText(ms) {
  const total = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days)
    return t('tk.dur.dayHour', { days: formatNumber(days), hours: formatNumber(hours) });
  if (hours && !minutes) return t('tk.dur.hour', { hours: formatNumber(hours) });
  if (hours)
    return t('tk.dur.hourMin', { hours: formatNumber(hours), minutes: formatNumber(minutes) });
  return t('tk.dur.min', { minutes: formatNumber(minutes) });
}

const SLA_TONE = {
  on_track: { tone: '', icon: 'clock' },
  at_risk: { tone: 'badge--warning', icon: 'clock' },
  breached: { tone: 'badge--danger', icon: 'statusOverdue' },
  paused: { tone: 'badge--info', icon: 'statusWaiting' },
  met: { tone: 'badge--success', icon: 'statusResolved' },
  missed: { tone: 'badge--danger', icon: 'statusOverdue' },
};

/** The SLA clock for IT: time left, time over, paused, met or missed. */
export function slaBadge(ticket, now = Date.now()) {
  const { state, dueAt } = ticket.sla;
  const look = SLA_TONE[state] ?? SLA_TONE.on_track;
  let text = t(`tk.sla.${state}`);
  if (dueAt && ['on_track', 'at_risk'].includes(state)) {
    text = t('tk.sla.left', { span: spanText(new Date(dueAt).getTime() - now) });
  } else if (dueAt && state === 'breached') {
    text = t('tk.sla.over', { span: spanText(now - new Date(dueAt).getTime()) });
  }
  return `<span class="badge ${look.tone}">${icon(look.icon, 'badge__icon')}<span>${esc(
    text
  )}</span></span>`;
}

/**
 * What a requester is told about timing, as a label and a value.
 * @returns {{ label: string, value: string }}
 */
export function expectedBy(ticket) {
  const { state, dueAt } = ticket.sla;
  if (ticket.status === 'Closed') {
    const when = ticket.closedAt ?? ticket.resolvedAt;
    return { label: t('tk.expect.closedOn'), value: when ? dueDate(when) : '—' };
  }
  if (ticket.status === 'Resolved') {
    return {
      label: t('tk.expect.resolvedOn'),
      value: ticket.resolvedAt ? dueDate(ticket.resolvedAt) : '—',
    };
  }
  if (state === 'paused')
    return { label: t('tk.expect.reply'), value: t('tk.expect.waitingOnYou') };
  const label = ticket.firstRespondedAt ? t('tk.expect.update') : t('tk.expect.reply');
  return { label, value: dueAt ? dueDate(dueAt) : '—' };
}

/** One key/value pair of a label strip. */
export function pair(key, value, extra = '') {
  return `<div class="labelstrip__pair${extra ? ` ${extra}` : ''}">
    <dt class="labelstrip__key">${esc(key)}</dt>
    <dd class="labelstrip__value">${value}</dd>
  </div>`;
}

/** The ticket number, set left to right in either language. */
export const numberHtml = (number) => `<bdi dir="ltr" class="ticket-no">${esc(number)}</bdi>`;

/** Text with its line breaks, safely. */
export const paragraphs = (text) =>
  esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

/** An icon for a category, from what its English name says; a question mark otherwise. */
const CATEGORY_ICONS = [
  [/laptop|computer|\bpc\b|desktop/i, 'laptop'],
  [/print|scan/i, 'printer'],
  [/mail|teams|outlook/i, 'mail'],
  [/account|password|login|access/i, 'key'],
  [/network|wi-?fi|vpn|internet/i, 'wifi'],
  [/software|install|app/i, 'apps'],
  [/phone|mobile|sim/i, 'phone'],
  [/equipment|hardware|new /i, 'box'],
];
export function categoryIcon(category) {
  const name = category.nameEn ?? '';
  return CATEGORY_ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? 'help';
}

/* ------------------------------------------------------------------- errors */

const CODE_KEYS = {
  ticket_closed: 'tk.error.closed',
  reopen_window_closed: 'tk.error.reopenWindow',
  not_resolved: 'tk.error.notResolved',
  too_many_attachments: 'tk.error.tooMany',
  unsupported_file: 'tk.error.unsupportedFile',
  file_too_large: 'tk.error.tooLarge',
  empty_upload: 'tk.error.empty',
  lead_only: 'tk.error.leadOnly',
  rating_required: 'tk.error.ratingRequired',
  already_rated: 'tk.error.alreadyRated',
  own_work: 'tk.error.ownWork',
  unknown_category: 'tk.error.unknownCategory',
  unknown_location: 'tk.error.unknownLocation',
  unknown_requester: 'tk.error.unknownRequester',
  unknown_assignee: 'tk.error.unknownAssignee',
  name_taken: 'tk.error.nameTaken',
  code_taken: 'tk.error.codeTaken',
  last_lead: 'tk.error.lastLead',
  date_taken: 'tk.error.dateTaken',
  unknown_company: 'tk.error.unknownCompany',
  unknown_user: 'tk.error.unknownUser',
};

/** A sentence for a failed request, in the language in use. */
export function errorText(err) {
  const key = CODE_KEYS[err?.code];
  if (key) return t(key);
  const stem = errorKey(err);
  return `${t(`${stem}.title`)}. ${t(`${stem}.text`)}`;
}

/* ------------------------------------------------------------------- calls */

let optionsPromise = null;
let optionsAt = 0;
const OPTIONS_TTL_MS = 5 * 60 * 1000;

/** GET /api/tickets/options, kept a few minutes: it is configuration. */
export function loadOptions({ fresh = false } = {}) {
  if (fresh || !optionsPromise || Date.now() - optionsAt > OPTIONS_TTL_MS) {
    optionsAt = Date.now();
    optionsPromise = api('/api/tickets/options', { quiet: true }).catch((err) => {
      optionsPromise = null;
      throw err;
    });
  }
  return optionsPromise;
}

/** Tells the shell that a ticket changed, so the nav count redraws. */
export const announceChange = () => document.dispatchEvent(new CustomEvent('tickets:changed'));

/* -------------------------------------------------------------- attachments */

export function formatBytes(bytes) {
  if (bytes < 1024) return t('tk.size.bytes', { n: formatNumber(bytes) });
  if (bytes < 1024 * 1024)
    return t('tk.size.kb', { n: formatNumber(Math.round(bytes / 1024)) });
  return t('tk.size.mb', { n: (bytes / 1024 / 1024).toFixed(1) });
}

const extensionOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/**
 * Checks a file against what the server will accept, so a person is told at
 * once rather than after a slow upload.
 * @returns {string | null} a sentence, or null when the file is fine
 */
export function fileProblem(file, rules) {
  if (!rules.extensions.includes(extensionOf(file.name))) {
    return t('tk.error.unsupportedFile');
  }
  if (file.size === 0) return t('tk.error.empty');
  if (file.size > rules.maxBytes) {
    return t('tk.error.tooLargeSize', { size: formatBytes(rules.maxBytes) });
  }
  return null;
}

/** A pasted screenshot has no name of its own: "screenshot 2026-10-12 14-05-09.png". */
export function pastedName(file, index = 0) {
  const stamp = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '')
    .replace(/:/g, '-');
  const ext =
    { 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[file.type] ?? 'png';
  return `${t('tk.new.screenshotName')} ${stamp}${index ? ` ${index + 1}` : ''}.${ext}`;
}

/**
 * Sends files to a ticket, one after the other (a weak connection does not
 * get better for sending five at once). A failure stops nobody else's file.
 *
 * @param {string} ticketId
 * @param {{ file: File, name: string }[]} items
 * @param {{ commentId?: string, onState?: (item: object, state: string, detail?: any) => void }} [options]
 * @returns {Promise<{ sent: object[], failed: { item: object, error: unknown }[] }>}
 */
export async function sendFiles(ticketId, items, { commentId, onState } = {}) {
  const sent = [];
  const failed = [];
  for (const item of items) {
    onState?.(item, 'uploading', 0);
    const params = new URLSearchParams({ name: item.name });
    if (commentId) params.set('commentId', commentId);
    try {
      const result = await upload(
        `/api/tickets/${encodeURIComponent(ticketId)}/attachments?${params}`,
        item.file,
        { onProgress: (fraction) => onState?.(item, 'uploading', fraction) }
      );
      sent.push(result);
      onState?.(item, 'done', 1);
    } catch (error) {
      failed.push({ item, error });
      onState?.(item, 'failed', error instanceof ApiError ? errorText(error) : '');
    }
  }
  return { sent, failed };
}

/** The "file input + list with progress" used by the new-ticket form and the reply box. */
export function fileItemHtml(item) {
  const failed = item.state === 'failed';
  const done = item.state === 'done';
  const uploading = item.state === 'uploading';
  const percent = Math.round((item.progress ?? 0) * 100);
  return `<li class="tk-file" data-file="${esc(item.key)}" data-state="${esc(item.state)}">
    ${icon(failed ? 'statusOverdue' : done ? 'statusResolved' : 'paperclip', 'tk-file__icon')}
    <div class="tk-file__text">
      <span class="tk-file__name"><bdi dir="auto">${esc(item.name)}</bdi></span>
      <span class="tk-file__meta">${esc(
        failed
          ? item.error || t('tk.file.failed')
          : uploading
            ? t('tk.file.uploading', { percent: formatNumber(percent) })
            : done
              ? t('tk.file.sent')
              : formatBytes(item.file.size)
      )}</span>
      ${
        uploading
          ? `<progress class="tk-file__bar" max="100" value="${percent}"
               aria-label="${esc(item.name)}"></progress>`
          : ''
      }
    </div>
    ${
      item.state === 'ready'
        ? `<button type="button" class="btn btn--ghost btn--sm btn--icon" data-remove-file="${esc(
            item.key
          )}" aria-label="${esc(t('tk.file.remove', { name: item.name }))}">${icon('x', 'btn__icon')}</button>`
        : ''
    }
  </li>`;
}

/** Files already on a ticket, as links (they download). */
export function attachmentLinks(list) {
  if (!list?.length) return '';
  // A file is a link only once its malware scan has passed; until then, and
  // for good if it failed, it is shown with its state and cannot be opened.
  const held = (a) => `<li class="tk-attachments__item">
        <span class="tk-chip tk-chip--held">
          ${icon('paperclip', 'tk-chip__icon')}
          <span class="tk-chip__name"><bdi dir="auto">${esc(a.fileName)}</bdi></span>
          <span class="tk-chip__size">${esc(t(`tk.scan.${a.scan}`))}</span>
        </span>
      </li>`;
  return `<ul class="tk-attachments" aria-label="${esc(t('tk.detail.files'))}">${list
    .map((a) =>
      a.scan === 'pending' || a.scan === 'infected'
        ? held(a)
        : `<li class="tk-attachments__item">
        <a class="tk-chip" href="${esc(a.url)}" download>
          ${icon(a.contentType?.startsWith('image/') ? 'image' : 'paperclip', 'tk-chip__icon')}
          <span class="tk-chip__name"><bdi dir="auto">${esc(a.fileName)}</bdi></span>
          <span class="tk-chip__size">${esc(formatBytes(a.size))}</span>
        </a>
      </li>`
    )
    .join('')}</ul>`;
}

/**
 * A small controller for "files waiting to be sent" over a host element: add
 * from the file input, the clipboard or a drop; remove; draw with progress.
 */
export function createFileQueue({ host, rules, onProblem, onChange }) {
  let counter = 0;
  /** @type {{ key: string, file: File, name: string, state: string, progress: number, error: string }[]} */
  const items = [];

  function draw() {
    host.innerHTML = items.map(fileItemHtml).join('');
    host.hidden = items.length === 0;
  }

  function add(files, { pasted = false } = {}) {
    let index = 0;
    for (const file of files) {
      if (items.length >= rules.maxPerComment) {
        onProblem?.(t('tk.error.tooMany'));
        break;
      }
      const name =
        pasted && /^image\.\w+$/i.test(file.name || 'image.png')
          ? pastedName(file, index)
          : file.name;
      index += 1;
      const problem = fileProblem({ name, size: file.size }, rules);
      if (problem) {
        onProblem?.(`${name}: ${problem}`);
        continue;
      }
      counter += 1;
      items.push({ key: `f${counter}`, file, name, state: 'ready', progress: 0, error: '' });
    }
    draw();
    onChange?.();
  }

  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-file]');
    if (!button) return;
    const at = items.findIndex((i) => i.key === button.dataset.removeFile);
    if (at >= 0) items.splice(at, 1);
    draw();
    onChange?.();
  });

  return {
    items,
    add,
    draw,
    get size() {
      return items.length;
    },
    /** Sends everything, keeping the list in step with each file. */
    async sendTo(ticketId, { commentId } = {}) {
      const pending = items.filter((i) => i.state !== 'done');
      const result = await sendFiles(ticketId, pending, {
        commentId,
        onState(item, state, detail) {
          item.state = state;
          if (state === 'uploading') item.progress = detail;
          if (state === 'failed') item.error = detail;
          draw();
        },
      });
      return result;
    },
    clear() {
      items.length = 0;
      draw();
      onChange?.();
    },
    /** Files that did not go, to be tried again. */
    reset(failedItems) {
      for (const item of failedItems) {
        item.state = 'ready';
        item.error = '';
      }
      draw();
    },
  };
}

/** Pulls image files out of a paste event; text pastes pass through untouched. */
export function pastedFiles(event) {
  const files = [...(event.clipboardData?.files ?? [])].filter((f) =>
    f.type.startsWith('image/')
  );
  return files;
}
