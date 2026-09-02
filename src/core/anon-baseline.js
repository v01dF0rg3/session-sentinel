/**
 * Telling an authenticated session apart from an anonymous one.
 *
 * WHY THE PREVIOUS THREE ATTEMPTS FAILED.
 *
 * Every one of them tried to read authentication out of a cookie's name and flags:
 * generous name matching, then httpOnly as a discriminator, then a list of names that say
 * they are not sessions. Each fixed the reported site and left the rule wrong.
 *
 * They were wrong in principle, and the proof is bloomberg.com. Fetched with no cookies at
 * all, as a stranger, it hands back:
 *
 *     _session_id_backup    httpOnly  Secure  36-char opaque value
 *
 * That is indistinguishable from an authenticated session cookie because it *is* a session
 * cookie — an anonymous one. Bloomberg issues it before anyone signs in, to someone with
 * no account. No rule over names and flags can separate the two, because the difference is
 * not in the cookie. It is in whether the site issued it before or after a sign-in.
 *
 * THE TEST.
 *
 * Subtract what the site gives someone with no account from what the user actually has.
 * What remains was issued to *them*, in response to something a stranger cannot do.
 *
 * Asking the site directly turned out to be impossible: Chrome strips `Set-Cookie` from the
 * Headers object, and `getSetCookie()` returns nothing even for a same-origin `basic`
 * response, where nothing is CORS-filtered. Reading it needs `chrome.webRequest` with
 * `extraHeaders` — permission to observe all network traffic, which is a large thing for a
 * privacy tool to take in exchange for tidying a list.
 *
 * So the stranger's cookies are learned by watching instead: whatever a domain already had
 * the first time it was scanned predates anything we could have observed, and proves
 * nothing. A cookie that appears later is the sign-in. The `baseline` argument stays for
 * the day that becomes knowable; today it is always null.
 *
 *     bloomberg.com  stranger gets {_pxhd, session_id, _session_id_backup, agent_id,
 *                    session_key}; the user has exactly those. Remainder: nothing.
 *                    Not signed in.
 *
 *     github.com     stranger gets {_gh_sess, _octo, logged_in}; a signed-in user also
 *                    has user_session and dotcom_user. Remainder: two auth cookies.
 *                    Signed in.
 *
 * This asks the only party that actually knows, and it needs no curation, no allowlist of
 * frameworks, and no guessing about what a name means.
 *
 * WHAT IT COSTS, AND WHAT IT CANNOT DO.
 *
 * One request per site, credentials omitted, cached — the answer is a property of the
 * site, not of the user, and does not change day to day.
 *
 * One homepage fetch does not see every cookie a site sets across a whole visit; eBay's
 * `nonsession` arrives deeper in a session than the front page. So a name absent from the
 * baseline is not proof of authentication, only the absence of proof against it. The
 * baseline is therefore used as a *veto*, never as a confirmation: it can rule a site out,
 * and the local first-sight record rules out what it misses.
 *
 * Pure - no chrome.* and no fetch here.
 */

/**
 * @typedef {object} Baseline
 * @property {string[]} anonymous Cookie names a stranger receives.
 * @property {boolean} usable The probe actually learned something.
 */

/**
 * @typedef {'signedIn' | 'anonymous' | 'unknown'} SignInVerdict
 */

/**
 * Decide whether a site's cookies show an account, given what strangers receive.
 *
 * @param {string[]} authGradeNames Names in the user's jar that look session-bearing.
 * @param {Baseline | null} baseline Reserved: what a stranger receives, if ever knowable.
 * @param {string[]} [everSeen] Auth-grade names present the first time we saw this domain.
 * @returns {SignInVerdict}
 */
export function judgeSignIn(authGradeNames, baseline, everSeen = []) {
  if (!authGradeNames.length) return 'anonymous';

  // Order matters here, and getting it wrong is the original bug in a new costume. With
  // nothing to subtract, every cookie survives the subtraction and the site looks signed
  // in — which is precisely how bloomberg.com got onto a list headed SIGNED IN. So the
  // absence of a yardstick has to be checked BEFORE the measurement, not after it.
  if (!baseline?.usable && !everSeen.length) return 'unknown';

  // Anything a stranger is handed cannot be evidence of an account. Same for anything that
  // was already there the first time this domain was seen - it predates any sign-in we
  // could have observed, so it proves nothing either.
  const ruledOut = new Set([...(baseline?.anonymous ?? []), ...everSeen]);
  const remainder = authGradeNames.filter((name) => !ruledOut.has(name));

  // What is left was issued to this user, in response to something a stranger cannot do.
  return remainder.length ? 'signedIn' : 'anonymous';
}

/**
 * @param {Iterable<string>} names
 * @returns {Baseline}
 */
export function baselineFrom(names) {
  const anonymous = [...new Set(names)].sort();
  return { anonymous, usable: anonymous.length > 0 };
}
