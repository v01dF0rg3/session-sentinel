/**
 * Website sign-out attempts: the tiers that contact a site before local cleanup. Runs in
 * a temporary background tab inside an existing window, on the site's own origin.
 *
 *   Tier 3  curated recipe        - site-specific sign-out flow
 *   Tier 4  OIDC RP-initiated     - generic, covers a lot of Okta/Entra/Auth0 SaaS
 *   Tier 1  heuristic             - find and click whatever reads as a logout control
 *
 * Every path reports honestly. Reaching an endpoint or clicking a control proves only that
 * sign-out was attempted; it does not prove that the server rejected a copied token.
 * Only a separately verified revoke-everywhere recipe may return 'revoked'.
 */

import { heuristicRecipe, isValidRecipe } from '../core/recipes.js';
import { findActiveRecipe } from '../platform/recipe-store.js';
import { describeRefusal, isTrustedLogoutDestination } from '../core/trust.js';
import { pageStep } from './step-runner.js';
import { closeTab, navigateTab, openTab, sleep } from '../platform/tabs.js';

/**
 * @typedef {'recipe' | 'oidc' | 'path' | 'home' | 'none'} LogoutMethod
 */

/**
 * @typedef {object} LogoutAttempt
 * @property {'revoked' | 'attempted' | 'none'} result
 * @property {string} detail
 * @property {LogoutMethod} [method] Which tier actually did the work. Recorded rather than
 *   inferred from `detail`, so coverage can be counted instead of guessed at.
 */

/**
 * Execute a recipe's steps. Navigation steps are driven from here (the service worker)
 * because a navigation tears down whatever is executing in the page.
 *
 * @param {import('../core/recipes.js').Recipe} recipe
 * @param {number} windowId
 * @param {number} timeoutMs
 * @returns {Promise<LogoutAttempt>}
 */
export async function runRecipe(recipe, windowId, timeoutMs) {
  if (!isValidRecipe(recipe)) return { result: 'none', detail: 'malformed recipe' };

  const deadline = Date.now() + timeoutMs;
  /** @type {number | null} */
  let tabId = null;
  let lastDetail = '';

  // Selectors this run has actually seen on the page.
  //
  // `assertAbsent` is worthless without this. A selector that never matched anything is
  // trivially "absent", so an assert against a wrong selector passes and the recipe
  // reports success for a click that never happened. That is exactly how a recipe came to
  // claim it had revoked GitHub sessions while every one of them stayed live.
  /** @type {Set<string>} */
  const confirmedPresent = new Set();

  // Did the recipe actually do anything? A recipe whose only actions were optional and
  // all missed has changed nothing, whatever its final assert says.
  let clicked = false;
  let usedLogoutRoute = false;
  const attemptedResult = () => (clicked || usedLogoutRoute ? 'attempted' : 'none');

  try {
    for (const step of recipe.steps) {
      if (Date.now() > deadline) {
        return { result: attemptedResult(), detail: 'timed out before the sign-out flow completed' };
      }

      if (step.op === 'navigate') {
        const url = step.url ?? '';
        try {
          usedLogoutRoute ||= /(^|\/)(logout|signout|sign-out|sign_out|log-out|log_out)(\/|$)/i.test(
            new URL(url).pathname
          );
        } catch {
          // Validation handles malformed destinations. This flag only affects wording.
        }
        const remaining = Math.max(2000, deadline - Date.now());
        if (tabId === null) tabId = await openTab(windowId, url, remaining);
        else await navigateTab(tabId, url, remaining);
        lastDetail = 'navigated';
        continue;
      }

      if (tabId === null) return { result: 'none', detail: 'recipe did not open a page' };

      // Refuse to assert the absence of something never seen present. Failing here is
      // the point: it turns a meaningless pass into an honest "could not confirm".
      if (step.op === 'assertAbsent' && !confirmedPresent.has(step.selector ?? '')) {
        return {
          result: attemptedResult(),
          detail: `cannot confirm "${step.selector}" went away - it was never seen on the page`
        };
      }

      const [outcome] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageStep,
        args: [step]
      });
      const stepResult = /** @type {{ ok: boolean, detail: string }} */ (outcome?.result ?? {
        ok: false,
        detail: 'no result'
      });
      lastDetail = stepResult.detail;

      if (stepResult.ok) {
        if (step.op === 'waitFor' || step.op === 'assertPresent') confirmedPresent.add(step.selector ?? '');
        if (step.op === 'click' || step.op === 'clickText') clicked = true;
      }

      if (!stepResult.ok && !step.optional) {
        // A failed assert means the site did not end up in the state the recipe
        // promised, so the recipe cannot claim its capability.
        return {
          result: attemptedResult(),
          detail: `step "${step.op}" failed: ${stepResult.detail}`
        };
      }
    }

    // A recipe whose actions all missed did nothing, however cleanly its steps ran.
    // Navigate-only recipes are exempt: hitting a documented logout URL *is* the work.
    const hasClickSteps = recipe.steps.some((s) => s.op === 'click' || s.op === 'clickText');
    if (hasClickSteps && !clicked) {
      return {
        result: 'none',
        detail: 'recipe completed without activating any control on the page'
      };
    }

    // The strong result is reserved for a global recipe whose behavior was checked on a
    // second device. It says that verified recipe completed, not that this extension read
    // the provider's token database. An unverified global recipe remains only an attempt.
    if (recipe.capability === 'global' && !recipe.verified) {
      return {
        result: 'attempted',
        detail: `${recipe.note ?? lastDetail} (revoke-everywhere is unverified; no server-side invalidation is claimed)`
      };
    }

    return {
      result: recipe.capability === 'global' ? 'revoked' : 'attempted',
      detail: recipe.note ?? lastDetail
    };
  } catch (error) {
    return { result: 'none', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    if (tabId !== null) await closeTab(tabId);
  }
}

/**
 * Conventional logout paths, in the order they are worth probing.
 *
 * `account.` is included because Proton's logout lives there while proton.me/logout does
 * not exist at all - the kind of thing that is cheap to check and impossible to guess.
 */
const LOGOUT_PATHS = ['/logout', '/signout', '/sign-out', '/users/sign_out', '/auth/logout'];

/**
 * Find a logout URL that actually exists, before opening a tab on it.
 *
 * Without this the engine navigates a tab to a guessed path and the user watches a 404
 * appear and disappear - which happened with proton.me/logout, and looks exactly like the
 * extension is broken. A HEAD request costs nothing and is invisible.
 *
 * Only an explicit 404 or 410 rules a path out. Plenty of sites answer 405 to HEAD, or
 * redirect an anonymous request to a login page; neither means the path is absent.
 *
 * @param {string} domain
 * @param {number} budgetMs
 * @returns {Promise<string | null>}
 */
export async function findLogoutPath(domain, budgetMs = 6000) {
  const hosts = [domain, `www.${domain}`, `account.${domain}`];
  const deadline = Date.now() + budgetMs;

  for (const host of hosts) {
    for (const path of LOGOUT_PATHS) {
      if (Date.now() > deadline) return null;
      const url = `https://${host}${path}`;
      if (!isTrustedLogoutDestination(url, domain)) continue;
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          credentials: 'omit',
          redirect: 'follow',
          signal: AbortSignal.timeout(Math.max(500, Math.min(2500, deadline - Date.now())))
        });
        if (response.status !== 404 && response.status !== 410) return url;
      } catch {
        // Network error, CORS, or timeout tells us nothing either way. Move on rather
        // than opening a tab on a URL we have no evidence for.
      }
    }
  }
  return null;
}

/**
 * Tier 4 - OpenID Connect RP-initiated logout.
 *
 * Free coverage for anything sitting behind a standards-compliant IdP. Discovery is a
 * plain unauthenticated GET, so it is safe to do from the service worker; only the
 * logout itself needs a tab.
 *
 * @param {string} domain
 * @returns {Promise<string | null>} end_session_endpoint, if the site advertises one.
 */
export async function discoverOidcLogout(domain) {
  const candidates = [
    `https://${domain}/.well-known/openid-configuration`,
    `https://www.${domain}/.well-known/openid-configuration`
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, { credentials: 'omit', redirect: 'follow' });
      if (!response.ok) continue;
      const config = await response.json();
      const endpoint = config?.end_session_endpoint;
      if (typeof endpoint !== 'string') continue;

      // This document is served by the site we are logging out of. Treat it as hostile
      // input: without this check a malicious site could hand us any URL and we would
      // navigate there and start clicking confirm buttons on its behalf.
      if (!isTrustedLogoutDestination(endpoint, domain)) {
        console.warn(`[Session Sentinel] ${describeRefusal(endpoint, domain)}`);
        continue;
      }
      return endpoint;
    } catch {
      // Not an OIDC provider, or unreachable. Nothing to report.
    }
  }
  return null;
}

/**
 * @param {string} endpoint
 * @param {string} domain Registrable domain being logged out of.
 * @param {number} windowId
 * @param {number} timeoutMs
 * @returns {Promise<LogoutAttempt>}
 */
export async function runOidcLogout(endpoint, domain, windowId, timeoutMs) {
  /** @type {number | null} */
  let tabId = null;
  try {
    tabId = await openTab(windowId, endpoint, timeoutMs);

    // Checking the endpoint before navigating is not enough: it can redirect. Confirm
    // where we actually landed before clicking anything, or a trusted endpoint becomes
    // a one-hop bounce to an attacker's page.
    const landed = await chrome.tabs.get(tabId);
    if (!landed.url || !isTrustedLogoutDestination(landed.url, domain)) {
      return { result: 'none', detail: describeRefusal(landed.url ?? endpoint, domain) };
    }

    // Many providers land on a confirmation page when no id_token_hint is supplied.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: pageStep,
      args: [
        {
          op: 'clickText',
          selector: 'button, input[type="submit"], a[role="button"], a',
          text: 'sign out|log out|logout|yes|confirm|continue',
          optional: true
        }
      ]
    });
    await sleep(1200);
    return {
      result: 'attempted',
      detail: 'OpenID Connect sign-out was attempted; server-side invalidation was not independently verified'
    };
  } catch (error) {
    return { result: 'none', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    if (tabId !== null) await closeTab(tabId);
  }
}

/**
 * Try every site sign-out avenue, best first, stopping at the first observed attempt.
 *
 * @param {string} domain
 * @param {number} windowId
 * @param {number} timeoutMs
 * @returns {Promise<LogoutAttempt>}
 */
export async function attemptServerLogout(domain, windowId, timeoutMs) {
  const started = Date.now();
  const remaining = () => Math.max(0, timeoutMs - (Date.now() - started));

  // Built-in recipes overlaid with any verified remote bundle.
  const recipe = await findActiveRecipe(domain);
  if (recipe) {
    const attempt = await runRecipe(recipe, windowId, remaining());
    if (attempt.result !== 'none') return { ...attempt, method: 'recipe' };
  }

  if (remaining() > 4000) {
    const endpoint = await discoverOidcLogout(domain);
    if (endpoint) {
      const attempt = await runOidcLogout(endpoint, domain, windowId, remaining());
      if (attempt.result !== 'none') return { ...attempt, method: 'oidc' };
    }
  }

  // Tier 1. Two shapes, cheapest and most likely first. Without a site request, local
  // clearance gives the server no opportunity to invalidate its token.
  if (!recipe) {
    // Probe first: only open a tab on a logout URL that is known to exist. Guessing and
    // letting the user watch a 404 is both useless and alarming.
    const confirmed = remaining() > 8000 ? await findLogoutPath(domain, Math.min(6000, remaining() - 4000)) : null;

    if (confirmed && remaining() > 5000) {
      const attempt = await runRecipe(heuristicRecipe(`https://${domain}`, 'path', confirmed), windowId, remaining());
      if (attempt.result !== 'none') return { ...attempt, method: 'path' };
    }

    if (remaining() > 5000) {
      const attempt = await runRecipe(heuristicRecipe(`https://${domain}`, 'home'), windowId, remaining());
      if (attempt.result !== 'none') return { ...attempt, method: 'home' };
    }
  }

  return {
    result: 'none',
    method: 'none',
    detail: 'could not find a site sign-out; local data was cleared and server-side invalidation was not verified'
  };
}
