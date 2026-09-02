/**
 * Which of the user's signed-in sites are worth putting in front of them.
 *
 * Cookie discovery finds every registrable domain with an auth-looking cookie, which on a
 * real profile is hundreds. Most of them are sites the user touched once a year ago, or an
 * SSO shell they have never visited directly. A list that long is not a list — it is a
 * wall, and a wall gets scrolled past rather than read.
 *
 * So the list is split rather than trimmed. Nothing is hidden from the *run*: the logout
 * still covers everything the plan covers, and the scope line still states the true total.
 * This only decides what is shown first. A display filter that quietly narrowed what gets
 * cleared would be the same class of lie as reporting `revoked` for an orphaned session.
 *
 * SIGNALS, AND WHY THESE ONES.
 *
 * There is no browser API for "how often do you use this site" that does not cost far more
 * privacy than the question is worth — chrome.history would hand us every page the user
 * has ever opened, with timestamps, to answer a question about domains. So relevance is
 * assembled from signals we already hold for other reasons:
 *
 *   signedIn  A cookie that looks like a real auth token, or a sign-in this extension
 *             watched happen. The direct answer to the actual question.
 *   open      The site is open in a tab right now. Free, and needs no permission we do
 *             not already have.
 *   frequent  Chrome's own top-sites list. Optional permission, off by default.
 *   acted     The user has already run a logout on this site. They cared once.
 *
 * An earlier version also promoted anything in the curated high-value list, reasoning that
 * a bank behind a disclosure was worse than a longer list. That was compensating for a
 * sign-in signal too weak to trust — and it put aol.com in front of a user who has no AOL
 * account. With a signal that answers the question directly, the compensation is not only
 * unnecessary, it is the bug: a bank the user is signed into shows because they are signed
 * into it, and one they are not does not need the space.
 *
 * The set grows as the extension is used, which is the right direction: day one shows the
 * handful of tabs that are open, and it gets more useful from there.
 *
 * Pure - no chrome.* here.
 */

/**
 * @typedef {object} RelevanceSignals
 * @property {Set<string>} [signedIn] Domains with real evidence of an account.
 * @property {Set<string>} [open] Domains with a tab open right now.
 * @property {Set<string>} [frequent] Domains from chrome.topSites, when granted.
 * @property {Set<string>} [acted] Domains the extension has run on before.
 */

/**
 * @typedef {object} SiteLike
 * @property {string} domain
 * @property {'critical' | 'high' | 'medium' | 'low'} tier
 * @property {string} [mode]
 */

/** Why a site earned its place, strongest first. The order is the ranking. */
const REASONS = /** @type {const} */ ([
  ['signedIn', 'signed in here'],
  ['open', 'open in a tab now'],
  ['frequent', 'one of your most-visited sites'],
  ['acted', 'you have signed out of this before']
]);

const TIER_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Every reason this site is worth showing, strongest first. Empty means it is not.
 *
 * @param {SiteLike} site
 * @param {RelevanceSignals} signals
 * @returns {string[]}
 */
export function reasonsToShow(site, signals) {
  const held = {
    signedIn: signals.signedIn?.has(site.domain) ?? false,
    open: signals.open?.has(site.domain) ?? false,
    frequent: signals.frequent?.has(site.domain) ?? false,
    acted: signals.acted?.has(site.domain) ?? false
  };

  return REASONS.filter(([key]) => held[key]).map(([, label]) => label);
}

/**
 * Rank within the shown list: sensitivity first, then strength of evidence, then name.
 *
 * Sensitivity leads for the same reason it leads in the recovery plan — a site used daily
 * is not more dangerous to lose than a bank used twice a year. Evidence of use breaks ties
 * inside a tier, where it is a genuinely good signal.
 *
 * @param {SiteLike & { reasons?: string[] }} a
 * @param {SiteLike & { reasons?: string[] }} b
 */
export function compareSites(a, b) {
  return (
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    (b.reasons?.length ?? 0) - (a.reasons?.length ?? 0) ||
    a.domain.localeCompare(b.domain)
  );
}

/**
 * @template {SiteLike} T
 * @typedef {object} Partitioned
 * @property {(T & { reasons: string[] })[]} used Sites to show first.
 * @property {(T & { reasons: string[] })[]} other Everything else, behind a disclosure.
 * @property {boolean} narrowed The split actually hid something.
 */

/**
 * Split the discovered sites into "yours" and "the rest".
 *
 * A site the user has explicitly told us to keep is always shown: they made a decision
 * about it, and burying that decision where they cannot find it to reverse makes the
 * setting useless.
 *
 * @template {SiteLike} T
 * @param {T[]} sites
 * @param {RelevanceSignals} signals
 * @returns {Partitioned<T>}
 */
export function partitionSites(sites, signals = {}) {
  /** @type {any[]} */
  const used = [];
  /** @type {any[]} */
  const other = [];

  for (const site of sites) {
    const reasons = reasonsToShow(site, signals);
    const entry = { ...site, reasons };
    if (reasons.length || site.mode === 'ignored') used.push(entry);
    else other.push(entry);
  }

  used.sort(compareSites);
  other.sort(compareSites);

  // A split that hides two sites is not worth the disclosure control it costs. Below the
  // threshold, show everything and let the list be the list.
  if (other.length < 3) {
    return { used: [...used, ...other].sort(compareSites), other: [], narrowed: false };
  }

  return { used, other, narrowed: true };
}

/**
 * Group a list by tier for display, dropping empty groups.
 *
 * @template {SiteLike} T
 * @param {T[]} sites
 * @returns {{ tier: SiteLike['tier'], sites: T[] }[]}
 */
export function groupByTier(sites) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const site of sites) {
    const bucket = groups.get(site.tier);
    if (bucket) bucket.push(site);
    else groups.set(site.tier, [site]);
  }

  return /** @type {any} */ (
    [...groups.entries()]
      .sort((a, b) => TIER_ORDER[a[0]] - TIER_ORDER[b[0]])
      .map(([tier, list]) => ({ tier, sites: list }))
  );
}
