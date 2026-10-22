/**
 * pages/notifications/preferences.js — what reaches me, and on which channel.
 *
 * One switch per kind of event and channel. A switch saves when it is
 * changed, so there is nothing to forget to press; a failed save puts the
 * switch back and says so (api.js toasts the reason).
 */

import { api } from '../../api.js';
import { loadFailedNotice } from '../../components/notice.js';
import { showToast } from '../../components/toast.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';

/** @param {HTMLElement} root */
export async function render(root) {
  root.innerHTML = `<div class="stack notify">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t('notification.prefs.title'))}</h1>
        <p class="page__lead">${esc(t('notification.prefs.lead'))}</p>
      </div>
      <div class="page__actions">
        <a class="btn btn--secondary" href="#notifications">
          <span class="btn__label">${esc(t('notification.prefs.back'))}</span>
        </a>
      </div>
    </header>
    <div id="prefsBody" aria-busy="true">
      <p class="u-visually-hidden">${esc(t('loading.label'))}</p>
    </div>
  </div>`;

  const body = root.querySelector('#prefsBody');
  let data;
  try {
    data = await api('/api/notifications/preferences', { quiet: true });
  } catch {
    body.setAttribute('aria-busy', 'false');
    body.innerHTML = loadFailedNotice();
    body.querySelector('[data-retry]').addEventListener('click', () => render(root));
    return undefined;
  }
  body.setAttribute('aria-busy', 'false');

  const enabled = (category, channel) =>
    data.items.find((i) => i.category === category && i.channel === channel)?.enabled ?? true;

  body.innerHTML = `<div class="prefs">
    ${data.categories
      .map((category) => {
        const name = t(`notification.prefs.categories.${category}`);
        return `<section class="prefs__group" aria-labelledby="prefsName-${esc(category)}">
          <h2 class="prefs__name" id="prefsName-${esc(category)}">${esc(name)}</h2>
          <p class="prefs__hint">${esc(t(`notification.prefs.hints.${category}`))}</p>
          <div class="prefs__switches" role="group" aria-labelledby="prefsName-${esc(category)}">
            ${data.channels
              .map(
                (channel) => `<label class="switch">
                  <input class="switch__input" type="checkbox" role="switch"
                    data-category="${esc(category)}" data-channel="${esc(channel)}"
                    ${enabled(category, channel) ? 'checked' : ''} />
                  <span class="switch__track" aria-hidden="true"><span class="switch__knob"></span></span>
                  <span class="switch__text">${esc(t(`notification.prefs.channels.${channel}`))}</span>
                </label>`
              )
              .join('')}
          </div>
        </section>`;
      })
      .join('')}
  </div>`;

  for (const input of body.querySelectorAll('.switch__input')) {
    input.addEventListener('change', async () => {
      const wanted = input.checked;
      input.disabled = true;
      try {
        await api('/api/notifications/preferences', {
          method: 'PUT',
          body: {
            items: [
              {
                category: input.dataset.category,
                channel: input.dataset.channel,
                enabled: wanted,
              },
            ],
          },
        });
        showToast({ tone: 'success', titleKey: 'notification.prefs.saved' });
      } catch {
        input.checked = !wanted;
      } finally {
        input.disabled = false;
        input.focus();
      }
    });
  }
  return undefined;
}
