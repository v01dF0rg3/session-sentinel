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
 * Decide whether a site's cookies show an account.
 *
 * TWO KINDS OF BASELINE, AND ONLY ONE OF THEM PROVES ANYTHING.
 *
 * `baseline` is what the site hands a stranger. It is authoritative: a cookie on that list
 * is issued to people with no account, so a jar containing nothing else is not an account.
 * It is also, today, always null — Chrome will not surrender the `Set-Cookie` header.
 *
 * `everSeen` is what the domain already had the first time this extension looked. It is
 * NOT authoritative, and mistaking it for proof is what emptied the list twice. For a user
 * who was already signed in when the extension was installed, their real auth cookie is
 * sitting in that baseline. "Everything you have was there at first sight" therefore means
 * *we cannot tell*, not *you are anonymous*.
 *
 * So first sight can only ever promote, never dismiss. A cookie that appeared after we
 * started watching is a sign-in; everything else is a question for the user.
 *
 * @param {string[]} authGradeNames Names in the user's jar that look session-bearing.
 * @param {Baseline | null} baseline What a stranger receives. Authoritative; today null.
 * @param {string[] | null} [everSeen] Names at first sight. Null when never recorded, or
 *   when the record was written by this very pass and would only be judging itself.
 * @returns {SignInVerdict}
 */
export function judgeSignIn(authGradeNames, baseline, everSeen = null) {
  if (!authGradeNames.length) return 'anonymous';

  // With no yardstick at all, nothing survives to be measured against and every cookie
  // looks like a remainder. That is the original bug — bloomberg.com on a list headed
  // SIGNED IN — so the absence of evidence is checked before the measurement, not after.
  // An `everSeen` of [] is evidence: it says the domain had no auth cookies at first sight.
  // Null means no record, which is not the same thing.
  if (!baseline?.usable && everSeen === null) return 'unknown';

  // Promotion needs both sources to agree, where both exist. A cookie is evidence of an
  // account only if a stranger does not receive it AND it was not already there when we
  // started watching. Either one alone can be fooled: the stranger list is built from a
  // single fetch and misses cookies set deeper in a visit, and first sight contains the
  // user's own auth cookie whenever they were already signed in before installing.
  const ruledOut = new Set([...(baseline?.anonymous ?? []), ...(everSeen ?? [])]);
  if (authGradeNames.some((name) => !ruledOut.has(name))) return 'signedIn';

  // Dismissal is stricter, and only the stranger list may do it. Concluding "anonymous"
  // from first sight is what emptied the list twice: for a user signed in before install,
  // first sight holds their real auth cookie, so it explaining everything means nothing.
  if (baseline?.usable && authGradeNames.every((name) => baseline.anonymous.includes(name))) {
    return 'anonymous';
  }

  return 'unknown';
}

/**
 * @param {Iterable<string>} names
 * @returns {Baseline}
 */
export function baselineFrom(names) {
  const anonymous = [...new Set(names)].sort();
  return { anonymous, usable: anonymous.length > 0 };
}
