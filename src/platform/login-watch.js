/**
 * A record of where the user has actually signed in, built by watching it happen.
 *
 * WHY NOT chrome.history.
 *
 * The obvious idea is to ask for history permission and infer accounts from visits. It is
 * the wrong instrument twice over. History answers "what pages did you open", which does
 * not distinguish reading a news article from holding an account — a single visit to
 * aol.com years ago looks identical to a daily inbox. And it is an enormous thing for a
 * privacy tool to ask for: every URL, with timestamps, forever, to answer a question about
 * domains.
 *
 * Cookies answer the actual question, with a permission the extension already holds
 * because it cannot work without it. A cookie that looks like a real auth token is an
 * account, observed directly rather than inferred.
 *
 * WHY NOT chrome.cookies.onChanged.
 *
 * Watching sign-ins as they happen was the first design, and it is worse. In MV3 an event
 * listener wakes the service worker, and that event fires for every cookie written
 * anywhere in the browser — analytics beacons, consent banners, ad pixels — hundreds a
 * minute during ordinary browsing, almost none of them sign-ins. The extension would spend
 * its life waking up to say "not that one".
 *
 * The cookie jar is already scanned in full whenever the popup opens or a run starts, so
 * the same conclusions are available at those moments for nothing. Harvesting there costs
 * no wakeups and captures a new sign-in the next time the list is looked at — which is
 * precisely when the list matters.
 *
 * WHAT IS STORED.
 *
 * A registrable domain and a timestamp. Not the cookie, not its value, not the URL, not
 * the page. The record never leaves the machine and is destroyed with the extension.
 *
 * It is persistent and cumulative by design: signing into a new site adds it, and it stays
 * known afterwards even once the cookie has been cleared — which matters, because the
 * extension's whole job is clearing those cookies, and a list that forgot a site the
 * moment it did its work would be useless.
 */

const KEY = 'observedLogins';
const MAX_ENTRIES = 800;

/** Re-recording the same domain on every request would be a write per page load. */
const RESTAMP_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * In-memory shadow of the stored record, so the hot path costs nothing once warm. The MV3
 * worker is killed every 30 seconds of idle, so this is a cache and never the truth.
 * @type {Map<string, number> | null}
 */
let cache = null;

/** @returns {Promise<Map<string, number>>} */
async function load() {
  if (cache) return cache;
  try {
    const stored = await chrome.storage.local.get(KEY);
    cache = new Map(Object.entries(stored[KEY] ?? {}));
  } catch {
    cache = new Map();
  }
  return cache;
}

/**
 * Merge a scan's conclusions into the record.
 *
 * Called with the domains a full cookie scan judged signed-in. Rewriting a timestamp on
 * every popup open would be a storage write per glance, so an entry is only restamped once
 * it has gone stale; a scan that learns nothing new writes nothing at all.
 *
 * @param {Iterable<string>} domains
 * @returns {Promise<string[]>} Domains recorded for the first time.
 */
export async function recordSignedIn(domains) {
  const seen = await load();
  const now = Date.now();
  /** @type {string[]} */
  const added = [];
  let dirty = false;

  for (const domain of domains) {
    if (!domain || domain === 'localhost') continue;
    const last = seen.get(domain);
    if (last === undefined) added.push(domain);
    else if (now - last < RESTAMP_AFTER_MS) continue;
    seen.set(domain, now);
    dirty = true;
  }

  if (dirty) await persist(seen);
  return added;
}

/** @param {Map<string, number>} seen */
async function persist(seen) {
  try {
    // Bounded, oldest evicted first. A record that grew without limit would be a slowly
    // expanding profile of the user, which is the thing this is supposed to avoid.
    if (seen.size > MAX_ENTRIES) {
      const keep = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES);
      cache = new Map(keep);
      seen = cache;
    }
    await chrome.storage.local.set({ [KEY]: Object.fromEntries(seen) });
  } catch {
    // Losing an observation is survivable; the cookie heuristic still stands alone.
  }
}

/** @returns {Promise<Set<string>>} */
export async function observedLogins() {
  return new Set((await load()).keys());
}

/** @returns {Promise<Record<string, number>>} */
export async function observedLoginTimes() {
  return Object.fromEntries(await load());
}

export async function clearObservedLogins() {
  cache = new Map();
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // Ignore.
  }
}
