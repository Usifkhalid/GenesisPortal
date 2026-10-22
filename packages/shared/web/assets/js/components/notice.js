/**
 * components/notice.js — an inline notice: a message that belongs to the page,
 * optionally with a "Try again" button (data-retry) for the caller to wire.
 */

import { t } from '../i18n.js';
import { esc } from '../html.js';
import { icon } from './icons.js';

/**
 * The title and its sentence sit in one block, so they read as one message;
 * the button, when there is one, stands a full step below them.
 *
 * @param {object} options
 * @param {'success'|'warning'|'danger'|'info'} options.tone
 * @param {string} options.mark  an icon name
 * @param {string} options.titleKey
 * @param {string} options.textKey
 * @param {boolean} [options.retry]
 */
export function notice({ tone, mark, titleKey, textKey, retry = false }) {
  return `<div class="notice notice--${tone}" role="alert">
    ${icon(mark, 'notice__icon')}
    <div class="notice__content stack">
      <div>
        <p class="notice__title">${esc(t(titleKey))}</p>
        <p>${esc(t(textKey))}</p>
      </div>
      ${
        retry
          ? `<div>
               <button type="button" class="btn btn--secondary" data-retry>
                 <span class="btn__label">${esc(t('action.retry'))}</span>
               </button>
             </div>`
          : ''
      }
    </div>
  </div>`;
}

/** What a page says when it, or the session, could not be fetched. */
export function loadFailedNotice() {
  return notice({
    tone: 'danger',
    mark: 'statusOverdue',
    titleKey: 'app.loadFailedTitle',
    textKey: 'app.loadFailedText',
    retry: true,
  });
}
