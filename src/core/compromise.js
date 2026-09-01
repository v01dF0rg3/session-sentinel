/**
 * Breach recovery: what to secure, in what order.
 *
 * The compromise prompt answers "what do I do about this account". This answers the
 * harder question someone actually has on a bad day: "my email was breached — what else
 * is exposed, and in what order do I fix it?"
 *
 * Order is the substance. Securing a bank before the mailbox that receives its
 * password-reset link is wasted work: the attacker resets it again. So identity comes
 * first, always, regardless of how the risk tiers rank things.
 *
 * Pure - no chrome.* - so the ordering can be tested without a browser.
 */

import { CATEGORY_KEYWORDS, CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_WHY, DOMAIN_CATEGORY } from '../../data/recovery-categories.js';
import { atLeast, classify } from './risk.js';
import { compromiseAdviceFor } from './session-pages.js';
import { resolveTier } from './plan.js';
import { siblingsOf } from './identity.js';

/** @typedef {import('../../data/recovery-categories.js').RecoveryCategory} RecoveryCategory */
/** @typedef {import('./risk.js').RiskTier} RiskTier */

/**
 * @typedef {object} RecoveryStep
 * @property {string} domain
 * @property {RiskTier} tier
 * @property {RecoveryCategory} category
 * @property {string} [passwordUrl] Direct link, where one is known.
 * @property {string} siteUrl Always present, as a starting point.
 * @property {string} [sessionsUrl]
 * @property {string} [sessionsLabel]
 * @property {string[]} sharesSignInWith Accounts secured by the same password.
 * @property {boolean} frequent The user visits this site often.
 */

/**
 * @typedef {object} RecoveryGroup
 * @property {RecoveryCategory} category
 * @property {string} label
 * @property {string} why
 * @property {RecoveryStep[]} steps
 */

/**
 * Which bucket a site belongs in for recovery purposes.
 * @param {string} domain
 * @returns {RecoveryCategory}
 */
export function recoveryCategory(domain) {
  const listed = DOMAIN_CATEGORY[domain];
  if (listed) return listed;

  for (const [known, category] of Object.entries(DOMAIN_CATEGORY)) {
    if (domain.endsWith(`.${known}`)) return category;
  }
  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(domain)) return category;
  }
  return 'other';
}

/**
 * Build an ordered recovery plan from the sites the user is signed into.
 *
 * Only sites at or above `minTier` are included. A breach response listing two hundred
 * forums is one nobody finishes, and an unfinished recovery leaves the important accounts
 * unsecured just as surely as no recovery at all.
 *
 * The user's "never clear" list is deliberately ignored here. That list governs what may
 * be *destroyed*; this destroys nothing, it opens password pages. A compromised account
 * the user asked not to log out of is still a compromised account.
 *
 * @param {string[]} domains Sites the user is signed into.
 * @param {import('./policy.js').Settings} settings
 * @param {RiskTier} [minTier]
 * @param {Set<string>} [frequent] Domains the user visits often, if known.
 * @returns {RecoveryGroup[]}
 */
export function buildRecoveryPlan(domains, settings, minTier = 'high', frequent = new Set()) {
  /** @type {Map<RecoveryCategory, RecoveryStep[]>} */
  const byCategory = new Map();
  const included = new Set(domains);

  for (const domain of new Set(domains)) {
    const { tier } = resolveTier(domain, settings);
    if (!atLeast(tier, minTier)) continue;

    const advice = compromiseAdviceFor(domain);
    const category = recoveryCategory(domain);

    /** @type {RecoveryStep} */
    const step = {
      domain,
      tier,
      category,
      passwordUrl: advice?.passwordUrl,
      siteUrl: advice?.siteUrl ?? `https://${domain}`,
      sessionsUrl: advice?.sessionsUrl,
      sessionsLabel: advice?.sessionsLabel,
      // A shared sign-in means one password change covers several accounts - worth
      // saying, so the user does not hunt for a password page that does not exist.
      sharesSignInWith: siblingsOf(domain).filter((d) => included.has(d)),
      frequent: frequent.has(domain)
    };

    const list = byCategory.get(category) ?? [];
    list.push(step);
    byCategory.set(category, list);
  }

  const tierOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  return [...byCategory.entries()]
    .sort(([a], [b]) => CATEGORY_ORDER[a] - CATEGORY_ORDER[b])
    .map(([category, steps]) => ({
      category,
      label: CATEGORY_LABELS[category],
      why: CATEGORY_WHY[category],
      // Tier first, because that is a security judgement. Frequency only breaks ties:
      // given two equally critical accounts, the one the user actually lives in is the
      // one to secure first. It never promotes a site past a more sensitive one.
      steps: steps.sort(
        (a, b) =>
          tierOrder[a.tier] - tierOrder[b.tier] ||
          Number(b.frequent) - Number(a.frequent) ||
          a.domain.localeCompare(b.domain)
      )
    }));
}

/**
 * @param {RecoveryGroup[]} groups
 * @returns {number}
 */
export function countSteps(groups) {
  return groups.reduce((total, group) => total + group.steps.length, 0);
}

/**
 * Progress through a plan, given which domains are already done.
 *
 * @param {RecoveryGroup[]} groups
 * @param {string[]} done
 * @returns {{ done: number, total: number, nextDomain: string | null }}
 */
export function recoveryProgress(groups, done) {
  const doneSet = new Set(done);
  const all = groups.flatMap((g) => g.steps.map((s) => s.domain));
  const next = all.find((d) => !doneSet.has(d)) ?? null;
  return { done: all.filter((d) => doneSet.has(d)).length, total: all.length, nextDomain: next };
}
