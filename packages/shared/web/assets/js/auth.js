/**
 * auth.js — the signed-in session, as the frontend knows it.
 *
 * Everything comes from GET /api/me: the person, their company with its
 * branding, the companies they may work in, their roles, and the navigation
 * they may see. The frontend hides what the server says to hide; the server
 * still enforces every one of those rules for itself.
 */

import { api, setCsrfToken } from './api.js';
import { forgetSavedAnswers } from './pwa.js';

/**
 * Loads the session. Without one, api() sends the browser to the login page
 * and this never returns. A failure is the caller's to show: before the
 * session there is no shell for a toast to sit over.
 *
 * @returns {Promise<{
 *   user: { id: string, email: string, displayNameEn: string, displayNameAr: string,
 *           jobTitle: string|null, language: string, department: object|null },
 *   company: Company, companies: Company[],
 *   roles: { role: string, scopeCompanyId: string|null }[],
 *   nav: { key: string, group: 'main'|'admin' }[],
 *   authMode: 'mock'|'entra',
 * }>}
 *
 * @typedef {{ id: string, code: string, nameEn: string, nameAr: string,
 *             accentColor: string, logoUrl: string|null }} Company
 */
export async function loadSession() {
  const me = await api('/api/me', { quiet: true });
  setCsrfToken(me.csrfToken);
  return me;
}

/**
 * Ends the session, then goes where the server says: the login page, or
 * Entra's own sign-out when that is how the person signed in. It never fails
 * from the person's side: if the request does not work (expired session, no
 * signal, a server that restarted) they still land on the login page.
 */
export async function signOut() {
  let redirectTo = '/login.html';
  // What the worker saved is this person's: it does not stay on a shared phone.
  await forgetSavedAnswers();
  try {
    ({ redirectTo } = await api('/api/auth/logout', {
      method: 'POST',
      redirectOn401: false,
      quiet: true,
    }));
  } catch {
    // Falls through to the login page.
  }
  location.assign(redirectTo);
}
