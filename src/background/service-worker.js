/**
 * Event wiring. All logic lives in core/ and engine/; this file only decides *when*.
 *
 * The browser-close story is the subtle one. MV3 gives no dependable shutdown hook -
 * chrome.runtime.onSuspend is unreliable, and a crash, a kill, or an OS shutdown skips
 * it entirely. So closing is handled twice:
 *
 *   1. Best effort on windows.onRemoved when the last window goes. Often completes.
 *   2. Retry on runtime.onStartup, using a "clean shutdown" marker, then reload matching
 *      restored tabs after local cleanup.
 *
 * Neither path proves remote token invalidation or guarantees work at the instant Chrome
 * closes. The options page describes this as best-effort local cleanup plus a startup retry.
 */

import { ensureInitialized, getSettings, getState, migrateSettings, setSiteOverride, updateSettings, updateState } from '../platform/settings.js';
import { discoverSessions, explainSignedIn, likelyLoggedIn } from '../platform/sessions.js';
import { isRunInProgress, runLocalWipe, runLogout } from '../engine/run.js';
import { resolveTier } from '../core/plan.js';
import { domainToOrigin, registrableDomain, hostnameFromUrl } from '../core/domain.js';
import { getActiveRecipes, getStoredBundle, refreshBundle, resetToBuiltin } from '../platform/recipe-store.js';
import { clearTrail, readTrail } from '../platform/breadcrumb.js';
import { clearLog, logEvent, readLog } from '../platform/eventlog.js';
import { buildRecoveryPlan, recoveryProgress } from '../core/compromise.js';
import { createRecoveryHandoff } from '../core/recovery-handoff.js';
import { clearRecoveryState, getRecoveryState, markRecoveryStep, updateRecoveryState } from '../platform/recovery.js';
import { dropFrequencyPermission, getFrequentDomains, hasFrequencyPermission } from '../platform/frequency.js';
import { clearCoverage, readCoverage } from '../platform/coverage.js';
import { summariseCoverage } from '../core/coverage.js';
import { confirmedAccountDomains, partitionSites } from '../core/relevance.js';
import { knownChangePasswordSupport, probeChangePassword } from '../platform/change-password.js';
import { baselineOnVisit, recordFirstSight } from '../platform/first-sight.js';
import { observedLogins, recordLoginEvent } from '../platform/login-events.js';
import { signInCompletedFor } from '../core/oauth-return.js';
import { readPageEvidence } from '../core/page-signals.js';
import { collectPageEvidence } from '../engine/page-probe.js';
import { activateLoginControl } from '../engine/login-entry.js';
import { getPageVerdicts, recordPageVerdict } from '../platform/page-verdict.js';
import {
  clearLoginIntent,
  getLoginIntent,
  loginIntentTabIds,
  loginIntentTabsForDomain,
  markLoginEntryAttempted,
  rememberLoginIntent
} from '../platform/login-intent.js';
import { sessionEvidence } from '../core/risk.js';
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
 * the wipe lands, leaving a page that looks signed in after its local session material was
 * removed. Reloading is the least destructive way to refresh that view - it does not close
 * the tab or lose its place in history, and it makes no claim about remote token revocation.
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
    // tabs needed to attempt the site's own sign-out.
    await runLogout('lock');
  } else if (newState === 'idle' && settings.onIdle.enabled) {
    await runLogout('idle');
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // The run alarm has no work of its own; it merely gives Chrome another reason to wake
  // the worker during a long run. It is a resilience aid, not a lifetime guarantee.
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
      return runConfirmedOnly();

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
      // They remain login candidates in the popup until first-sight or live page evidence
      // confirms them.
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
      // A portable plan must not silently inherit the screen's risk filter or include
      // candidates as confirmed accounts. Only allowlisted fields leave this boundary.
      const handoff = createRecoveryHandoff(buildRecoveryPlan(confirmed, settings, 'low'));
      return { groups, handoff, state: { ...state, minTier }, progress: recoveryProgress(groups, state.done) };
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

    case 'openLogin':
      return openCandidateLogin(message.domain);

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
 * Run the button-driven bulk logout over confirmed logins only.
 *
 * Scheduled wipes remain deliberately generous, and a user can still target any site
 * explicitly. The account button is narrower because it claims to act on accounts.
 */
async function runConfirmedOnly() {
  const settings = await getSettings();
  const sessions = likelyLoggedIn(await discoverSessions());
  const signals = await relevanceSignals(settings, sessions);
  const confirmed = confirmedAccountDomains(sessions, signals);
  return runLogout('manual', confirmed);
}

/**
 * Start an explicit login-or-confirm flow for one unanswered candidate.
 *
 * The first page is the site's own origin. If it already shows account UI, that confirms
 * the login. Otherwise the page's own Login control is activated; `/login` is used only
 * when the homepage exposes no such control.
 *
 * @param {string} requestedDomain
 */
async function openCandidateLogin(requestedDomain) {
  const domain = registrableDomain(String(requestedDomain ?? '').trim().toLowerCase());
  const sessions = likelyLoggedIn(await discoverSessions());
  if (!domain || !sessions.some((session) => session.domain === domain)) {
    throw new Error('this site is no longer an account candidate');
  }

  // Capture "before" before the user can submit a password in the new tab.
  await baselineOnVisit(domain);

  const tab = await chrome.tabs.create({ url: `${domainToOrigin(domain)}/`, active: true });
  if (!tab.id) throw new Error('Chrome did not return the login tab');

  await rememberLoginIntent(tab.id, domain);
  // Covers an instantly restored/cached page; the normal tab events cover ordinary loads.
  void advancePendingLogin(tab.id);
  return { ok: true, tabId: tab.id };
}

/**
 * Everything the popup needs, in one round trip.
 * @returns {Promise<{ settings: import('../core/policy.js').Settings, currentDomain: string | null, sites: Array<{ domain: string, tier: string, tierReason: string, mode: string, cookieCount: number }>, lastReport: import('../engine/report.js').RunReport | null }>}
 */
async function getOverview() {
  // A login completed entirely inside a single-page app may change neither the URL nor a
  // cookie. Reopening the popup is a natural, bounded final check of every Login action
  // still awaiting confirmation.
  await refreshPendingLogins();

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
  // Split them so confirmed accounts are what gets seen first. The account button uses
  // that same confirmed set; scheduled safety wipes retain the broader candidate scope.
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
 * A password page is one useful recovery destination when credentials may be exposed, but
 * providers differ on whether a password change closes existing sessions. Session/device
 * review remains a separate step and no revocation is inferred from finding this URL.
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
  const pageSaid = await getPageVerdicts();

  /** @type {Set<string>} */
  const signedIn = new Set();
  /** @type {Set<string>} */
  const unconfirmed = new Set();

  for (const site of candidates) {
    // Persistent user overrides settle it and are never re-litigated. "notMine" remains
    // the current dismissal; "mine" is a legacy value retained for existing installations.
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
    // cookie, if they were signed in before installing. Anything it cannot promote remains
    // a login candidate, not a no.
    // A sign-in watched happening counts, but only while the site still holds cookies to
    // match - which the candidate filter above already guarantees. That is the difference
    // from the cache this project removed: the record can promote a site, never keep one
    // listed after the evidence for it is gone.
    const said = pageSaid[site.domain];
    if (
      said === 'signedIn' ||
      seenSignIn.has(site.domain) ||
      judgeSignIn(site.authNames, everSeen) === 'signedIn'
    ) {
      signedIn.add(site.domain);
    } else if (said === 'anonymous') {
      // The site offered to sign them in and nowhere offered to sign them out. That is
      // direct negative page evidence, and it is what finally settles sites like
      // bloomberg.com without asking the user to classify a cookie.
      continue;
    } else unconfirmed.add(site.domain);
  }

  return { signedIn, unconfirmed, open, frequent };
}

/**
 * The last top-level URL seen in each tab, so a return trip from an identity provider is
 * recognisable. In memory only: MV3 kills the worker after ~30s idle, and losing this
 * costs at most one undetected sign-in outside the tab-specific Login flow, whose intent
 * is persisted separately in session storage.
 * @type {Map<number, string>}
 */
const lastUrlByTab = new Map();
const loginRetryTimers = new Map();
const loginUnknownChecks = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  lastUrlByTab.delete(tabId);
  const retry = loginRetryTimers.get(tabId);
  if (retry) clearTimeout(retry);
  loginRetryTimers.delete(tabId);
  loginUnknownChecks.delete(tabId);
  void clearLoginIntent(tabId);
});

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
  if (!host) return;

  const domain = registrableDomain(host);
  void baselineOnVisit(domain);

  // And the page itself may simply say. A site shows "Sign out" only to someone with a
  // session to end, which settles the one case nothing else can reach: an account that
  // predates the extension, visited without ever signing out and back in.
  void askPageIfSignedIn(tabId, domain);
  void advancePendingLogin(tabId);
});

// A single-page app changes its URL without reloading, and often builds the account menu
// only after the first route settles. This is the cheapest second chance available.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.url?.startsWith('https://')) return;
  const host = hostnameFromUrl(tab.url);
  if (host) {
    void askPageIfSignedIn(tabId, registrableDomain(host));
    void advancePendingLogin(tabId);
  }
});

// A modal or single-page login may not navigate at all. Cookie changes are the reliable
// wake-up in that case; the short delay gives the page time to redraw its account menu.
chrome.cookies.onChanged.addListener((changeInfo) => {
  const domain = registrableDomain(changeInfo.cookie?.domain ?? '');
  if (!domain) return;
  void wakePendingLogins(domain);
});

/** @param {string} domain */
async function wakePendingLogins(domain) {
  for (const tabId of await loginIntentTabsForDomain(domain)) {
    scheduleLoginRetry(tabId, 1500);
  }
}

async function refreshPendingLogins() {
  await Promise.all((await loginIntentTabIds()).map((tabId) => advancePendingLogin(tabId)));
}

/**
 * @param {number} tabId
 * @param {number} delayMs
 */
function scheduleLoginRetry(tabId, delayMs) {
  const existing = loginRetryTimers.get(tabId);
  if (existing) clearTimeout(existing);
  loginRetryTimers.set(
    tabId,
    setTimeout(() => {
      loginRetryTimers.delete(tabId);
      void advancePendingLogin(tabId);
    }, delayMs)
  );
}

/** Tabs currently being inspected, preventing a load and cookie event from double-clicking. */
const loginFlowInFlight = new Set();

/**
 * Continue a Login action once its tab reaches a useful page.
 *
 * Provider pages are left entirely to the user. On the target site we first look for
 * positive signed-in evidence. Only while it remains unresolved do we activate the site's
 * Login control or use the conventional `/login` fallback.
 *
 * @param {number} tabId
 */
async function advancePendingLogin(tabId) {
  if (loginFlowInFlight.has(tabId)) return;
  loginFlowInFlight.add(tabId);

  try {
    const intent = await getLoginIntent(tabId);
    if (!intent) return;

    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== 'complete' || !tab.url) return;
    const host = hostnameFromUrl(tab.url);
    if (!host || registrableDomain(host) !== intent.domain) return;

    let evidence = null;
    try {
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId },
        func: collectPageEvidence
      });
      evidence = frame?.result ?? null;
    } catch {
      // The conventional path below is still useful when a page refuses inspection.
    }

    const pageVerdict = evidence ? readPageEvidence(evidence) : 'unknown';
    if (pageVerdict === 'signedIn') {
      await recordPageVerdict(intent.domain, 'signedIn');
      await clearLoginIntent(tabId);
      loginUnknownChecks.delete(tabId);
      return;
    }

    // Once the login page or modal has been opened, later events only re-check. They must
    // never keep clicking Login while the person is entering credentials.
    if (intent.attemptedEntry) return;

    // "complete" often precedes a single-page app's header. Give a page that says nothing
    // one second look before deciding it needs the fallback. A page explicitly offering
    // Sign in does not need the delay.
    const unknownChecks = loginUnknownChecks.get(tabId) ?? 0;
    if (pageVerdict === 'unknown' && unknownChecks < 1) {
      loginUnknownChecks.set(tabId, unknownChecks + 1);
      scheduleLoginRetry(tabId, 1800);
      return;
    }

    await markLoginEntryAttempted(tabId);

    try {
      const [activated] = await chrome.scripting.executeScript({
        target: { tabId },
        func: activateLoginControl
      });
      if (activated?.result?.activated) return;
    } catch {
      // Fall through to the conventional path.
    }

    const path = new URL(tab.url).pathname;
    const alreadyAtLogin =
      (evidence?.passwordFields ?? 0) > 0 ||
      /\/(login|signin|sign-in|sign_in|log-in|log_in)(\/|$)/i.test(path);
    if (!alreadyAtLogin) {
      await chrome.tabs.update(tabId, { url: `${domainToOrigin(intent.domain)}/login` });
    }
  } catch {
    // Closing the tab or navigating somewhere Chrome protects simply leaves the candidate
    // unresolved. The intent expires on its own and no account is guessed.
  } finally {
    loginFlowInFlight.delete(tabId);
  }
}

/**
 * Ask the page whether the user is signed in, for sites nothing else has settled.
 *
 * This is the last gap. A site the user was already signed into before installing has no
 * transition to observe and no federated round trip to catch — but its pages are, right
 * now, showing "Sign out" to them. The site states the answer; it just has to be read.
 *
 * Bounded deliberately. It runs only for a domain that holds session-looking cookies AND
 * has not already been settled, at most once per service-worker lifetime, and never again
 * once an answer is recorded. A confirmed account is never inspected again.
 *
 * @param {number} tabId
 * @param {string} domain
 */
async function askPageIfSignedIn(tabId, domain, attempt = 0) {
  // Retried, because "complete" fires when the document is done, not when a single-page
  // app has drawn its account menu. One look at that moment finds nothing on plenty of
  // sites. Attempts stop as soon as the page says something definite, and stop entirely
  // after three - a site that has shown neither control by then is not going to.
  const tries = probedThisSession.get(domain) ?? 0;
  if (tries > attempt) return;
  probedThisSession.set(domain, attempt + 1);

  try {
    const settled = await getPageVerdicts();
    if (settled[domain]) return;

    const cookies = await chrome.cookies.getAll({ domain });
    const hasAuthCookies = cookies.some((cookie) => {
      const evidence = sessionEvidence(cookie);
      return evidence === 'strong' || evidence === 'moderate';
    });
    // No session-looking cookies means there is nothing this could confirm, and inspecting
    // the page would be looking at something that is none of our business.
    if (!hasAuthCookies) {
      probedThisSession.delete(domain);
      return;
    }

    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectPageEvidence
    });
    if (!frame?.result) return;

    const verdict = readPageEvidence(frame.result);
    if (verdict !== 'unknown') {
      await recordPageVerdict(domain, verdict);
      return;
    }

    // Nothing yet. Look again, further from the load, in case the page had not finished
    // building itself. The delays are long because the alternative - polling - would mean
    // watching a page continuously, which is far more than this needs.
    if (attempt < 2) {
      setTimeout(() => void askPageIfSignedIn(tabId, domain, attempt + 1), attempt === 0 ? 2500 : 6000);
    }
  } catch {
    // A page that refuses injection - the Chrome Web Store, a PDF viewer, a tab closed
    // mid-flight - simply remains an unconfirmed candidate.
    probedThisSession.delete(domain);
  }
}

/**
 * Attempts made per domain in this service-worker lifetime.
 * @type {Map<string, number>}
 */
const probedThisSession = new Map();



/** Keep Chrome's idle threshold in step with the configured timeout. */
async function applyIdleInterval() {
  const settings = await getSettings();
  const seconds = Math.max(15, Math.round(settings.onIdle.minutes * 60));
  chrome.idle.setDetectionInterval(seconds);
}
