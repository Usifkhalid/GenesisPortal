/**
 * popover.js — the shells' disclosure popovers (the account menu, the bell,
 * the company switcher): one trigger button, one `.menu` panel. Used by the
 * portal (app.js) and the IT Helpdesk (helpdesk.js).
 *
 * These are disclosure popovers, not the WAI-ARIA application-menu pattern:
 * they hold a mix of static text and ordinary links/buttons rather than a
 * roving-tabindex menu with arrow-key traversal, so none of this carries
 * role="menu"/"menuitem" — that role would promise keyboard behaviour this
 * code does not implement.
 */

export function closeMenu(id, { restoreFocus = false } = {}) {
  const menu = document.getElementById(id);
  const trigger = document.querySelector(`[aria-controls="${id}"]`);
  if (menu) menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger?.focus();
}

/**
 * Wires a trigger button to a popover: click to toggle, Escape and an
 * outside click to close, and the trigger regains focus on close so keyboard
 * use never loses its place.
 */
export function initPopover(triggerId, menuId) {
  const trigger = document.getElementById(triggerId);
  const menu = document.getElementById(menuId);
  if (!trigger || !menu) return;

  trigger.addEventListener('click', () => {
    const opening = menu.hidden;
    for (const other of document.querySelectorAll('.menu')) {
      if (other !== menu) closeMenu(other.id);
    }
    menu.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
  });

  document.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) {
      closeMenu(menuId);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      closeMenu(menuId, { restoreFocus: true });
    }
  });

  // Tabbing out of the popover closes it, so it never stays open behind the
  // place a keyboard user has moved on to.
  menu.parentElement.addEventListener('focusout', (event) => {
    if (
      !menu.hidden &&
      event.relatedTarget &&
      !menu.parentElement.contains(event.relatedTarget)
    ) {
      closeMenu(menuId);
    }
  });
}
