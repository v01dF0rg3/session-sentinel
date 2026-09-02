/**
 * Telling an authenticated session apart from an anonymous one without pretending a
 * cookie name knows the server-side state behind its value.
 *
 * WHY COOKIE METADATA CANNOT ANSWER THE QUESTION.
 *
 * Bloomberg gives a visitor with no account `_session_id_backup`: httpOnly, Secure and a
 * 36-character opaque value. The live Incognito experiment then measured the same name in
 * the user's normal jar and in a genuinely empty private jar. That proves the name is
 * ambiguous. It does not prove the normal session is logged out, because a site may
 * upgrade the same opaque session ID server-side without changing its cookie name.
 *
 * Fetch cannot supply a stronger anonymous comparison: Chrome strips `Set-Cookie` from
 * the Headers object, including same-origin `basic` responses. `chrome.webRequest` could
 * observe future traffic, at the privacy cost of seeing all response headers, but still
 * would not reveal the server-side identity of a session that predates installation.
 *
 * WHAT CAN BE KNOWN SAFELY.
 *
 * First sight records the auth-grade cookie names already present when the extension first
 * sees a domain. Those names prove nothing. If a new auth-grade name appears later, that is
 * positive sign-in evidence. If every name was already present, the answer remains unknown
 * rather than being silently called anonymous. The user settles that upgrade gap once via
 * Yours? Yes / No.
 *
 * Pure — no chrome.* and no fetch here.
 */

/** @typedef {'signedIn' | 'anonymous' | 'unknown'} SignInVerdict */

/**
 * Decide what the live cookie-name evidence can honestly establish.
 *
 * @param {string[]} authGradeNames Names in the user's jar that look session-bearing.
 * @param {string[] | null} [everSeen] Names at first sight. Null means no earlier scan;
 *   an empty array means the earlier scan genuinely saw no auth-grade names.
 * @returns {SignInVerdict}
 */
export function judgeSignIn(authGradeNames, everSeen = null) {
  if (!authGradeNames.length) return 'anonymous';
  if (everSeen === null) return 'unknown';

  const old = new Set(everSeen);
  if (authGradeNames.some((name) => !old.has(name))) return 'signedIn';

  // First sight may promote, never dismiss. The existing names may already belong to a
  // signed-in user, or one name may represent both anonymous and authenticated sessions.
  return 'unknown';
}
