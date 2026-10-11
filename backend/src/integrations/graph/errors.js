/**
 * What a Graph calendar call can refuse with, in terms the portal acts on.
 * Both implementations throw these, so a module never reads a Graph status.
 *
 *   room_conflict            the room is busy; `details.conflicts` lists the times
 *   event_not_found          Exchange no longer has that event
 *   delegated_token_missing  the real client was asked to act as a person
 *                            without that person's token (wired in session 19)
 */
export class GraphError extends Error {
  /**
   * @param {'room_conflict' | 'event_not_found' | 'delegated_token_missing'} code
   * @param {string} [message]
   * @param {object} [details]
   */
  constructor(code, message, details) {
    super(message ?? code);
    this.name = 'GraphError';
    this.code = code;
    this.details = details;
  }
}
