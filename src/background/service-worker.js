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
import { discoverSessions, likelyLoggedIn } from '../platform/sessions.js';
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
      const known = likelyLoggedIn(await discoverSessions()).map((s) => s.domain);
      const frequent = settings.useVisitFrequency ? await getFrequentDomains() : new Set();
      const groups = buildRecoveryPlan(known, settings, minTier, frequent);
      return { groups, state: { ...state, minTier }, progress: recoveryProgress(groups, state.done) };
    }

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

  const sites = sessions
    .map((session) => {
      const { tier, reason, mode } = resolveTier(session.domain, settings);
      return {
        domain: session.domain,
        tier,
        tierReason: reason,
        mode,
        cookieCount: session.cookieCount
      };
    })
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.tier] - order[b.tier] || a.domain.localeCompare(b.domain);
    });

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const host = activeTab?.url ? hostnameFromUrl(activeTab.url) : null;

  const bundle = await getStoredBundle();
  const recipes = await getActiveRecipes();

  return {
    settings,
    currentDomain: host ? registrableDomain(host) : null,
    sites,
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

/** Keep Chrome's idle threshold in step with the configured timeout. */
async function applyIdleInterval() {
  const settings = await getSettings();
  const seconds = Math.max(15, Math.round(settings.onIdle.minutes * 60));
  chrome.idle.setDetectionInterval(seconds);
}
