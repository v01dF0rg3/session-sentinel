/**
 * The orchestrator. One place that decides what happens, in what order, to each site.
 *
 * Ordering is load-bearing and easy to get wrong:
 *   1. website sign-out attempt - needs the cookies, so it must run FIRST
 *   2. destroy local data
 *   3. optionally reload the user's tabs on that site
 *   4. verify
 * Wiping first is the classic bug: it deletes the credentials the logout request needed.
 *
 * What is NOT here any more is as important as what is. Three separate versions of this
 * file ended the user's browser session mid-logout: first by closing their tabs, then by
 * removing a hidden window, then - still under investigation - by manipulating tabs at
 * all. Each fix removed a capability rather than guarding it. The extension now does
 * nothing to windows, and nothing to tabs unless explicitly asked.
 */

import { buildPlan } from '../core/plan.js';
import { expandForIdentity, keptSiblings } from '../core/identity.js';
import { revokeGuidanceFor } from '../core/session-pages.js';
import { discoverSessions, likelyLoggedIn, verifyCleared, wipeSite } from '../platform/sessions.js';
import { findTabsForDomain, findUsableWindow, reloadTabs } from '../platform/tabs.js';
import { attemptServerLogout } from './logout.js';
import { summarize } from './report.js';
import { getSettings, updateState } from '../platform/settings.js';
import { clearTrail, mark as breadcrumb } from '../platform/breadcrumb.js';
import { logEvent } from '../platform/eventlog.js';
import { recordOutcome } from '../platform/coverage.js';

/**
 * Record a step both as a breadcrumb (cleared on success, drives the popup banner) and in
 * the permanent event log (never cleared, so a crash AFTER a successful run is still
 * visible afterwards). The single breadcrumb alone erased its own evidence.
 *
 * @param {string} step
 * @param {string} description
 * @param {string} [domain]
 */
async function mark(step, description, domain = '') {
  await breadcrumb(step, description, domain);
  await logEvent(`step:${step}`, domain);
}

const RUN_LOCK = 'runInProgress';
const KEEPALIVE_ALARM = 'sentinel-keepalive';

/**
 * Is a run currently underway?
 *
 * Also consulted by the browser-close handler so a close event arriving during a run does
 * not start a second, competing cleanup.
 *
 * @returns {Promise<boolean>}
 */
export async function isRunInProgress() {
  const lock = await chrome.storage.session.get(RUN_LOCK);
  return Boolean(lock[RUN_LOCK]) && Date.now() - lock[RUN_LOCK] < 5 * 60 * 1000;
}

/** @typedef {import('./report.js').RunReport} RunReport */
/** @typedef {import('./report.js').SiteResult} SiteResult */
/** @typedef {import('../core/plan.js').Trigger} Trigger */

/**
 * @param {Trigger} trigger
 * @param {string[] | null} domains Null discovers every site with cookies.
 * @returns {Promise<RunReport>}
 */
export async function runLogout(trigger, domains = null) {
  const startedAt = Date.now();
  await logEvent('run:start', trigger);

  // A second run stacking on the first would fight over tabs and produce nonsense
  // results, so concurrent runs are refused rather than queued.
  if (await isRunInProgress()) {
    return { trigger, startedAt, finishedAt: Date.now(), sites: [], skipped: [{ domain: '*', why: 'a run is already in progress' }] };
  }
  await chrome.storage.session.set({ [RUN_LOCK]: Date.now() });

  // A slow page load can leave a gap in chrome.* activity. The periodic alarm gives Chrome
  // another opportunity to wake the worker; it is not treated as a completion guarantee.
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });

  try {
    const settings = await getSettings();
    const known = likelyLoggedIn(await discoverSessions()).map((s) => s.domain);
    const requested = domains ?? known;

    // A site whose sign-in lives on another domain cannot be processed in isolation - the
    // surviving session re-issues its cookies on the next visit. Clearing youtube.com
    // without google.com is the case that made this obvious.
    // The button-driven bulk run passes the confirmed set explicitly. Restrict identity
    // expansion to that same set or an unresolved sibling would quietly widen it again.
    // Per-site and scheduled actions retain the existing broad sibling protection.
    const identityScope = trigger === 'manual' && domains !== null ? requested : known;
    const { domains: candidates, added } = expandForIdentity(requested, identityScope);
    if (added.length) {
      await logEvent('identity:expanded', added.map((a) => `${a.domain}<-${a.because}`).join(', '));
    }

    const plan = buildPlan(candidates, trigger, settings);

    /** @type {SiteResult[]} */
    const sites = [];
    const needsWindow = plan.targets.some((t) => t.serverLogout);

    // Website sign-out borrows a window the user already has open. The extension never
    // creates or closes a window: Chrome quits when its window count reaches zero, and no
    // amount of guarding around that is worth the risk of ending someone's session.
    /** @type {number | null} */
    let windowId = null;
    let windowError = '';
    if (needsWindow) {
      windowId = await findUsableWindow();
      if (windowId === null) {
        windowError = 'no browser window is open to host the temporary work tab';
      }
    }

    for (const target of plan.targets) {
      /** @type {SiteResult} */
      const result = {
        domain: target.domain,
        tier: target.tier,
        outcome: 'failed',
        detail: '',
        tabsRefreshed: 0,
        verified: false,
        revokeGuidance: null
      };

      // 1. Server-side, while the session still exists.
      /** @type {import('./logout.js').LogoutAttempt} */
      let attempt = { result: 'none', detail: 'not attempted' };
      if (target.serverLogout && windowId !== null) {
        await mark('serverLogout', 'opening the site own sign-out page in a background tab', target.domain);
        attempt = await attemptServerLogout(target.domain, windowId, settings.serverLogout.timeoutMs);
      } else if (target.serverLogout && windowError) {
        attempt = { result: 'none', detail: `could not open a temporary work tab (${windowError})` };
      }

      // 2. Note the user's tabs on this site. Finding them is read-only and always safe;
      //    only the configured reload touches them, because earlier tab handling kept
      //    killing the browser. Counting them either way lets the report explain why a
      //    page still looks signed in.
      const affected = await findTabsForDomain(target.domain);
      // 3. Destroy what is left locally. This always runs, whatever happened above.
      await mark('wipe', `clearing ${target.dataTypes.join(', ')} for this site`, target.domain);
      const wipe = await wipeSite(target.domain, target.dataTypes);

      // 4. Optionally reload those tabs so they reflect the local cleanup.
      if (affected.length && settings.tabHandling === 'reload') {
        await mark('reloadTabs', 'reloading your open tabs on this site', target.domain);
        result.tabsRefreshed = await reloadTabs(affected);
      }

      // 5. Verify, then report the weakest claim the evidence supports.
      await mark('verify', 'reading the cookie jar back to confirm the wipe', target.domain);
      result.verified = await verifyCleared(target.domain);

      // Clearing cookies locally does not ask the site to invalidate a server token.
      // Say where the user can review sessions and security settings rather than implying
      // that local verification proves anything about the server.
      if (attempt.result !== 'revoked') {
        result.revokeGuidance = revokeGuidanceFor(target.domain, attempt.result === 'attempted');
      }

      // A partial wipe is not a clean one. Say which types survived rather than
      // letting "cleared" imply everything went.
      const partial = wipe.failed.length ? ` (${wipe.failed.join(', ')} could not be cleared)` : '';

      // A sibling the user asked to keep will sign this site straight back in. Saying so
      // is the difference between a useful result and a lie.
      const kept = keptSiblings(target.domain, (d) => settings.sites[d]?.mode === 'ignored');
      const keptNote = kept.length
        ? ` — but ${kept.join(', ')} is set to never clear and shares this sign-in, so you may be signed straight back in`
        : '';
      const shared = added.find((a) => a.domain === target.domain);
      const sharedNote = shared ? ` (shares a sign-in with ${shared.because})` : '';

      // An already-open page may keep old state in memory and look signed in until reload.
      // If no site sign-out was reached, make the lack of server-side verification explicit.
      const orphanNote =
        attempt.result === 'none' && target.serverLogout
          ? ' — cleared here, but no server-side invalidation was verified; the site may still list the session as active'
          : '';
      const openTabsNote =
        affected.length && settings.tabHandling !== 'reload'
          ? ` — ${affected.length} tab${affected.length === 1 ? '' : 's'} still open on this site; reload to see the change`
          : '';

      if (!wipe.ok) {
        result.outcome = 'failed';
        result.detail = wipe.error ?? 'could not clear local data';
      } else if (attempt.result === 'revoked') {
        result.outcome = 'revoked';
        result.detail = attempt.detail + sharedNote + partial + keptNote + openTabsNote;
      } else if (attempt.result === 'attempted') {
        result.outcome = 'logoutAttempted';
        result.detail = attempt.detail + sharedNote + partial + keptNote + openTabsNote;
      } else {
        result.outcome = 'cleared';
        result.detail =
          (target.serverLogout ? attempt.detail : `local data cleared (${target.depth})`) +
          sharedNote + orphanNote + partial + keptNote + openTabsNote;
      }

      // Count what was reached. Four recipes cover four domains; whether the generic
      // fallback reaches the rest has never been measured, and without a number the choice
      // of which site to write a recipe for is guesswork.
      await recordOutcome(target.domain, result.outcome, attempt.method ?? 'none', target.serverLogout);

      sites.push(result);
    }

    /** @type {RunReport} */
    const report = { trigger, startedAt, finishedAt: Date.now(), sites, skipped: plan.skipped };
    await updateState({ lastRunAt: report.finishedAt, lastReport: report });

    await mark('notify', 'showing the result notification');
    await maybeNotify(report, settings.notifications);

    // Got to the end without the browser dying, so the breadcrumb has nothing to say.
    // The event log keeps its entries regardless: the browser has died AFTER a run
    // completed, and only a log that survives success can show that.
    await clearTrail();
    await logEvent('run:complete', `${sites.length} site(s)`);
    return report;
  } finally {
    await chrome.alarms.clear(KEEPALIVE_ALARM);
    await chrome.storage.session.remove(RUN_LOCK);
  }
}

/**
 * Local-only wipe with no tabs and no network. This is what runs at browser close and
 * on the next startup, where opening windows is either impossible or unwelcome.
 *
 * @param {Trigger} trigger
 * @param {string[] | null} domains
 * @returns {Promise<RunReport>}
 */
export async function runLocalWipe(trigger, domains = null) {
  const startedAt = Date.now();
  const settings = await getSettings();
  const candidates = domains ?? likelyLoggedIn(await discoverSessions()).map((s) => s.domain);
  const plan = buildPlan(candidates, trigger, settings);

  /** @type {SiteResult[]} */
  const sites = [];
  for (const target of plan.targets) {
    await mark('localWipe', `clearing ${target.dataTypes.join(', ')} for this site`, target.domain);
    const wipe = await wipeSite(target.domain, target.dataTypes);
    const partial = wipe.failed.length ? ` (${wipe.failed.join(', ')} could not be cleared)` : '';
    sites.push({
      domain: target.domain,
      tier: target.tier,
      outcome: wipe.ok ? 'cleared' : 'failed',
      detail: wipe.ok ? `local data cleared (${target.depth})${partial}` : wipe.error ?? 'failed',
      tabsRefreshed: 0,
      verified: wipe.ok ? await verifyCleared(target.domain) : false
    });
  }

  /** @type {RunReport} */
  const report = { trigger, startedAt, finishedAt: Date.now(), sites, skipped: plan.skipped };
  await updateState({ lastRunAt: report.finishedAt, lastReport: report });
  await clearTrail();
  return report;
}

/**
 * @param {RunReport} report
 * @param {boolean} enabled
 */
async function maybeNotify(report, enabled) {
  if (!enabled || report.sites.length === 0) return;
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Session Sentinel',
      message: summarize(report)
    });
  } catch {
    // Notifications are a nicety; never let one failing break a run.
  }
}
