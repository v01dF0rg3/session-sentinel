/**
 * Reading "am I signed in" off the page itself.
 *
 * The cookie jar cannot answer this. bloomberg.com hands anonymous visitors an httpOnly,
 * Secure, opaque `_session_id_backup`, and no rule over names or flags separates that from
 * an authenticated session, because the difference is not in the cookie. Transitions cover
 * sign-ins that happen while we are watching, and navigation covers federated ones — but a
 * site the user was already signed into before installing has neither, and simply visiting
 * it proves nothing either.
 *
 * The page knows. A site shows "Sign out" only to people who are signed in, and shows
 * "Sign in" only to people who are not. That is not a heuristic about cookie naming
 * conventions; it is the site stating the answer in words, on every page, for the user's
 * own benefit.
 *
 * WHY THE DECISION LIVES HERE AND THE LOOKING DOES NOT.
 *
 * The DOM inspection has to be a self-contained function, serialised and injected into the
 * page — it cannot import anything. So it collects counts and nothing else, and the
 * judgement happens here where it can be tested without a browser. The injected half is
 * kept deliberately stupid for exactly that reason.
 *
 * Pure - no chrome.* here.
 */

/**
 * @typedef {object} PageEvidence
 * @property {number} logoutControls Visible links or buttons that sign the user out.
 * @property {number} logoutHrefs Links to a logout path, including inside closed menus.
 * @property {number} signInControls Visible links or buttons that begin signing in.
 * @property {number} passwordFields Password inputs on the page.
 */

/** @typedef {'signedIn' | 'anonymous' | 'unknown'} PageVerdict */

/**
 * What the page says about whether this person is signed in.
 *
 * @param {PageEvidence} evidence
 * @returns {PageVerdict}
 */
export function readPageEvidence(evidence) {
  const logout = (evidence.logoutControls ?? 0) + (evidence.logoutHrefs ?? 0);

  // A sign-out control is only ever rendered for someone who has a session to end. This is
  // the one signal in this whole project that a site states outright rather than implying.
  if (logout > 0) return 'signedIn';

  // The converse is weaker and needs more care. "Sign in" with no sign-out anywhere is a
  // logged-out page — but a login form on its own is not, because a signed-in user can be
  // sitting on a password-change screen, and a site with an account menu that renders only
  // when opened shows neither. Both of those must stay unknown rather than become a wrong
  // dismissal that hides a real account.
  if ((evidence.signInControls ?? 0) > 0) return 'anonymous';

  return 'unknown';
}

/**
 * Text that means "end my session", and text that only looks like it.
 *
 * Exported so the injected function and the tests agree on one list. The injected copy
 * inlines these patterns because it cannot import; the tests here pin the intent.
 */
export const LOGOUT_TEXT = /^\s*(sign|log)\s*-?\s*(out|off)\s*$/i;
export const SIGNIN_TEXT = /^\s*(sign|log)\s*-?\s*in\b|^\s*login\s*$|^\s*create account\s*$|^\s*sign up\s*$/i;
export const LOGOUT_HREF = /\/(logout|signout|sign-out|sign_out|log-out|log_out)(\/|\?|#|$)/i;
