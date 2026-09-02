/**
 * The result model.
 *
 * The single most important thing this extension does is tell the truth about what it
 * achieved. "Attempt sign-out of confirmed accounts" can produce different results depending
 * on the site, and a tool that paints everything green when it only deleted local cookies
 * is actively dangerous - the user stops worrying about a session that is still live.
 *
 *   'revoked'         green - a separately verified revoke-everywhere recipe completed
 *   'logoutAttempted' amber - the site's sign-out route/control was used, but server-side
 *                             invalidation of a copied token was not independently proved
 *   'cleared'         amber - local session material destroyed; a stolen token may work
 *   'failed'          red   - we could not do even that
 *   'loggedOut'              - legacy persisted value, rendered as an attempt rather than
 *                              repeating the old unverified server-side claim
 */

/** @typedef {'revoked' | 'logoutAttempted' | 'cleared' | 'failed' | 'loggedOut'} SiteOutcome */

/**
 * @typedef {object} SiteResult
 * @property {string} domain
 * @property {import('../core/risk.js').RiskTier} tier
 * @property {SiteOutcome} outcome
 * @property {string} detail Human-readable, shown in the UI.
 * @property {number} tabsRefreshed User tabs successfully reloaded after local cleanup.
 * @property {boolean} verified Local clearance confirmed by re-reading the cookie jar.
 * @property {import('../core/session-pages.js').RevokeGuidance | null} [revokeGuidance]
 *   Provider-owned session and security controls to review when this run cannot verify
 *   revocation. Present whenever the run did not use a separately verified global recipe.
 */

/**
 * @typedef {object} RunReport
 * @property {import('../core/plan.js').Trigger} trigger
 * @property {number} startedAt
 * @property {number} finishedAt
 * @property {SiteResult[]} sites
 * @property {Array<{ domain: string, why: string }>} skipped
 */

/**
 * @param {SiteOutcome} outcome
 * @returns {'green' | 'amber' | 'red'}
 */
export function outcomeColor(outcome) {
  if (outcome === 'revoked') return 'green';
  if (outcome === 'failed') return 'red';
  return 'amber';
}

/**
 * One honest sentence summarising a run.
 * @param {RunReport} report
 * @returns {string}
 */
export function summarize(report) {
  const total = report.sites.length;
  if (total === 0) return 'Nothing to do.';

  const revoked = report.sites.filter((s) => s.outcome === 'revoked').length;
  const attempted = report.sites.filter(
    (s) => s.outcome === 'logoutAttempted' || s.outcome === 'loggedOut'
  ).length;
  const cleared = report.sites.filter((s) => s.outcome === 'cleared').length;
  const failed = report.sites.filter((s) => s.outcome === 'failed').length;

  /** @type {string[]} */
  const parts = [];
  if (revoked) {
    parts.push(`${revoked} verified revoke-everywhere recipe${revoked === 1 ? '' : 's'} completed`);
  }
  if (attempted) parts.push(`${attempted} site sign-out${attempted === 1 ? '' : 's'} attempted`);
  if (cleared) parts.push(`${cleared} cleared locally`);
  if (failed) parts.push(`${failed} failed`);
  return `${total} site${total === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}
