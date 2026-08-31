/**
 * Turns "these sites, this trigger, these settings" into an explicit list of actions.
 * Pure - no chrome.* here, which is what makes the destructive logic testable.
 */

import { atLeast, classify } from './risk.js';
import { DEPTH_DATA_TYPES } from './policy.js';
import { domainToOrigin } from './domain.js';

/** @typedef {import('./risk.js').RiskTier} RiskTier */
/** @typedef {import('./policy.js').Settings} Settings */
/** @typedef {import('./policy.js').WipeDepth} WipeDepth */

/** @typedef {'manual' | 'manualSite' | 'browserClose' | 'idle' | 'lock'} Trigger */

/**
 * @typedef {object} PlannedTarget
 * @property {string} domain Registrable domain.
 * @property {string} origin
 * @property {RiskTier} tier
 * @property {string} tierReason
 * @property {WipeDepth} depth
 * @property {string[]} dataTypes
 * @property {boolean} serverLogout Attempt to invalidate the session server-side.
 */

/**
 * @typedef {object} Plan
 * @property {Trigger} trigger
 * @property {PlannedTarget[]} targets
 * @property {Array<{ domain: string, why: string }>} skipped
 */

/**
 * Resolve a domain's effective tier, honouring manual overrides.
 * @param {string} domain
 * @param {Settings} settings
 * @returns {{ tier: RiskTier, reason: string, mode: import('./policy.js').SiteMode }}
 */
export function resolveTier(domain, settings) {
  const override = settings.sites[domain];
  const classified = classify(domain);

  if (override?.tier) {
    return { tier: override.tier, reason: 'set by you', mode: override.mode ?? 'default' };
  }
  if (override?.mode === 'protected') {
    // "Protected" means the user asked for the strongest handling regardless of what
    // the classifier thinks the site is.
    return { tier: 'critical', reason: 'always protected', mode: 'protected' };
  }
  return { tier: classified.tier, reason: classified.reason, mode: override?.mode ?? 'default' };
}

/**
 * The minimum tier a trigger acts on, or null when that trigger is switched off.
 * @param {Trigger} trigger
 * @param {Settings} settings
 * @returns {RiskTier | null}
 */
function triggerFloor(trigger, settings) {
  switch (trigger) {
    // An explicit click means the user asked for everything.
    case 'manual':
    case 'manualSite':
      return 'low';
    case 'browserClose':
      return settings.onBrowserClose.enabled ? settings.onBrowserClose.minTier : null;
    case 'idle':
      return settings.onIdle.enabled ? settings.onIdle.minTier : null;
    case 'lock':
      return settings.onLock.enabled ? settings.onLock.minTier : null;
    default:
      return null;
  }
}

/**
 * @param {string[]} domains Candidate registrable domains.
 * @param {Trigger} trigger
 * @param {Settings} settings
 * @returns {Plan}
 */
export function buildPlan(domains, trigger, settings) {
  /** @type {PlannedTarget[]} */
  const targets = [];
  /** @type {Array<{ domain: string, why: string }>} */
  const skipped = [];

  const floor = triggerFloor(trigger, settings);
  const automatic = trigger !== 'manual' && trigger !== 'manualSite';

  if (!settings.enabled) {
    return { trigger, targets: [], skipped: domains.map((d) => ({ domain: d, why: 'extension paused' })) };
  }

  // Nothing destructive happens on a schedule until the user has been told what the
  // schedule does. Enforced here rather than in the event handlers so no future trigger
  // can be added that quietly bypasses it.
  if (automatic && !settings.onboarded) {
    return { trigger, targets: [], skipped: domains.map((d) => ({ domain: d, why: 'setup not finished yet' })) };
  }
  if (floor === null) {
    return { trigger, targets: [], skipped: domains.map((d) => ({ domain: d, why: 'trigger disabled' })) };
  }

  for (const domain of new Set(domains)) {
    const { tier, reason, mode } = resolveTier(domain, settings);

    // An ignored site is ignored by automatic triggers and by "log out everywhere".
    // Only an explicit per-site action reaches it - otherwise people lose work they
    // deliberately asked us to leave alone, and that is how a security tool gets
    // uninstalled.
    if (mode === 'ignored' && trigger !== 'manualSite') {
      skipped.push({ domain, why: 'on your ignore list' });
      continue;
    }
    if (!atLeast(tier, floor)) {
      skipped.push({ domain, why: `below the ${floor} threshold for this trigger` });
      continue;
    }

    const depth = settings.depthByTier[tier];
    targets.push({
      domain,
      origin: domainToOrigin(domain),
      tier,
      tierReason: reason,
      depth,
      dataTypes: DEPTH_DATA_TYPES[depth],
      serverLogout: settings.serverLogout.enabled && atLeast(tier, settings.serverLogout.minTier)
    });
  }

  // Highest risk first: if the service worker is torn down mid-run, the sites that
  // mattered most are already done.
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  targets.sort((a, b) => order[a.tier] - order[b.tier] || a.domain.localeCompare(b.domain));

  return { trigger, targets, skipped };
}
