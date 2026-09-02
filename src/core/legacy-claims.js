/**
 * Downgrade security claims saved before v0.34.0.
 *
 * Older versions used `loggedOut` after reaching a site control and could persist
 * `revoked` from recipes whose global behavior was not trustworthy. There is no version
 * marker on those individual records, so an upgrade must choose the weaker safe meaning.
 *
 * Pure - no chrome.* here.
 */

const LEGACY_DETAIL =
  'Saved by an older version; sign-out was attempted, but server-side invalidation was not independently verified.';

/** @param {string} outcome */
function safeOutcome(outcome) {
  return outcome === 'loggedOut' || outcome === 'revoked' ? 'logoutAttempted' : outcome;
}

/**
 * @param {Record<string, any>} coverage
 * @param {any} runtimeState
 * @returns {{ coverage: Record<string, any>, runtimeState: any }}
 */
export function downgradeLegacyClaims(coverage = {}, runtimeState = {}) {
  const safeCoverage = Object.fromEntries(
    Object.entries(coverage).map(([domain, entry]) => [
      domain,
      { ...entry, outcome: safeOutcome(entry?.outcome) }
    ])
  );

  const report = runtimeState?.lastReport;
  if (!report || !Array.isArray(report.sites)) {
    return { coverage: safeCoverage, runtimeState };
  }

  const sites = report.sites.map((site) => {
    const outcome = safeOutcome(site?.outcome);
    return outcome === site?.outcome
      ? site
      : { ...site, outcome, detail: LEGACY_DETAIL };
  });

  return {
    coverage: safeCoverage,
    runtimeState: { ...runtimeState, lastReport: { ...report, sites } }
  };
}
