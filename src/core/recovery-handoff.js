/**
 * Portable recovery data. The export is an explicit allowlist, never a serialization of
 * a recovery response: those responses also contain URLs, shared identities and progress.
 * No URLs or previously checked boxes are carried to the other device as trusted advice.
 */
import { registrableDomain } from './domain.js';
import { recoveryCategory } from './compromise.js';
import { CATEGORY_ORDER } from '../../data/recovery-categories.js';
import {
  RECOVERY_BASELINE, RECOVERY_DEVICE_NOTE, RECOVERY_HANDOFF_NOTE,
  RECOVERY_LIMIT_NOTE, RECOVERY_STEPS
} from '../../data/recovery-checklist.js';

const TIER_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Accept domain names only. Reject URLs, addresses, local hosts and control characters;
 * do not salvage a hostname from an arbitrary URL supplied by an untrusted caller.
 * This uses the same compact public-suffix subset as account discovery. It is not a
 * proof that the domain exists or belongs to a legitimate service.
 * @param {unknown} value
 * @returns {string | null}
 */
export function recoveryDomain(value) {
  if (typeof value !== 'string' || value.length > 253) return null;
  const host = value.toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  if (/(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion)$/.test(host)) return null;
  return registrableDomain(host);
}

/**
 * @typedef {object} RecoveryHandoff
 * @property {1} version
 * @property {number} generatedAt
 * @property {{ domain: string, tier: 'critical' | 'high' | 'medium' | 'low', evidence: 'confirmed' }[]} accounts
 * @property {number} excludedCount Confirmed entries rejected by validation; no raw input.
 */

/**
 * The caller supplies ALL risk levels, independently of the on-screen scope.
 * An explicit false unverified flag is required; missing evidence fails closed.
 * @param {import('./compromise.js').RecoveryGroup[]} groups
 * @param {number} [generatedAt]
 * @returns {RecoveryHandoff}
 */
export function createRecoveryHandoff(groups, generatedAt = Date.now()) {
  if (!Array.isArray(groups) || !Number.isFinite(generatedAt) || !Number.isFinite(new Date(generatedAt).getTime())) {
    throw new Error('Cannot create a recovery plan from invalid data');
  }
  const accounts = new Map();
  let excludedCount = 0;
  for (const group of groups) {
    if (!Array.isArray(group?.steps)) throw new Error('Cannot create an incomplete recovery plan');
    for (const step of group.steps) {
      if (step?.unverified !== false) continue;
      const domain = recoveryDomain(step.domain);
      if (!domain || !Object.hasOwn(TIER_ORDER, step.tier)) {
        excludedCount++;
        continue;
      }
      const existing = accounts.get(domain);
      if (!existing || TIER_ORDER[step.tier] < TIER_ORDER[existing.tier]) {
        accounts.set(domain, { domain, tier: step.tier, evidence: 'confirmed' });
      }
    }
  }
  return {
    version: 1,
    generatedAt,
    accounts: [...accounts.values()].sort((a, b) =>
      CATEGORY_ORDER[recoveryCategory(a.domain)] - CATEGORY_ORDER[recoveryCategory(b.domain)] ||
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.domain.localeCompare(b.domain)
    ),
    excludedCount
  };
}

/** @param {RecoveryHandoff} plan */
export function recoveryHandoffText(plan) {
  return [
    'SESSION SENTINEL — RECOVERY PLAN',
    `Created: ${new Date(plan.generatedAt).toISOString()}`,
    '',
    RECOVERY_DEVICE_NOTE,
    '',
    'ALWAYS CHECK THESE ACCOUNTS — EVEN IF THEY ARE MISSING BELOW',
    ...RECOVERY_BASELINE.map((item) => `[ ] ${item.title}: ${item.detail}`),
    '',
    'FOR EACH ACCOUNT',
    ...RECOVERY_STEPS.map((item, i) => `${i + 1}. ${item.title}: ${item.detail}`),
    RECOVERY_LIMIT_NOTE,
    '',
    `CONFIRMED ACCOUNT DOMAINS (${plan.accounts.length}) — ALL RISK LEVELS`,
    'Confirmation means browser login evidence was found. This is not a live check of access.',
    ...plan.accounts.map((account) => `[ ] ${account.domain} | ${account.tier} risk | ${account.evidence}`),
    ...(plan.accounts.length ? [] : ['No confirmed account domains were available. Start with the checklist above.']),
    ...(plan.excludedCount ? [`${plan.excludedCount} confirmed entries were omitted because their domain or risk was invalid.`] : []),
    '',
    RECOVERY_HANDOFF_NOTE,
    '',
    'Review every login you use on each service; several accounts can share one domain.',
    'Keep this list private. It names services you use. No passwords, cookies, tokens or account usernames are included.',
    ''
  ].join('\n');
}
