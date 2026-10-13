/**
 * components/status-banner.js — one strip at the top of the work area for the
 * state of the portal itself, not of a page: offline, or an update is ready.
 *
 * It is a live region, so a screen reader hears it appear. One message at a
 * time; an update outranks "offline" because it is the one with an action.
 */

import { esc } from '../html.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';

/**
 * @param {HTMLElement} slot  the element the banner fills
 * @returns {{ showOffline(onRetry: () => void): void, hideOffline(): void,
 *             showUpdate(apply: () => void): void, redraw(): void }}
 */
export function createStatusBanner(slot) {
  /** @type {{ kind: 'offline'|'update', act: () => void } | null} */
  let offline = null;
  let update = null;

  function draw() {
    const current = update ? { kind: 'update', act: update } : offline;
    slot.hidden = !current;
    if (!current) {
      slot.replaceChildren();
      return;
    }
    const isUpdate = current.kind === 'update';
    slot.innerHTML = `
      <div class="notice notice--${isUpdate ? 'info' : 'warning'} status-banner__box">
        ${icon(isUpdate ? 'info' : 'statusOverdue', 'notice__icon')}
        <div class="notice__content status-banner__content">
          <div>
            <p class="notice__title">${esc(t(`pwa.${current.kind}.title`))}</p>
            <p>${esc(t(`pwa.${current.kind}.text`))}</p>
          </div>
          <button type="button" class="btn btn--secondary btn--sm" data-banner-action>
            <span class="btn__label">${esc(t(`pwa.${current.kind}.action`))}</span>
          </button>
        </div>
      </div>`;
    slot.querySelector('[data-banner-action]').addEventListener('click', current.act);
  }

  return {
    showOffline(onRetry) {
      offline = { kind: 'offline', act: onRetry };
      draw();
    },
    hideOffline() {
      offline = null;
      draw();
    },
    showUpdate(apply) {
      update = apply;
      draw();
    },
    /** The language changed: say it again in the new one. */
    redraw: draw,
  };
}
