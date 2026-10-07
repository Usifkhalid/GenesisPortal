/**
 * Graph, live. Talks to the "mgholding" tenant through @azure/msal-node with
 * the credentials in ENTRA_*.
 *
 * Tenant access has not been granted yet, so this is a stub: it keeps the shape
 * of the boundary visible and fails loudly rather than silently serving mock
 * data if GRAPH_MODE=real is set too early.
 */

/** @returns {import('./index.js').GraphClient} */
export function createClient() {
  throw new Error(
    'GRAPH_MODE=real is not implemented yet: no tenant access. Use GRAPH_MODE=mock.'
  );
}
