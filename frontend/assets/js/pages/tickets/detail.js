/**
 * pages/tickets/detail.js — one ticket, for the person who raised it and for
 * IT. The same record both read: the label strip (number, category, urgency,
 * status, reply expected by), what was asked, then the conversation and a
 * reply box.
 *
 * IT gets what the record's `can` allows and no more: a panel to assign and
 * to change status, priority and category (each change a history entry), the
 * requester's contact card with a Teams chat link, canned replies inserted
 * in the requester's language, and internal notes which are drawn apart from
 * public replies so they are never mistaken for them. The requester never
 * receives an internal note from the API at all.
 */

import { ApiError, api } from '../../api.js';
import { field, setBusy } from '../../components/form.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice, notice } from '../../components/notice.js';
import {
  avatarHtml,
  displayName,
  langAttrs,
  namesOf,
  teamsUrl,
  telUrl,
} from '../../components/person.js';
import { showToast } from '../../components/toast.js';
import { formatDateTime } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import {
  PRIORITIES,
  SETTABLE,
  announceChange,
  attachmentLinks,
  createFileQueue,
  dueDate,
  errorText,
  expectedBy,
  loadOptions,
  numberHtml,
  pair,
  paragraphs,
  pastedFiles,
  priorityBadge,
  priorityLabel,
  slaBadge,
  statusBadge,
  statusLabel,
  who as whoIs,
} from './shared.js';

const REOPEN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {HTMLElement} root
 * @param {object} ctx  the page's context, with `who` (the reader's support role) and `ticketId`
 */
export async function render(root, ctx) {
  const { ticketId, who: support } = ctx;
  const fromQueue = ctx.route.query.get('from') === 'queue';

  let data;
  try {
    data = await api(`/api/tickets/${encodeURIComponent(ticketId)}`, { quiet: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      root.innerHTML = notice({
        tone: 'info',
        mark: 'info',
        titleKey: 'tk.detail.missingTitle',
        textKey: 'tk.detail.missingText',
      });
      return undefined;
    }
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  let options = null;
  try {
    options = await loadOptions();
  } catch {
    // The files' rules fall back below; the page still reads.
  }
  const rules = options?.attachments ?? {
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'log'],
    maxBytes: 10 * 1024 * 1024,
    maxPerComment: 5,
  };

  const staff = Boolean(data.ticket.can.manage);
  const state = {
    ticket: data.ticket,
    attachments: data.attachments,
    timeline: data.timeline,
    internal: false,
  };
  let canned = [];
  let contact = null;
  let leaving = false;

  const backHref = fromQueue ? '#tickets/queue' : '#tickets';
  root.innerHTML = `<div class="tk-detail" data-staff="${staff}">
    <p class="tk-detail__back">
      <a class="link-quiet link-icon" href="${backHref}">
        ${icon('chevronStart', '', { directional: true })}
        <span>${esc(t(fromQueue ? 'tk.detail.backQueue' : 'tk.detail.backMine'))}</span>
      </a>
    </p>
    <div class="tk-detail__grid">
      <div class="tk-detail__main stack">
        <article class="card tk-ticket" id="tkHead" aria-labelledby="tkSubject"></article>
        <div id="tkNotice"></div>
        <section class="card tk-conversation" aria-labelledby="tkConversationTitle">
          <h2 class="card__title" id="tkConversationTitle">${esc(t('tk.detail.conversation'))}</h2>
          <ol class="tk-timeline" id="tkTimeline"></ol>
        </section>
        <section class="card tk-reply" id="tkReply" aria-labelledby="tkReplyTitle" hidden></section>
      </div>
      ${
        staff
          ? `<aside class="tk-detail__side stack" aria-label="${esc(t('tk.side.label'))}">
              <section class="card tk-side" id="tkHandle" aria-labelledby="tkHandleTitle"></section>
              <section class="card tk-side" id="tkContact" aria-labelledby="tkContactTitle"></section>
              <section class="card tk-side" id="tkFacts" aria-labelledby="tkFactsTitle"></section>
            </aside>`
          : ''
      }
    </div>
    <p class="u-visually-hidden" id="tkLive" role="status" aria-live="polite"></p>
  </div>`;

  const $ = (selector) => root.querySelector(selector);
  const live = (text) => {
    $('#tkLive').textContent = text;
  };

  /* ------------------------------------------------------------- the record */
  function drawHead() {
    const tk = state.ticket;
    const expected = expectedBy(tk);
    const opened = `${whoIs(tk.requester)} · ${formatDateTime(tk.createdAt)}`;
    const loggedBy =
      tk.createdBy && tk.createdBy.id !== tk.requester?.id
        ? `<p class="provenance">${esc(
            t('tk.detail.loggedBy', {
              name: whoIs(tk.createdBy),
              source: t(`tk.source.${tk.source}`),
            })
          )}</p>`
        : '';
    $('#tkHead').innerHTML = `<dl class="labelstrip">
        ${pair(t('ticket.number'), numberHtml(tk.number))}
        ${pair(t('tk.field.category'), esc(localized(tk.category)))}
        ${pair(t('tk.field.urgency'), esc(priorityLabel(tk.priority, staff)))}
        ${pair(t('status.label'), statusBadge(tk.status, { staff }))}
        ${
          staff
            ? pair(t('tk.field.sla'), slaBadge(tk))
            : pair(expected.label, esc(expected.value))
        }
      </dl>
      <div class="card__header">
        <h2 class="card__title tk-ticket__subject" id="tkSubject"><bdi>${esc(tk.subject)}</bdi></h2>
      </div>
      <div class="card__body tk-prose">${paragraphs(tk.description)}</div>
      ${attachmentLinks(state.attachments)}
      <p class="provenance">${esc(t('tk.detail.openedBy', { who: opened }))}</p>
      ${loggedBy}`;
  }

  /* ------------------------------------------------------------ the timeline */
  function eventText(e) {
    const tk = state.ticket;
    const actor = whoIs(e.actor);
    switch (e.type) {
      case 'created':
        return tk.source !== 'portal' && staff
          ? t('tk.event.createdSource', { source: t(`tk.source.${tk.source}`) })
          : t('tk.event.created');
      case 'assigned':
        if (e.to) return t('tk.event.assignedTo', { name: whoIs(e.to) });
        return e.from
          ? t('tk.event.unassigned', { name: whoIs(e.from) })
          : t('tk.event.unassignedPlain');
      case 'status':
        return t('tk.event.status', {
          from: statusLabel(e.from, staff),
          to: statusLabel(e.to, staff),
        });
      case 'priority':
        return t(staff ? 'tk.event.priorityStaff' : 'tk.event.priority', {
          from: priorityLabel(e.from, staff),
          to: priorityLabel(e.to, staff),
        });
      case 'category':
        return t('tk.event.category', {
          from: e.from ? localized(e.from) : '—',
          to: e.to ? localized(e.to) : '—',
        });
      case 'attachment':
        return t('tk.event.attachment', { name: actor });
      case 'reopened':
        return t('tk.event.reopened', { name: actor });
      case 'autoClosed':
        return t('tk.event.autoClosed');
      default:
        return actor;
    }
  }

  function commentHtml(e) {
    const tk = state.ticket;
    const fromTeam = e.actor && e.actor.id !== tk.requester?.id;
    const person = e.actor ?? { displayNameEn: t('tk.system') };
    const { primary } = namesOf(person);
    const note = e.isInternal;
    return `<li class="tk-entry ${note ? 'tk-entry--internal' : fromTeam ? 'tk-entry--team' : 'tk-entry--requester'}"
        data-entry="${esc(e.id)}" ${note ? 'data-internal="true"' : ''}>
      <div class="tk-entry__head">
        ${avatarHtml(person, 'sm')}
        <span class="tk-entry__who" ${langAttrs(primary.lang)}>${esc(primary.text)}</span>
        ${
          note
            ? `<span class="badge tk-entry__flag">${icon('lock', 'badge__icon')}<span>${esc(
                t('tk.entry.internal')
              )}</span></span>`
            : fromTeam
              ? `<span class="tag">${esc(t('tk.entry.team'))}</span>`
              : ''
        }
        <time class="tk-entry__time" datetime="${esc(e.at)}">${esc(formatDateTime(e.at))}</time>
      </div>
      ${note ? `<p class="tk-entry__note">${esc(t('tk.entry.internalHelp'))}</p>` : ''}
      <div class="tk-entry__body tk-prose">${paragraphs(e.comment?.body ?? '')}</div>
      ${attachmentLinks(e.comment?.attachments)}
    </li>`;
  }

  function eventHtml(e) {
    return `<li class="tk-event" data-event="${esc(e.id)}">
      ${icon('statusProgress', 'tk-event__icon')}
      <span class="tk-event__text">${esc(eventText(e))}</span>
      <time class="tk-event__time" datetime="${esc(e.at)}">${esc(formatDateTime(e.at))}</time>
    </li>`;
  }

  function drawTimeline() {
    // A comment's own "comment" event carries the text; an attachment event
    // that belongs to a comment is part of that comment, not a line of its own.
    const entries = state.timeline.filter(
      (e) => e.type === 'comment' || !(e.type === 'attachment' && e.comment)
    );
    $('#tkTimeline').innerHTML = entries
      .map((e) => (e.type === 'comment' && e.comment ? commentHtml(e) : eventHtml(e)))
      .join('');
  }

  /* ---------------------------------------------------- notices and reopening */
  function drawNotice() {
    const tk = state.ticket;
    const done = tk.status === 'Resolved' || tk.status === 'Closed';
    const host = $('#tkNotice');
    if (!done) {
      host.innerHTML = '';
      return;
    }
    const resolvedAt = tk.resolvedAt ?? tk.closedAt;
    const until = resolvedAt
      ? dueDate(new Date(new Date(resolvedAt).getTime() + REOPEN_DAYS * DAY_MS))
      : '';
    let text;
    if (tk.can.reopen) {
      text = staff
        ? t('tk.reopen.staffText')
        : t('tk.reopen.text', { until, days: REOPEN_DAYS });
    } else {
      text = t(tk.status === 'Closed' ? 'tk.reopen.closedText' : 'tk.reopen.lateText');
    }
    host.innerHTML = `<div class="notice notice--${tk.status === 'Resolved' ? 'success' : 'info'}" role="status">
      ${icon('statusResolved', 'notice__icon')}
      <div class="notice__content stack">
        <div>
          <p class="notice__title">${esc(t(`tk.reopen.title.${tk.status}`))}</p>
          <p>${esc(text)}</p>
        </div>
        <div class="btn-row">
          ${
            tk.can.reopen
              ? `<button type="button" class="btn btn--secondary" data-reopen>
                   <span class="btn__label">${esc(t('tk.reopen.action'))}</span></button>`
              : `<a class="btn btn--secondary" href="#tickets/new">
                   <span class="btn__label">${esc(t('tk.reopen.new'))}</span></a>`
          }
        </div>
      </div>
    </div>`;
  }

  async function reopen(button) {
    setBusy(button, true);
    try {
      await api(`/api/tickets/${encodeURIComponent(ticketId)}/reopen`, {
        method: 'POST',
        quiet: true,
      });
    } catch (err) {
      setBusy(button, false);
      showToast({ tone: 'danger', titleKey: 'tk.reopen.failed', text: errorText(err) });
      return;
    }
    await reload();
    live(t('tk.reopen.done'));
    showToast({ tone: 'success', titleKey: 'tk.reopen.done' });
    announceChange();
    $('#tkReplyText')?.focus();
  }

  /* --------------------------------------------------------------- reply box */
  const queue = { current: null };

  function drawReply() {
    const tk = state.ticket;
    const host = $('#tkReply');
    if (!tk.can.comment) {
      host.hidden = true;
      host.innerHTML = '';
      queue.current = null;
      return;
    }
    // Keep a draft across redraws (a status change, a reopen).
    const draft = host.querySelector('#tkReplyText')?.value ?? '';
    const internal = staff && state.internal;
    host.hidden = false;
    host.classList.toggle('tk-reply--internal', internal);
    host.innerHTML = `<form id="tkReplyForm" class="stack" novalidate>
      <div class="tk-reply__top">
        <h2 class="card__title" id="tkReplyTitle">${esc(
          t(internal ? 'tk.reply.titleNote' : staff ? 'tk.reply.titleStaff' : 'tk.reply.title')
        )}</h2>
        ${
          staff
            ? `<div class="segmented" role="group" aria-label="${esc(t('tk.reply.kind'))}">
                <button type="button" class="segmented__option" data-kind="public"
                  aria-pressed="${!internal}">${esc(t('tk.reply.public'))}</button>
                <button type="button" class="segmented__option" data-kind="internal"
                  aria-pressed="${internal}">${icon('lock', 'btn__icon')}<span>${esc(
                    t('tk.reply.internal')
                  )}</span></button>
              </div>`
            : ''
        }
      </div>
      ${internal ? `<p class="tk-reply__warn">${icon('lock', 'tk-reply__warn-icon')}<span>${esc(t('tk.reply.internalHelp'))}</span></p>` : ''}
      ${
        staff && !internal && canned.length
          ? `<div class="field tk-canned">
              <label class="field__label" for="tkCanned">${esc(t('tk.reply.insert'))}</label>
              <select class="select" id="tkCanned">
                <option value="">${esc(t('tk.reply.insertPlaceholder'))}</option>
                ${canned
                  .map(
                    (c) => `<option value="${esc(c.id)}">${esc(localized(c, 'title'))}</option>`
                  )
                  .join('')}
              </select>
              <p class="field__help" id="tkCanned-help">${esc(
                t('tk.reply.insertHelp', {
                  language: t(`lang.${tk.requesterLanguage === 'ar' ? 'ar' : 'en'}`),
                })
              )}</p>
            </div>`
          : ''
      }
      ${field({
        id: 'tkReplyText',
        label: t(internal ? 'tk.reply.labelNote' : 'tk.reply.label'),
        required: true,
        control: `<textarea class="textarea" id="tkReplyText" name="body" rows="${staff ? 6 : 4}"
          maxlength="10000" aria-describedby="tkReplyText-error"></textarea>`,
      })}
      <div class="tk-files">
        <input type="file" id="tkReplyFile" multiple hidden
          accept="${esc(rules.extensions.map((e) => `.${e}`).join(','))}" />
        <div class="tk-files__bar">
          <button type="button" class="btn btn--secondary btn--sm" id="tkReplyAttach">
            ${icon('paperclip', 'btn__icon')}
            <span class="btn__label">${esc(t('tk.new.addFile'))}</span>
          </button>
          <p class="field__help">${esc(t('tk.reply.filesHelp'))}</p>
        </div>
        <ul class="tk-filelist" id="tkReplyFiles" hidden></ul>
        <p class="field__error" id="tkReplyFile-error" role="alert" hidden></p>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn--primary" id="tkReplySend">
          ${icon('send', 'btn__icon', { directional: true })}
          <span class="btn__label">${esc(t(internal ? 'tk.reply.sendNote' : 'tk.reply.send'))}</span>
        </button>
      </div>
    </form>`;

    const form = host.querySelector('#tkReplyForm');
    const text = form.elements.body;
    text.value = draft;
    const fileError = (message) => {
      const el = form.querySelector('#tkReplyFile-error');
      el.hidden = !message;
      el.textContent = message ?? '';
    };
    const files = createFileQueue({
      host: form.querySelector('#tkReplyFiles'),
      rules,
      onProblem: fileError,
    });
    queue.current = files;

    const input = form.querySelector('#tkReplyFile');
    form.querySelector('#tkReplyAttach').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      fileError('');
      files.add([...input.files]);
      input.value = '';
    });
    form.addEventListener('paste', (event) => {
      const images = pastedFiles(event);
      if (images.length === 0) return;
      event.preventDefault();
      fileError('');
      files.add(images, { pasted: true });
      showToast({ tone: 'success', titleKey: 'tk.new.pasted' });
    });

    text.addEventListener('input', () => {
      const error = form.querySelector('#tkReplyText-error');
      error.hidden = true;
      error.replaceChildren();
      text.removeAttribute('aria-invalid');
    });

    form.querySelector('#tkCanned')?.addEventListener('change', (event) => {
      const reply = canned.find((c) => c.id === event.target.value);
      event.target.value = '';
      if (!reply) return;
      // The requester's language, not the agent's: they are the one who reads it.
      const wantsArabic = tk.requesterLanguage === 'ar';
      const body =
        (wantsArabic ? reply.bodyAr || reply.bodyEn : reply.bodyEn || reply.bodyAr) ?? '';
      const before = text.value.trimEnd();
      text.value = before ? `${before}\n\n${body}` : body;
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
      live(t('tk.reply.inserted'));
    });

    form.addEventListener('click', (event) => {
      const kind = event.target.closest('[data-kind]');
      if (!kind) return;
      const next = kind.dataset.kind === 'internal';
      if (next === state.internal) return;
      state.internal = next;
      drawReply();
      $('#tkReplyText').focus();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      send(form, files, internal);
    });
  }

  async function send(form, files, internal) {
    const text = form.elements.body;
    const body = text.value.trim();
    if (!body) {
      const error = form.querySelector('#tkReplyText-error');
      error.innerHTML = `${icon('statusOverdue')}<span>${esc(t('tk.reply.error'))}</span>`;
      error.hidden = false;
      text.setAttribute('aria-invalid', 'true');
      text.focus();
      return;
    }
    const button = form.querySelector('#tkReplySend');
    setBusy(button, true, t('action.saving'));
    let result;
    try {
      result = await api(`/api/tickets/${encodeURIComponent(ticketId)}/comments`, {
        method: 'POST',
        quiet: true,
        body: { body, isInternal: internal },
      });
    } catch (err) {
      setBusy(button, false, t(internal ? 'tk.reply.sendNote' : 'tk.reply.send'));
      showToast({ tone: 'danger', titleKey: 'tk.reply.failed', text: errorText(err) });
      return;
    }

    let failed = 0;
    if (files.size > 0) {
      const mine = result.timeline.findLast((e) => e.type === 'comment' && e.comment);
      if (mine) {
        const sent = await files.sendTo(ticketId, { commentId: mine.comment.id });
        failed = sent.failed.length;
      }
      files.clear();
    }

    announceChange();
    // Whatever the server now says is the truth, files included.
    await reload();
    setBusy(
      root.querySelector('#tkReplySend'),
      false,
      t(internal ? 'tk.reply.sendNote' : 'tk.reply.send')
    );
    const box = root.querySelector('#tkReplyText');
    if (box) box.value = '';
    text.value = '';
    live(t(internal ? 'tk.reply.noteSent' : 'tk.reply.sent'));
    showToast({
      tone: failed ? 'warning' : 'success',
      titleKey: internal ? 'tk.reply.noteSent' : 'tk.reply.sent',
      ...(failed ? { text: t('tk.reply.filesFailed', { count: failed }) } : {}),
    });
    const sentEntry = [...root.querySelectorAll('.tk-entry')].at(-1);
    sentEntry?.scrollIntoView({ block: 'nearest' });
    $('#tkReplyText')?.focus();
  }

  /* --------------------------------------------------------------- IT's panel */
  function drawHandle() {
    if (!staff) return;
    const tk = state.ticket;
    const agents = (support.queueOptions?.agents ?? []).filter((a) => a.teamId === tk.team?.id);
    const categories = (support.queueOptions?.categories ?? []).filter(
      (c) => c.teamId === tk.team?.id
    );
    const mine = tk.assignee?.id === ctx.user.id;
    // An agent may take an unassigned ticket or hand on their own; only a Lead
    // takes one from a colleague (D101).
    const mayAssign = tk.can.reassign || !tk.assignee || mine;
    const option = (value, text, chosen, disabled = false) =>
      `<option value="${esc(value)}" ${value === chosen ? 'selected' : ''} ${
        disabled ? 'disabled' : ''
      }>${esc(text)}</option>`;
    const statusOptions = SETTABLE.includes(tk.status) ? SETTABLE : [tk.status, ...SETTABLE];
    $('#tkHandle').innerHTML = `
      <h2 class="card__title" id="tkHandleTitle">${esc(t('tk.side.handle'))}</h2>
      <div class="field">
        <label class="field__label" for="tkAssignee">${esc(t('ticket.assignee'))}</label>
        <select class="select" id="tkAssignee" data-patch="assigneeId" ${mayAssign ? '' : 'disabled'}>
          ${option('', t('ticket.unassigned'), tk.assignee?.id ?? '')}
          ${agents.map((a) => option(a.id, displayName(a), tk.assignee?.id ?? '')).join('')}
        </select>
        ${
          !mayAssign
            ? `<p class="field__help">${esc(t('tk.side.leadOnly'))}</p>`
            : !mine
              ? `<button type="button" class="btn btn--secondary btn--sm tk-side__take" data-take>
                  ${icon('user', 'btn__icon')}<span class="btn__label">${esc(t('action.assign'))}</span>
                </button>`
              : ''
        }
      </div>
      <div class="field">
        <label class="field__label" for="tkStatus">${esc(t('status.label'))}</label>
        <select class="select" id="tkStatus" data-patch="status">
          ${statusOptions
            .map((s) => option(s, statusLabel(s, true), tk.status, !SETTABLE.includes(s)))
            .join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="tkPriority">${esc(t('field.priority'))}</label>
        <select class="select" id="tkPriority" data-patch="priority">
          ${PRIORITIES.map((p) => option(p, priorityLabel(p, true), tk.priority)).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="tkCategory">${esc(t('tk.field.category'))}</label>
        <select class="select" id="tkCategory" data-patch="categoryId">
          ${categories.map((c) => option(c.id, localized(c), tk.category?.id)).join('')}
        </select>
      </div>`;
  }

  function drawContact() {
    if (!staff) return;
    const r = state.ticket.requester;
    const person = { ...r, ...(contact ?? {}) };
    const { primary, other } = namesOf(person);
    $('#tkContact').innerHTML = `
      <h2 class="card__title" id="tkContactTitle">${esc(t('tk.side.requester'))}</h2>
      <div class="tk-contact">
        ${avatarHtml(person, 'lg')}
        <div class="tk-contact__text">
          <p class="tk-contact__name" ${langAttrs(primary.lang)}>${esc(primary.text)}</p>
          ${other ? `<p class="tk-contact__other" ${langAttrs(other.lang)}>${esc(other.text)}</p>` : ''}
          ${contact?.jobTitle ? `<p class="tk-contact__title">${esc(contact.jobTitle)}</p>` : ''}
          <p class="tk-contact__title">${esc(
            [
              state.ticket.company ? localized(state.ticket.company) : '',
              contact?.department ? localized(contact.department) : '',
            ]
              .filter(Boolean)
              .join(' · ')
          )}</p>
        </div>
      </div>
      ${
        contact
          ? `<ul class="tk-contact__links">
              ${
                contact.email
                  ? `<li><a class="btn btn--secondary btn--sm" href="${esc(teamsUrl(contact.email))}"
                      target="_blank" rel="noopener">${icon('chat', 'btn__icon')}<span class="btn__label">${esc(
                        t('tk.side.teams')
                      )}</span></a></li>
                    <li><a class="link-quiet" href="mailto:${esc(contact.email)}"><bdi dir="ltr">${esc(
                      contact.email
                    )}</bdi></a></li>`
                  : ''
              }
              ${
                contact.phone || contact.mobilePhone
                  ? `<li><a class="link-quiet link-icon" href="${esc(telUrl(contact.mobilePhone || contact.phone))}"
                      >${icon('phone')}<bdi dir="ltr">${esc(
                        contact.mobilePhone || contact.phone
                      )}</bdi></a></li>`
                  : ''
              }
            </ul>`
          : ''
      }`;
  }

  function drawFacts() {
    if (!staff) return;
    const tk = state.ticket;
    const row = (key, value) =>
      value ? `<div><dt>${esc(key)}</dt><dd>${value}</dd></div>` : '';
    $('#tkFacts').innerHTML = `
      <h2 class="card__title" id="tkFactsTitle">${esc(t('tk.side.details'))}</h2>
      <dl class="tk-facts">
        ${row(t('ticket.company'), tk.company ? esc(`${tk.company.code} · ${localized(tk.company)}`) : '')}
        ${row(t('tk.field.location'), tk.location ? esc(localized(tk.location)) : esc(t('tk.side.noLocation')))}
        ${row(t('tk.field.source'), esc(t(`tk.source.${tk.source}`)))}
        ${row(t('tk.field.assetTag'), tk.assetTag ? `<bdi dir="ltr">${esc(tk.assetTag)}</bdi>` : '')}
        ${row(t('ticket.opened'), esc(formatDateTime(tk.createdAt)))}
        ${row(
          t('tk.field.firstResponse'),
          tk.firstRespondedAt
            ? esc(formatDateTime(tk.firstRespondedAt))
            : tk.sla.firstResponseDueAt
              ? esc(t('tk.side.dueAt', { when: dueDate(tk.sla.firstResponseDueAt) }))
              : ''
        )}
        ${row(t('tk.field.resolveDue'), tk.sla.resolveDueAt ? esc(dueDate(tk.sla.resolveDueAt)) : '')}
        ${row(t('tk.field.priority'), priorityBadge(tk.priority, { staff: true }))}
      </dl>`;
  }

  async function patch(body) {
    try {
      await api(`/api/tickets/${encodeURIComponent(ticketId)}`, {
        method: 'PATCH',
        quiet: true,
        body,
      });
      await reload();
      announceChange();
      live(t('tk.side.saved'));
      showToast({ tone: 'success', titleKey: 'tk.side.saved' });
    } catch (err) {
      showToast({ tone: 'danger', titleKey: 'tk.side.failed', text: errorText(err) });
      // Put the controls back to what is true.
      drawHandle();
    }
  }

  /* ---------------------------------------------------------------- plumbing */
  function drawAll() {
    drawHead();
    drawTimeline();
    drawNotice();
    drawReply();
    drawHandle();
    drawContact();
    drawFacts();
  }

  async function reload() {
    const next = await api(`/api/tickets/${encodeURIComponent(ticketId)}`, { quiet: true });
    if (leaving) return;
    state.ticket = next.ticket;
    state.attachments = next.attachments;
    state.timeline = next.timeline;
    // The reply box is redrawn only when what it may do has changed.
    const draftFiles = queue.current;
    drawHead();
    drawTimeline();
    drawNotice();
    if (!draftFiles || !$('#tkReplyForm') || state.ticket.can.comment === false) drawReply();
    drawHandle();
    drawContact();
    drawFacts();
  }

  root.addEventListener('click', (event) => {
    const reopenButton = event.target.closest('[data-reopen]');
    if (reopenButton) {
      reopen(reopenButton);
      return;
    }
    if (event.target.closest('[data-take]')) {
      patch({ assigneeId: ctx.user.id });
    }
  });
  root.addEventListener('change', (event) => {
    const control = event.target.closest('[data-patch]');
    if (!control) return;
    const key = control.dataset.patch;
    const value = key === 'assigneeId' ? control.value || null : control.value;
    patch({ [key]: value });
  });

  drawAll();

  // The rest comes after the record is on screen: a weak connection reads
  // the ticket first.
  if (staff) {
    const requesterId = state.ticket.requester?.id;
    const [replies, person] = await Promise.all([
      api(`/api/tickets/canned-replies?teamId=${encodeURIComponent(state.ticket.team.id)}`, {
        quiet: true,
      }).catch(() => ({ items: [] })),
      requesterId
        ? api(`/api/directory/people/${encodeURIComponent(requesterId)}`, {
            quiet: true,
          }).catch(() => null)
        : null,
    ]);
    if (leaving) return undefined;
    canned = replies.items;
    contact = person;
    drawReply();
    drawContact();
  }

  return () => {
    leaving = true;
  };
}
