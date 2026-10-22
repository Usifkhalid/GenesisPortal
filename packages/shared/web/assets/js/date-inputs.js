/**
 * date-inputs.js — English dates read day first, as "Tue, 13 Oct 2026".
 *
 * A native date field draws itself in the browser's own order (month first on
 * a US-set device), which a page cannot fully change. So in English every
 * date and date-time field is asked for the en-GB order and 24-hour clock, and
 * the date it holds is also written out beside it in words, which no device
 * can misread. Arabic keeps the field as it was.
 */

import { formatDay } from './format.js';
import { getLocale } from './i18n.js';

const SELECTOR = 'input[type="date"], input[type="datetime-local"], input[type="time"]';

function echoText(input) {
  const value = input.value;
  if (!value) return '';
  // A time on its own: the 24-hour clock, whatever the device shows.
  if (input.type === 'time') return value.slice(0, 5);
  const [day, time] = value.split('T');
  const words = formatDay(day, { weekday: 'short', year: true });
  return time ? `${words}, ${time.slice(0, 5)}` : words;
}

function enhance(input) {
  if (input.dataset.dateEcho || getLocale() !== 'en') return;
  input.dataset.dateEcho = 'true';
  input.lang = 'en-GB';
  const echo = document.createElement('span');
  echo.className = 'date-echo';
  // The field already says its value to a screen reader; this is for the eye.
  echo.setAttribute('aria-hidden', 'true');
  const draw = () => {
    echo.textContent = echoText(input);
    echo.hidden = !echo.textContent;
  };
  input.addEventListener('input', draw);
  input.addEventListener('change', draw);
  draw();
  input.insertAdjacentElement('afterend', echo);
}

/** Watches the whole document: pages draw their fields after the shell. */
export function initDateInputs() {
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches(SELECTOR)) enhance(node);
    node.querySelectorAll?.(SELECTOR).forEach(enhance);
  };
  new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(scan);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
}
