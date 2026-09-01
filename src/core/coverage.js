/**
 * How well the extension actually reaches each site's sign-out.
 *
 * Four sites have a hand-written recipe. Every other site relies on a generic fallback
 * that probes for a logout URL and, failing that, hunts the homepage for a sign-out link.
 * Whether that fallback works on most sites or almost none has never been measured — and
 * without measuring it, adding recipes means picking sites by intuition, which is exactly
 * how twelve recipes came to be written for pages nobody had looked at.
 *
 * So the extension counts its own results. Ordinary use becomes the evidence.
 *
 * Pure - no chrome.* here.
 */

/** @typedef {import('../engine/logout.js').LogoutMethod} LogoutMethod */

/**
 * @typedef {object} CoverageEntry
 * @property {string} domain
 * @property {'revoked' | 'loggedOut' | 'cleared' | 'failed'} outcome
 * @property {LogoutMethod} method Which tier did the work, or 'none'.
 * @property {boolean} attempted A server-side logout was tried at all.
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
 * @property {number} attempted Sites where a server-side logout was tried.
 * @property {number} endedSession Sites whose session was actually ended.
 * @property {number} clearedOnly Sites where the session was left running.
 * @property {number} failed
 * @property {number | null} hitRate Percentage of attempts that ended a session.
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
  let endedSession = 0;
  let clearedOnly = 0;
  let failed = 0;
  /** @type {CoverageEntry[]} */
  const needsRecipe = [];

  for (const entry of entries) {
    if (entry.outcome === 'failed') {
      failed += 1;
      continue;
    }

    // Only attempts count towards the hit rate. A site below the tier threshold was never
    // tried, so counting it as a miss would blame the fallback for a decision the planner
    // made — and make the number meaningless.
    if (!entry.attempted) continue;
    attempted += 1;

    byMethod[entry.method] = (byMethod[entry.method] ?? 0) + 1;

    if (entry.outcome === 'revoked' || entry.outcome === 'loggedOut') {
      endedSession += 1;
    } else {
      clearedOnly += 1;
      needsRecipe.push(entry);
    }
  }

  return {
    total: entries.length,
    attempted,
    endedSession,
    clearedOnly,
    failed,
    hitRate: attempted === 0 ? null : Math.round((endedSession / attempted) * 100),
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
      : 'No site has had a server-side logout attempted yet, so there is nothing to measure.';
  }
  return `${summary.endedSession} of ${summary.attempted} sites had their session actually ended (${summary.hitRate}%).`;
}
