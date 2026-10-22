/**
 * components/skeleton.js — what is shown while something loads, in the shape
 * of what is coming, so the page does not jump when it lands. On weak 3G a
 * page module or a list can take seconds.
 */

import { t } from '../i18n.js';
import { esc } from '../html.js';

const PAIR = `<div class="skeleton-card__pair">
  <span class="skeleton skeleton--text skeleton--line-short"></span>
  <span class="skeleton skeleton--value"></span>
</div>`;

const STRIP = `<div class="skeleton-card__strip">${PAIR}${PAIR}</div>`;

const CARD_BODY = `${STRIP}
  <span class="skeleton skeleton--title"></span>
  <span class="skeleton skeleton--text skeleton--line-long"></span>`;

const busy = (label) => `role="status" aria-busy="true" aria-label="${esc(t(label))}"`;

/** Any page: two record cards. */
export function pageSkeleton() {
  const card = `<div class="skeleton-card">${CARD_BODY}</div>`;
  return `<div class="stack" ${busy('loading.page')}>${card}${card}</div>`;
}

/**
 * Home: the banner (greeting, lead, the two actions, the strip) over its five
 * cards, in the page's own order and on its own tracks, so nothing moves when
 * the module lands.
 */
export function homeSkeleton() {
  const card = (span) => `<div class="skeleton-card ${span}">${CARD_BODY}</div>`;
  return `<div class="bento home" ${busy('loading.page')}>
    <div class="banner">
      <div class="banner__body">
        <div class="banner__intro">
          <span class="skeleton home__skeleton-greeting"></span>
          <span class="skeleton skeleton--text skeleton--line-short"></span>
        </div>
        <div class="btn-row">
          <span class="skeleton home__skeleton-button"></span>
          <span class="skeleton home__skeleton-button"></span>
        </div>
        <div class="banner__strip">${STRIP}</div>
      </div>
    </div>
    ${['waiting', 'rooms', 'tickets', 'people', 'news'].map((key) => card(`home__${key}`)).join('')}
  </div>`;
}

/**
 * The rows of a record list that is still loading.
 *
 * @param {number} count
 * @param {'record'|'person'} [shape]
 */
export function recordSkeleton(count, shape = 'record') {
  const row =
    shape === 'person'
      ? `<li class="record">
           <div class="person">
             <span class="skeleton skeleton--avatar"></span>
             <span class="skeleton skeleton--text skeleton--line-long"></span>
           </div>
         </li>`
      : `<li class="record">
           <div class="stack stack--tight">
             ${STRIP}
             <span class="skeleton skeleton--title"></span>
           </div>
         </li>`;
  return `<ul class="record-list" data-density="compact">${row.repeat(count)}</ul>`;
}
