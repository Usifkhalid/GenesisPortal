/**
 * pages/dev-outbox.js — development only: the mail the portal would have
 * sent, read from the mocked Graph's outbox (GET /api/dev/outbox). In any
 * other setting the API answers 404 and this page says it is not here.
 */

import { api } from '../api.js';
import { notice } from '../components/notice.js';
import { formatDateTime } from '../format.js';
import { esc } from '../html.js';
import { t } from '../i18n.js';

/** @param {HTMLElement} root */
export async function render(root) {
  root.innerHTML = `<div class="stack notify">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t('dev.outbox.title'))}</h1>
        <p class="page__lead">${esc(t('dev.outbox.lead'))}</p>
      </div>
      <div class="page__actions">
        <button type="button" class="btn btn--secondary" id="outboxReload">
          <span class="btn__label">${esc(t('dev.outbox.reload'))}</span>
        </button>
      </div>
    </header>
    <div id="outboxBody" aria-live="polite"></div>
  </div>`;

  const body = root.querySelector('#outboxBody');
  root.querySelector('#outboxReload').addEventListener('click', () => render(root));

  let result;
  try {
    result = await api('/api/dev/outbox', { quiet: true });
  } catch {
    body.innerHTML = notice({
      tone: 'warning',
      mark: 'statusOverdue',
      titleKey: 'dev.outbox.unavailableTitle',
      textKey: 'dev.outbox.unavailable',
    });
    return undefined;
  }

  if (result.items.length === 0) {
    body.innerHTML = `<div class="empty empty--inline"><div class="empty__copy">
      <p class="empty__title">${esc(t('dev.outbox.empty'))}</p></div></div>`;
    return undefined;
  }

  // The message is drawn in a sandboxed frame with no scripts, as a mail client
  // would, and only when its row is opened: a long outbox is not 200 frames.
  body.innerHTML = `<ul class="record-list">
    ${result.items
      .map(
        (mail, i) => `<li class="record">
          <dl class="labelstrip labelstrip--compact">
            <div class="labelstrip__pair"><dt class="labelstrip__key">${esc(t('dev.outbox.to'))}</dt>
              <dd class="labelstrip__value" dir="ltr">${esc(mail.to.join(', '))}</dd></div>
            <div class="labelstrip__pair"><dt class="labelstrip__key">${esc(t('dev.outbox.from'))}</dt>
              <dd class="labelstrip__value" dir="ltr">${esc(mail.from)}</dd></div>
            <div class="labelstrip__pair"><dt class="labelstrip__key">${esc(t('dev.outbox.sentAt'))}</dt>
              <dd class="labelstrip__value">${esc(formatDateTime(mail.sentAt))}</dd></div>
          </dl>
          <h3 class="record__title"><bdi>${esc(mail.subject)}</bdi></h3>
          <details class="outbox" data-mail="${i}">
            <summary>${esc(t('dev.outbox.preview'))}</summary>
          </details>
        </li>`
      )
      .join('')}
  </ul>`;

  for (const details of body.querySelectorAll('.outbox')) {
    details.addEventListener('toggle', () => {
      if (!details.open || details.querySelector('iframe')) return;
      const mail = result.items[Number(details.dataset.mail)];
      const frame = document.createElement('iframe');
      frame.className = 'outbox-frame';
      frame.setAttribute('sandbox', '');
      frame.title = `${t('dev.outbox.preview')}: ${mail.subject}`;
      frame.srcdoc = mail.html;
      details.append(frame);
    });
  }
  return undefined;
}
