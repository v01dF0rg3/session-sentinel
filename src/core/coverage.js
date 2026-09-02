/**
 * How well the extension actually reaches each site's sign-out.
 *
 * Four sites have a hand-written recipe. Every other site relies on a generic fallback
 * that probes for a logout URL and, failing that, hunts the homepage for a sign-out link.
 * Whether that fallback works on most sites or almost none has never been measured — and
 * without measuring it, adding recipes means picking sites by intuition, which is exactly
 * how twelve recipes came to be written for pages nobody had looked at.
 *
 * So the extension counts whether it reached a logout route or control. That is useful
 * coverage evidence, but it is deliberately not called proof that a copied token died.
 *
 * Pure - no chrome.* here.
 */

/** @typedef {import('../engine/logout.js').LogoutMethod} LogoutMethod */

/**
 * @typedef {object} CoverageEntry
 * @property {string} domain
 * @property {'revoked' | 'logoutAttempted' | 'cleared' | 'failed' | 'loggedOut'} outcome
 *   `loggedOut` is accepted only for records written by older versions.
 * @property {LogoutMethod} method Which tier did the work, or 'none'.
 * @property {boolean} attempted A website sign-out route or control was tried at all.
 * @property {number} at
 * @property {number} runs
 */

/** Human labels for what did the work. */
export const METHOD_LABELS = {
  recipe: 'built-in recipe',
  oidc: 'OpenID Connect',
  path: 'logout URL found by probing',
  home: 'sign-out link on the homepage',
  none: 'nothing worked'
};

/**
 * @typedef {object} CoverageSummary
 * @property {number} total Sites with a recorded result.
 * @property {number} attempted Sites where website sign-out was tried.
 * @property {number} logoutReached Sites where a logout route or control was reached.
 * @property {number} verifiedRevoked Sites with separately verified revoke-everywhere.
 * @property {number} clearedOnly Sites where only local clearance was confirmed.
 * @property {number} failed
 * @property {number | null} reachRate Percentage of attempts that reached sign-out UI.
 * @property {Record<string, number>} byMethod
 * @property {CoverageEntry[]} needsRecipe Attempted, and nothing worked.
 */

/**
 * @param {CoverageEntry[]} entries
 * @returns {CoverageSummary}
 */
export function summariseCoverage(entries) {
  /** @type {Record<string, number>} */
  const byMethod = {};
  let attempted = 0;
  let logoutReached = 0;
  let verifiedRevoked = 0;
  let clearedOnly = 0;
  let failed = 0;
  /** @type {CoverageEntry[]} */
  const needsRecipe = [];

  for (const entry of entries) {
    if (entry.outcome === 'failed') {
      failed += 1;
      continue;
    }

    // Only attempts count towards the reach rate. A site below the tier threshold was never
    // tried, so counting it as a miss would blame the fallback for a decision the planner
    // made — and make the number meaningless.
    if (!entry.attempted) continue;
    attempted += 1;

    byMethod[entry.method] = (byMethod[entry.method] ?? 0) + 1;

    if (
      entry.outcome === 'revoked' ||
      entry.outcome === 'logoutAttempted' ||
      entry.outcome === 'loggedOut'
    ) {
      logoutReached += 1;
      if (entry.outcome === 'revoked') verifiedRevoked += 1;
    } else {
      clearedOnly += 1;
      needsRecipe.push(entry);
    }
  }

  return {
    total: entries.length,
    attempted,
    logoutReached,
    verifiedRevoked,
    clearedOnly,
    failed,
    reachRate: attempted === 0 ? null : Math.round((logoutReached / attempted) * 100),
    byMethod,
    // Most-recently-seen first: the sites the user actually touches are the ones worth a
    // recipe, and a list nobody can read is a list nobody acts on.
    needsRecipe: needsRecipe.sort((a, b) => b.at - a.at)
  };
}

/**
 * One honest sentence about coverage, or null when there is nothing to say yet.
 * @param {CoverageSummary} summary
 * @returns {string | null}
 */
export function describeCoverage(summary) {
  if (summary.attempted === 0) {
    return summary.total === 0
      ? null
      : 'No site has had website sign-out attempted yet, so there is nothing to measure.';
  }
  const verified = summary.verifiedRevoked
    ? ` ${summary.verifiedRevoked} had separately verified revoke-everywhere behavior.`
    : ' None had separately verified revoke-everywhere behavior.';
  return `${summary.logoutReached} of ${summary.attempted} attempts reached a site sign-out route or control (${summary.reachRate}%). This does not prove a copied token was invalidated.${verified}`;
}
