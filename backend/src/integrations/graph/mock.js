/**
 * Graph, mocked. Canned data lives here so that every feature can be built and
 * tested with no tenant. Methods are added alongside the features that need
 * them, in step with real.js.
 */

/** @returns {import('./index.js').GraphClient} */
export function createClient() {
  return { mode: 'mock' };
}
