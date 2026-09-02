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
 *   signedIn  A cookie that looks like a real auth token, or a sign-in already recorded.
 *             The direct answer to the actual question.
 *   acted     This extension has signed the user out of it before, so there was an
 *             account, even if the cookies proving it are the ones we removed.
 *
 * `open` and `frequent` are deliberately NOT among them. They say a site matters to the
 * user, not that the user has an account on it — and being open in a tab was how ebay.com
 * reached a list headed SIGNED IN while its sign-in form sat unfilled on screen. They
 * order the list; they never join it.
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
 * @property {Set<string>} [unconfirmed] Session-bearing cookies, nothing checked yet.
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

/**
 * Reasons that put a site on the list. Both are evidence of an *account*, which is the
 * only thing being asked.
 */
const QUALIFYING = /** @type {const} */ ([
  ['signedIn', 'signed in here'],
  ['acted', 'you have signed out of this before'],
  // Ranked last, and worded as the doubt it is. A site whose cookies look session-bearing
  // but which nothing has checked yet is worth showing - hiding every unchecked site left
  // the list holding one entry, which is its own kind of wrong - but it must not be
  // claimed as an account. This is the row that disappears once the site is asked.
  ['unconfirmed', 'cookies look like a sign-in, not confirmed yet']
]);

/**
 * Signals that say a site matters to the user but not that they have an account on it.
 *
 * These used to qualify a site for the list, and being open in a tab was the strongest of
 * them. It is also the exact counterexample: sitting on ebay.com's sign-in page, not
 * signed in, having never had an account, put ebay.com on a list headed SIGNED IN. Being
 * somewhere is not the same as belonging there, so these now only break ties.
 */
const CONTEXT = /** @type {const} */ ([
  ['open', 'open in a tab now'],
  ['frequent', 'one of your most-visited sites']
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
  return QUALIFYING.filter(([key]) => signals[key]?.has(site.domain)).map(([, label]) => label);
}

/**
 * Context that affects ordering but never inclusion.
 *
 * @param {SiteLike} site
 * @param {RelevanceSignals} signals
 * @returns {string[]}
 */
export function contextFor(site, signals) {
  return CONTEXT.filter(([key]) => signals[key]?.has(site.domain)).map(([, label]) => label);
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
  const weight = (/** @type {any} */ s) => (s.reasons?.length ?? 0) + (s.context?.length ?? 0);
  return (
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    weight(b) - weight(a) ||
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
    const entry = { ...site, reasons, context: contextFor(site, signals) };
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
