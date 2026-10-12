/**
 * closeResolvedTickets.js — closes resolved tickets whose requester has not
 * replied for three working days, once at startup and then every half hour.
 * The rule and the dates are the ticket service's (`closeResolved`); this is
 * only the timer.
 */

export const AUTO_CLOSE_INTERVAL_MS = 30 * 60 * 1000;

/**
 * @param {{ closeResolved: () => Promise<number> }} tickets  the ticket service
 * @param {{ info: Function, warn: Function }} log
 * @param {{ intervalMs?: number }} [options]
 * @returns {{ ready: Promise<void>, stop: () => void }} `ready` settles when the
 *   startup run has finished; it never rejects
 */
export function startTicketAutoClose(
  tickets,
  log,
  { intervalMs = AUTO_CLOSE_INTERVAL_MS } = {}
) {
  if (typeof tickets?.closeResolved !== 'function') {
    return { ready: Promise.resolve(), stop() {} };
  }

  const run = () =>
    tickets.closeResolved().then(
      (count) => {
        if (count > 0) log.info({ count }, 'resolved tickets closed');
      },
      (err) => log.warn({ err }, 'ticket auto-close failed')
    );

  const ready = run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { ready, stop: () => clearInterval(timer) };
}
