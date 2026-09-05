/**
 * The result model.
 *
 * The single most important thing this extension does is tell the truth about what it
 * achieved. "Attempt sign-out of confirmed accounts" can produce different results depending
 * on the site, and a tool that paints everything green when it only deleted local cookies
 * is actively dangerous - the user stops worrying about a session that is still live.
 *
 *   'logoutAttempted' amber - the site's sign-out route/control was used, but server-side
 *                             invalidation of a copied token was not independently proved
 *   'cleared'         amber - cookie readback was empty; requested known-origin storage
 *                             removals were acknowledged, not independently read back
 *   'failed'          red   - local cleanup or its verification needs attention
 *   'loggedOut'/'revoked'    - legacy persisted values, rendered as attempts rather than
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
 * @property {boolean} verified Cookie readback was empty; not storage or remote verification.
 * @property {'attempted' | 'notAttempted'} [serverAction] Independent of the local result.
 * @property {ReturnType<typeof cleanupEvidence>} [localCleanup]
 * @property {import('../core/session-pages.js').RevokeGuidance | null} [revokeGuidance]
 *   Provider-owned session and security controls to review when this run cannot verify
 *   revocation. Always offered; a past recipe test cannot prove a current token is invalid.
 */

/**
 * @typedef {object} RunReport
 * @property {import('../core/plan.js').Trigger} trigger
 * @property {number} startedAt
 * @property {number} finishedAt
 * @property {SiteResult[]} sites
 * @property {'running' | 'complete'} [status]
 * @property {string[]} [pending] No completed result recorded for these sites.
 * @property {Array<{ domain: string, why: string }>} skipped
 */

/**
 * @param {SiteOutcome} outcome
 * @returns {'green' | 'amber' | 'red'}
 */
export function outcomeColor(outcome) {
  if (outcome === 'failed') return 'red';
  return 'amber';
}

/** Separate browser observations from a website action. No field claims remote safety. */
export function cleanupEvidence(wipe, check) {
  return {
    status: wipe.ok && check.status === 'cleared' ? 'complete' : 'incomplete',
    cookies: check.status,
    remainingCookies: check.remainingCount,
    acceptedTypes: [...wipe.cleared],
    failedTypes: [...wipe.failed],
    knownOriginCount: wipe.originCount ?? 0,
    warnings: [...(wipe.warnings ?? [])]
  };
}

export function localEvidenceText(evidence) {
  if (!evidence) return 'Detailed local evidence was not recorded by this version.';
  const cookies = evidence.cookies === 'cleared'
    ? 'No cookies visible in this profile at the check (including partitions).'
    : evidence.cookies === 'remaining'
      ? `${evidence.remainingCookies} cookie(s) remained or returned; local cleanup needs attention.`
      : 'Cookie readback unavailable; local cleanup could not be verified.';
  const storage = evidence.acceptedTypes.filter((type) => type !== 'cookies');
  const storageNote = storage.length
    ? ` Chrome accepted ${storage.join(', ')} cleanup for ${evidence.knownOriginCount} known origins; their contents were not independently read back.` : '';
  const failures = evidence.failedTypes.length ? ` Not cleared or verified: ${evidence.failedTypes.join(', ')}.` : '';
  return cookies + storageNote + failures + (evidence.warnings.length ? ` ${evidence.warnings.join(' ')}` : '');
}

/**
 * One honest sentence summarising a run.
 * @param {RunReport} report
 * @returns {string}
 */
export function summarize(report) {
  const total = report.sites.length;
  if (report.status === 'running') {
    return `Incomplete run: ${total} site result(s) recorded; ${report.pending?.length ?? 0} unfinished. Final completion was not recorded.`;
  }
  if (total === 0) return report.skipped?.some((s) => s.why === 'a run is already in progress')
    ? 'Another cleanup is already running. No second run was started.' : 'No sites were processed.';

  const attempted = report.sites.filter(
    (s) => s.outcome === 'logoutAttempted' || s.outcome === 'loggedOut' || s.outcome === 'revoked'
  ).length;
  const cleared = report.sites.filter((s) => s.outcome === 'cleared').length;
  const failed = report.sites.filter((s) => s.outcome === 'failed').length;

  /** @type {string[]} */
  const parts = [];
  if (attempted) parts.push(`${attempted} site sign-out${attempted === 1 ? '' : 's'} attempted`);
  if (cleared) parts.push(`${cleared} cleared locally`);
  if (failed) parts.push(`${failed} need${failed === 1 ? 's' : ''} attention`);
  return `${total} site${total === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

/** Preserve failed/unfinished startup work even if its cookies have already disappeared. */
export function retryDomains(report, requested = []) {
  if (report.skipped?.some((s) => s.why === 'a run is already in progress')) return [...requested];
  return [...new Set([
    ...report.sites.filter((site) => site.outcome === 'failed').map((site) => site.domain),
    ...(report.pending ?? [])
  ])];
}
