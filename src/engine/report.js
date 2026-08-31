/**
 * The result model.
 *
 * The single most important thing this extension does is tell the truth about what it
 * achieved. "Log out of all sessions" means three different things depending on the
 * site, and a tool that paints everything green when it only deleted local cookies is
 * actively dangerous - the user stops worrying about a session that is still live.
 *
 *   'revoked'  green  - the site confirmed sessions were killed on other devices too
 *   'loggedOut' amber - this browser's session was ended server-side, others unknown
 *   'cleared'   amber - local session material destroyed; the token may still work
 *                       elsewhere if it was already stolen
 *   'failed'    red   - we could not do even that
 */

/** @typedef {'revoked' | 'loggedOut' | 'cleared' | 'failed'} SiteOutcome */

/**
 * @typedef {object} SiteResult
 * @property {string} domain
 * @property {import('../core/risk.js').RiskTier} tier
 * @property {SiteOutcome} outcome
 * @property {string} detail Human-readable, shown in the UI.
 * @property {number} tabsRefreshed Tabs parked and sent back, never closed.
 * @property {boolean} verified Local clearance confirmed by re-reading the cookie jar.
 * @property {import('../core/session-pages.js').RevokeGuidance | null} [revokeGuidance]
 *   What would actually end this site's sessions on other devices - a link to its session
 *   list, or a password change where the site offers nothing else. Present whenever the
 *   run could not revoke them itself, which is currently always.
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
  const loggedOut = report.sites.filter((s) => s.outcome === 'loggedOut').length;
  const cleared = report.sites.filter((s) => s.outcome === 'cleared').length;
  const failed = report.sites.filter((s) => s.outcome === 'failed').length;

  /** @type {string[]} */
  const parts = [];
  if (revoked) parts.push(`${revoked} revoked everywhere`);
  if (loggedOut) parts.push(`${loggedOut} signed out`);
  if (cleared) parts.push(`${cleared} cleared locally`);
  if (failed) parts.push(`${failed} failed`);
  return `${total} site${total === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}
