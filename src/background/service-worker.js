/**
 * Event wiring. All logic lives in core/ and engine/; this file only decides *when*.
 *
 * The browser-close story is the subtle one. MV3 gives no dependable shutdown hook -
 * chrome.runtime.onSuspend is unreliable, and a crash, a kill, or an OS shutdown skips
 * it entirely. So closing is handled twice:
 *
 *   1. Best effort on windows.onRemoved when the last window goes. Often completes.
 *   2. Authoritatively on runtime.onStartup, using a "clean shutdown" marker. This one
 *      always fires, and it runs before restored tabs can re-use their cookies.
 *
 * The guarantee we can honestly make is therefore "your sessions are gone by the time
 * the browser is usable again", not "at the instant you closed it". The options page
 * says exactly that.
 */

import { ensureInitialized, getSettings, getState, migrateSettings, setSiteOverride, updateSettings, updateState } from '../platform/settings.js';
import { discoverSessions, explainSignedIn, likelyLoggedIn } from '../platform/sessions.js';
import { isRunInProgress, runLocalWipe, runLogout } from '../engine/run.js';
import { resolveTier } from '../core/plan.js';
import { registrableDomain, hostnameFromUrl } from '../core/domain.js';
import { getActiveRecipes, getStoredBundle, refreshBundle, resetToBuiltin } from '../platform/recipe-store.js';
import { clearTrail, readTrail } from '../platform/breadcrumb.js';
import { clearLog, logEvent, readLog } from '../platform/eventlog.js';
import { buildRecoveryPlan, recoveryProgress } from '../core/compromise.js';
import { clearRecoveryState, getRecoveryState, markRecoveryStep, updateRecoveryState } from '../platform/recovery.js';
import { dropFrequencyPermission, getFrequentDomains, hasFrequencyPermission } from '../platform/frequency.js';
import { clearCoverage, readCoverage } from '../platform/coverage.js';
import { summariseCoverage } from '../core/coverage.js';
import { confirmedAccountDomains, partitionSites } from '../core/relevance.js';
import { knownChangePasswordSupport, probeChangePassword } from '../platform/change-password.js';
import { baselineOnVisit, recordFirstSight } from '../platform/first-sight.js';
import { observedLogins, recordLoginEvent } from '../platform/login-events.js';
import { signInCompletedFor } from '../core/oauth-return.js';
import { getVerdicts, setVerdict } from '../platform/site-verdict.js';
import { judgeSignIn } from '../core/anon-baseline.js';

const RECIPE_ALARM = 'sentinel-recipe-refresh';

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureInitialized();
  await migrateSettings();
  await applyIdleInterval();
  await scheduleRecipeUpdates();
  await updateState({ shutdownClean: false });

  // Fresh install only. Automatic triggers stay inert until this page is acknowledged.
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/welcome.html') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  // First thing after a restart. Its position in the log shows whether the browser died
  // during a run or after one finished.
  await logEvent('browser:startup');
  await migrateSettings();
  const state = await getState();
  const settings = await getSettings();

  // An unclean marker means the previous browser session ended without us finishing.
  if (!state.shutdownClean && settings.onBrowserClose.enabled) {
    const report = await runLocalWipe(
      'browserClose',
      state.pendingWipeDomains.length ? state.pendingWipeDomains : null
    );
    await refreshRestoredTabs(report);
  }

  await updateState({ shutdownClean: false, pendingWipeDomains: [] });
  await applyIdleInterval();
  await scheduleRecipeUpdates();
});

/**
 * Reload any restored tab belonging to a site we just cleared.
 *
 * Session restore races startup: a tab can finish loading with the old cookies before
 * the wipe lands, leaving a page that looks signed in over a session that is gone. That
 * is worse than being signed out, because the user trusts what they see. Reloading is
 * the least destructive way to make the tab tell the truth - it does not close the tab
 * or lose its place in history.
 *
 * @param {import('../engine/report.js').RunReport} report
 */
async function refreshRestoredTabs(report) {
  const cleared = new Set(report.sites.filter((s) => s.outcome !== 'failed').map((s) => s.domain));
  if (cleared.size === 0) return;

  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      const host = hostnameFromUrl(tab.url);
      if (!host) continue;
      if (cleared.has(registrableDomain(host))) {
        await chrome.tabs.reload(tab.id, { bypassCache: false }).catch(() => {});
      }
    }
  } catch {
    // Best effort. A stale tab is a cosmetic problem; a failed startup is not.
  }
}

// Last window closed: try to finish now, and leave a marker in case we are killed
// mid-wipe so startup can pick up where this left off.
chrome.windows.onRemoved.addListener(async (windowId) => {
  await logEvent('window:removed', String(windowId));
  const windows = await chrome.windows.getAll({});
  if (windows.length > 0) return;

  // A run closing its own hidden work window can momentarily leave zero windows. That
  // is not the browser shutting down, and starting a second wipe on top of a live run
  // would have the two fighting over the same tabs.
  if (await isRunInProgress()) return;

  const settings = await getSettings();
  if (!settings.onBrowserClose.enabled) {
    await updateState({ shutdownClean: true });
    return;
  }

  const domains = likelyLoggedIn(await discoverSessions()).map((s) => s.domain);
  await updateState({ pendingWipeDomains: domains });
  await runLocalWipe('browserClose', domains);
  await updateState({ shutdownClean: true, pendingWipeDomains: [] });
});

// Unreliable in MV3, but when it does fire it is the clearest signal that the browser is
// going away - and its absence is informative too.
chrome.runtime.onSuspend?.addListener(() => { void logEvent('worker:suspend'); });

chrome.idle.onStateChanged.addListener(async (newState) => {
  await logEvent('idle:state', newState);
  const settings = await getSettings();
  if (!settings.enabled) return;

  if (newState === 'locked' && settings.onLock.enabled) {
    // Screen lock is an explicit "I am walking away", so it is worth the background
    // tabs needed to reach the server-side logout.
    await runLogout('lock');
  } else if (newState === 'idle' && settings.onIdle.enabled) {
    await runLogout('idle');
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // The keep-alive alarm needs no handler; firing at all is its whole purpose.
  if (alarm.name === RECIPE_ALARM) await checkForRecipeUpdates();
});

/**
 * Weekly recipe refresh. Scheduled only while the feature is switched on, so a user who
 * leaves it off never makes a single request.
 */
async function scheduleRecipeUpdates() {
  const settings = await getSettings();
  if (settings.recipeUpdates.enabled) {
    await chrome.alarms.create(RECIPE_ALARM, { periodInMinutes: 7 * 24 * 60 });
  } else {
    await chrome.alarms.clear(RECIPE_ALARM);
  }
}

/**
 * Fetch and install a new recipe bundle, recording the outcome either way.
 *
 * Failure is deliberately non-fatal and non-destructive: the recipes that shipped with
 * the extension stay in force, so a hostile or broken bundle host can at worst freeze
 * coverage, never remove or redirect it.
 *
 * @returns {Promise<import('../platform/recipe-store.js').RefreshResult>}
 */
async function checkForRecipeUpdates() {
  const settings = await getSettings();
  const result = await refreshBundle(settings.recipeUpdates.url);

  await updateSettings({
    recipeUpdates: {
      ...settings.recipeUpdates,
      lastCheck: Date.now(),
      lastVersion: result.version ?? settings.recipeUpdates.lastVersion,
      lastError: result.error ?? ''
    }
  });

  if (result.error) console.warn(`[Session Sentinel] recipe update failed: ${result.error}`);
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true; // Response is async.
});

/**
 * @param {any} message
 * @returns {Promise<any>}
 */
async function handleMessage(message) {
  switch (message?.type) {
    case 'getOverview':
      return getOverview();

    case 'runNow':
      return runLogout('manual');

    case 'runSite':
      return runLogout('manualSite', [message.domain]);

    case 'clearSite':
      return runLocalWipe('manualSite', [message.domain]);

    case 'getSettings':
      return getSettings();

    case 'refreshRecipes':
      return checkForRecipeUpdates();

    case 'resetRecipes':
      await resetToBuiltin();
      return { updated: true };

    case 'dismissCrashReport':
      await clearTrail();
      return { ok: true };

    case 'getRecovery': {
      const settings = await getSettings();
      const state = await getRecoveryState();
      const minTier = message.minTier ?? state.minTier;
      const sessions = likelyLoggedIn(await discoverSessions());
      const signals = await relevanceSignals(settings, sessions);
      // Recovery calls these rows accounts and may send the user to password/security
      // pages. Auth-looking cookies, open tabs and topSites are not enough for that claim.
      // They remain review questions in the popup until first-sight evidence or the user's
      // answer confirms them.
      // Confirmed accounts, plus the candidates nothing has settled. The popup is strict
      // because a false positive there is a false claim; recovery is inclusive because the
      // costs are reversed. A wrong row here is a password page the user glances at and
      // skips; a missing row is a compromised account that never comes up during a breach.
      // Being strict in both places left this list empty on a fresh profile, telling
      // someone who may have just been hacked to "browse a little and come back".
      const confirmed = confirmedAccountDomains(sessions, signals);
      const unverified = new Set(
        [...(signals.unconfirmed ?? [])].filter((domain) => !confirmed.includes(domain))
      );
      const frequent = signals.frequent ?? new Set();
      const groups = buildRecoveryPlan(
        [...confirmed, ...unverified],
        settings,
        minTier,
        frequent,
        unverified
      );
      // Fill in from what has already been discovered, so a second visit renders complete
      // instead of blank-then-populated. Anything still missing is probed on request.
      applyPasswordPages(groups, await knownChangePasswordSupport());
      return { groups, state: { ...state, minTier }, progress: recoveryProgress(groups, state.done) };
    }

    case 'findPasswordPages':
      return findPasswordPages(message.domains ?? []);

    case 'markRecoveryStep':
      return markRecoveryStep(message.domain, Boolean(message.done));

    case 'setRecoveryScope':
      return updateRecoveryState({ minTier: message.minTier });

    case 'resetRecovery':
      await clearRecoveryState();
      return { ok: true };

    case 'frequencyStatus':
      return { granted: await hasFrequencyPermission() };

    case 'dropFrequency':
      await dropFrequencyPermission();
      return updateSettings({ useVisitFrequency: false });

    case 'openRecovery':
      return chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/recovery.html') });

    case 'getCoverage': {
      const entries = await readCoverage();
      return { entries, summary: summariseCoverage(entries) };
    }

    case 'clearCoverage':
      await clearCoverage();
      return { ok: true };

    case 'explainSignedIn':
      return explainSignedIn();

    case 'setSiteVerdict':
      await setVerdict(message.domain, message.verdict ?? null);
      return { ok: true };

    case 'getEventLog':
      return readLog();

    case 'clearEventLog':
      await clearLog();
      return { ok: true };

    case 'openWelcome':
      return chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/welcome.html') });

    case 'updateSettings': {
      const settings = await updateSettings(message.patch ?? {});
      await applyIdleInterval();
      await scheduleRecipeUpdates();
      return settings;
    }

    case 'setSiteOverride':
      return setSiteOverride(message.domain, message.override ?? null);

    default:
      throw new Error(`unknown message: ${message?.type}`);
  }
}

/**
 * Everything the popup needs, in one round trip.
 * @returns {Promise<{ settings: import('../core/policy.js').Settings, currentDomain: string | null, sites: Array<{ domain: string, tier: string, tierReason: string, mode: string, cookieCount: number }>, lastReport: import('../engine/report.js').RunReport | null }>}
 */
async function getOverview() {
  const settings = await getSettings();
  const state = await getState();
  const sessions = likelyLoggedIn(await discoverSessions());

  const discovered = sessions.map((session) => {
    const { tier, reason, mode } = resolveTier(session.domain, settings);
    return {
      domain: session.domain,
      tier,
      tierReason: reason,
      mode,
      cookieCount: session.cookieCount
    };
  });

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const host = activeTab?.url ? hostnameFromUrl(activeTab.url) : null;

  // A profile carries hundreds of cookied domains and a dozen the user would recognise.
  // Split them so the recognisable ones are what gets seen; the run is unaffected, and
  // the popup still states the true total next to the button that acts on it.
  const signals = await relevanceSignals(settings, sessions);
  const { used, configured, questions, other, narrowed } = partitionSites(discovered, signals);
  const sites = [...used, ...configured, ...questions, ...other];

  const bundle = await getStoredBundle();
  const recipes = await getActiveRecipes();

  return {
    settings,
    currentDomain: host ? registrableDomain(host) : null,
    sites,
    // The same rows, pre-split for display. `sites` stays whole so nothing downstream has
    // to know about the split to be correct.
    relevance: {
      used: used.map((s) => s.domain),
      confirmed: [...(signals.signedIn ?? [])],
      configured: configured.map((s) => s.domain),
      questions: questions.map((s) => s.domain),
      otherCount: other.length,
      narrowed,
      canRankByFrequency: settings.useVisitFrequency,
      // Kept as a count in addition to the domain list so future UIs can summarize the
      // review queue without treating it as part of the signed-in count.
      questionCount: questions.length
    },
    lastReport: state.lastReport,
    // A breadcrumb still present means a previous run never reached its end - the browser
    // died mid-flight. It names the exact call that was running.
    crashTrail: await readTrail(),
    recipeStatus: {
      total: recipes.length,
      source: bundle ? 'bundle' : 'built-in',
      bundleVersion: bundle?.version ?? null,
      fetchedAt: bundle?.fetchedAt ?? null
    }
  };
}

/**
 * Attach discovered password pages to a recovery plan.
 *
 * The curated table wins where it has an entry — a hand-checked URL that lands on the
 * right page beats a redirect we have only proved is not a 404. This fills the gaps, which
 * is most of the list: the table covers two dozen domains and a real profile has hundreds.
 *
 * @param {any[]} groups
 * @param {Record<string, import('../core/change-password.js').ProbeResult>} support
 */
function applyPasswordPages(groups, support) {
  for (const group of groups) {
    for (const step of group.steps) {
      if (step.passwordUrl) {
        step.passwordUrlSource = 'known';
        continue;
      }
      const found = support[step.domain];
      if (found?.supported && found.url) {
        step.passwordUrl = found.url;
        step.passwordUrlSource = 'discovered';
      }
    }
  }
}

/**
 * Probe for password pages, a few at a time.
 *
 * Changing the password is the only revocation primitive that exists on most stacks — no
 * protocol lets an extension end a session it did not create — so finding that page is
 * the single most useful thing this can do for someone who has been compromised.
 *
 * Concurrency is capped because the recovery plan asks about every account at once, and
 * a burst of requests at a dozen sites is both slow and rude. Results are cached by the
 * platform layer, so this is a first-visit cost only.
 *
 * @param {string[]} domains
 * @returns {Promise<Record<string, string>>}
 */
async function findPasswordPages(domains) {
  /** @type {Record<string, string>} */
  const found = {};
  const queue = [...new Set(domains)].slice(0, 40);
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const result = await probeChangePassword(next);
      if (result.supported && result.url) found[next] = result.url;
    }
  });

  await Promise.all(workers);
  return found;
}

/**
 * Evidence that the user actually uses a site, assembled from what we already hold.
 *
 * Deliberately no chrome.history: it would hand us every page ever opened, with
 * timestamps, to answer a question about domains. Every signal here is either free
 * (tabs we can already read) or already opt-in (top sites).
 *
 * @param {any} settings
 * @param {import('../platform/sessions.js').SiteSession[]} sessions
 * @returns {Promise<import('../core/relevance.js').RelevanceSignals>}
 */
async function relevanceSignals(settings, sessions) {
  /** @type {Set<string>} */
  const open = new Set();
  try {
    for (const tab of await chrome.tabs.query({})) {
      const host = tab.url ? hostnameFromUrl(tab.url) : null;
      if (host) open.add(registrableDomain(host));
    }
  } catch {
    // Worst case the list is ordered without this signal.
  }

  const frequent = settings.useVisitFrequency ? await getFrequentDomains() : new Set();
  // Live evidence only, deliberately.
  //
  // An earlier version kept a permanent record of every domain ever judged signed in, so a
  // site would survive the logout that removed the cookies proving it. That made a
  // heuristic mistake immortal: sites written in under a rule later found wrong stayed
  // listed, because nothing re-checked them. A coverage record cannot replace the old
  // cache: broad cleanup also acts on false positives, so action is not account evidence.
  //
  // The candidate test in sessions.js is not the answer either. bloomberg.com passes it
  // while handing `_session_id_backup` to strangers, so each candidate is checked against
  // what the site gives someone with no account.
  const candidates = sessions.filter((session) => session.signedIn);
  const { sight, added } = await recordFirstSight(candidates);
  const verdicts = await getVerdicts();
  const seenSignIn = await observedLogins();

  /** @type {Set<string>} */
  const signedIn = new Set();
  /** @type {Set<string>} */
  const unconfirmed = new Set();

  for (const site of candidates) {
    // The user's own answer settles it and is never re-litigated. Four rules in a row got
    // this wrong from cookies alone; "I have never made an eBay account" is not a
    // heuristic anyone can improve on.
    const stated = verdicts[site.domain];
    if (stated === 'notMine') continue;
    if (stated === 'mine') {
      signedIn.add(site.domain);
      continue;
    }

    // Null, not [], for a domain first recorded on THIS pass: its baseline was written
    // microseconds ago from the very cookies being judged, so it can only judge itself.
    const everSeen = added.has(site.domain) ? null : sight[site.domain] ?? null;

    // First sight can promote but never dismiss - it may well contain the user's own auth
    // cookie, if they were signed in before installing. Anything it cannot promote is a
    // question, not a no.
    // A sign-in watched happening counts, but only while the site still holds cookies to
    // match - which the candidate filter above already guarantees. That is the difference
    // from the cache this project removed: the record can promote a site, never keep one
    // listed after the evidence for it is gone.
    if (seenSignIn.has(site.domain) || judgeSignIn(site.authNames, everSeen) === 'signedIn') {
      signedIn.add(site.domain);
    } else unconfirmed.add(site.domain);
  }

  return { signedIn, unconfirmed, open, frequent };
}

/**
 * The last top-level URL seen in each tab, so a return trip from an identity provider is
 * recognisable. In memory only: MV3 kills the worker after ~30s idle, and losing this
 * costs at most one undetected sign-in, which the user can still answer by hand.
 * @type {Map<number, string>}
 */
const lastUrlByTab = new Map();

chrome.tabs.onRemoved.addListener((tabId) => lastUrlByTab.delete(tabId));

/**
 * Keep the frequency setting in step with the permission that backs it.
 *
 * The popup asks for `topSites` during a click, and Chrome may dismiss the popup to show
 * its prompt — killing the handler before it can save the setting, leaving the permission
 * granted and the feature off with no way to tell. Setting it here means the two cannot
 * disagree, whichever way the popup is torn down.
 */
chrome.permissions.onAdded.addListener(async (permissions) => {
  if (permissions.permissions?.includes('topSites')) {
    await updateSettings({ useVisitFrequency: true });
  }
});

chrome.permissions.onRemoved.addListener(async (permissions) => {
  // Revoked from chrome://extensions rather than through our own control. A setting that
  // claims to order by frequency with no permission behind it is just a lie in a checkbox.
  if (permissions.permissions?.includes('topSites')) {
    await updateSettings({ useVisitFrequency: false });
  }
});


chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) return;

  const previous = lastUrlByTab.get(tabId) ?? null;
  lastUrlByTab.set(tabId, tab.url);

  // A federated sign-in leaves the site's own cookie name unchanged until the callback, so
  // for sites that reuse one name through login there is nothing in the jar to notice. The
  // navigation is the evidence: an authorization code coming back, or a return trip from a
  // provider's authorize endpoint.
  const signedInTo = signInCompletedFor(tab.url, previous);
  if (signedInTo) void recordLoginEvent(signedInTo);

  // A page load is also when a site can still be seen as it looks to someone not yet
  // signed in. Baselining here lets an ordinary sign-in confirm itself with no question.
  const host = hostnameFromUrl(tab.url);
  if (host) void baselineOnVisit(registrableDomain(host));
});

/** Keep Chrome's idle threshold in step with the configured timeout. */
async function applyIdleInterval() {
  const settings = await getSettings();
  const seconds = Math.max(15, Math.round(settings.onIdle.minutes * 60));
  chrome.idle.setDetectionInterval(seconds);
}
