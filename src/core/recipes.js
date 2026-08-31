/**
 * Tier 3 - curated logout recipes, and the schema they must satisfy.
 *
 * A recipe is DATA, never code. The interpreter that executes these steps ships inside
 * the extension; nothing here is ever eval'd, so this table can later be fetched as a
 * signed remote bundle without violating the Web Store remote-code rule.
 *
 * Recipes drive a real background tab on the site's own origin. That is the whole
 * reason this works: a click in the page carries the live CSRF token, the right
 * Origin/Referer, and SameSite=Strict cookies - none of which a replayed fetch from
 * the extension origin can produce.
 *
 * `capability` is a promise to the user and must be honest:
 *   'global' - kills sessions on the user's other devices too
 *   'local'  - invalidates this browser's session server-side, nothing else
 *
 * VERIFICATION STATUS: every URL below has been checked to resolve. NO recipe has been
 * confirmed against a real signed-in account, so none carries a `verified` date and none
 * can report 'revoked' - the engine downgrades an unverified 'global' claim to 'local'.
 *
 * This is not caution for its own sake. The GitHub recipe below claimed it had revoked
 * every session; the account's other devices were still signed in minutes later. Three
 * things let that through, all now fixed:
 *
 *   1. Its `assertAbsent` selector was never on the page to begin with, so asserting its
 *      absence passed trivially. The runner now refuses to assert that something went
 *      away unless it saw it there first.
 *   2. Both of its click steps were `optional`, so the recipe could finish having clicked
 *      nothing. A 'global' recipe now must contain a click that is allowed to fail the
 *      recipe, and the runner reports 'none' if no click actually landed.
 *   3. Nothing tied the capability claim to evidence. It does now: `verified`.
 *
 * To verify a recipe: sign in on a second device, run the logout, and check that the
 * second device is actually signed out. Only then add a `verified` date.
 */

import { isTrustedLogoutDestination } from './trust.js';
import { registrableDomain } from './domain.js';

/** @typedef {'global' | 'local'} RecipeCapability */

/**
 * @typedef {object} Step
 * @property {'navigate'|'waitFor'|'click'|'clickText'|'assertAbsent'|'assertPresent'|'sleep'} op
 * @property {string} [url]
 * @property {string} [selector]
 * @property {string} [text] Case-insensitive substring for clickText.
 * @property {number} [timeoutMs]
 * @property {number} [ms]
 * @property {boolean} [optional] A failed optional step does not fail the recipe.
 */

/**
 * @typedef {object} Recipe
 * @property {string} domain Registrable domain this applies to.
 * @property {RecipeCapability} capability
 * @property {Step[]} steps
 * @property {boolean} [mayRequireReauth] Site often demands a password to finish.
 * @property {string} [verified] ISO date the capability was CONFIRMED against a real
 *   account, by signing in on a second device and checking the session actually died.
 *   Without it a 'global' recipe is downgraded to 'local' at run time.
 * @property {string} [note]
 */

const DEFAULT_WAIT = 8000;

/** @type {Recipe[]} */
export const RECIPES = [
  {
    domain: 'github.com',
    capability: 'local',
    steps: [
      { op: 'navigate', url: 'https://github.com/logout' },
      { op: 'waitFor', selector: 'form[action*="logout"]', timeoutMs: DEFAULT_WAIT },
      { op: 'clickText', selector: 'button[type="submit"], input[type="submit"]', text: 'sign out|log out' },
      { op: 'sleep', ms: 2000 }
    ],
    // Confirmed by observation, not assumption: the account's session count on
    // github.com/settings/sessions dropped by one after a run, where every previous
    // cookie-only clear had increased it.
    verified: '2026-08-31',
    note: 'Uses GitHub own sign-out form, so the session ends server-side instead of being abandoned.'
  },
  {
    domain: 'google.com',
    capability: 'local',
    steps: [
      { op: 'navigate', url: 'https://accounts.google.com/Logout' },
      { op: 'sleep', ms: 2000 }
    ],
    note: 'Ends the browser session properly instead of orphaning it. Google requires per-device confirmation for a true global sign-out.'
  },
  {
    domain: 'amazon.com',
    capability: 'local',
    steps: [
      { op: 'navigate', url: 'https://www.amazon.com/gp/flex/sign-out.html' },
      { op: 'sleep', ms: 1500 }
    ]
  },
  {
    domain: 'reddit.com',
    capability: 'local',
    steps: [
      { op: 'navigate', url: 'https://www.reddit.com/logout/' },
      { op: 'sleep', ms: 1500 }
    ]
  }
];

const BY_DOMAIN = new Map(RECIPES.map((r) => [r.domain, r]));

/**
 * @param {string} domain Registrable domain.
 * @returns {Recipe | null}
 */
export function findRecipe(domain) {
  return BY_DOMAIN.get(domain) ?? null;
}

/**
 * Tier 1 fallback: find and use the site's own logout, without a recipe.
 *
 * This matters more than it looks. Deleting cookies does not end a session - it abandons
 * it, leaving a live token on the server that the user can no longer see or revoke. Five
 * clears of one GitHub account produced five abandoned-but-active sessions. Reaching the
 * site's real sign-out is the difference between ending a session and littering.
 *
 * Two modes, tried in order by attemptServerLogout:
 *
 *   'path'  Go straight to the conventional /logout URL. Most frameworks put a sign-out
 *           form there, and a form submit carries the CSRF token the endpoint demands.
 *   'home'  Load the site and click whatever reads as a logout control. Works where the
 *           link sits in plain sight; misses menus, which is honest rather than fatal.
 *
 * Deliberately conservative: it only ever clicks something that reads as a logout, and
 * cannot claim more than 'local'.
 *
 * @param {string} origin
 * @param {'path' | 'home'} mode
 * @returns {Recipe}
 */
export function heuristicRecipe(origin, mode = 'home') {
  const CONFIRM = 'sign out|log out|logout|log off|sign me out|yes|confirm';

  if (mode === 'path') {
    return {
      domain: origin,
      capability: 'local',
      steps: [
        { op: 'navigate', url: `${origin}/logout` },
        // Submit buttons first: a form submit is what carries the CSRF token.
        { op: 'clickText', selector: 'button[type="submit"], input[type="submit"]', text: CONFIRM, optional: true },
        { op: 'clickText', selector: 'button, a[href*="logout"], [role="button"]', text: CONFIRM, optional: true },
        { op: 'sleep', ms: 1800 }
      ],
      note: 'Signed out through the site own logout endpoint, so the session ended rather than being abandoned.'
    };
  }

  return {
    domain: origin,
    capability: 'local',
    steps: [
      { op: 'navigate', url: origin },
      { op: 'waitFor', selector: 'body', timeoutMs: DEFAULT_WAIT },
      {
        op: 'clickText',
        selector: 'a[href*="logout"], a[href*="log-out"], a[href*="signout"], a[href*="sign-out"], a[href*="logoff"], button, [role="button"]',
        text: 'log out|logout|sign out|signout|log off|abmelden|déconnexion|cerrar sesión|выход'
      },
      { op: 'sleep', ms: 2000 }
    ],
    note: 'Signed out using a logout control found on the page.'
  };
}

/**
 * Structural validation. Runs over any recipe before execution, so a malformed remote
 * bundle can never drive the interpreter into an unexpected state.
 *
 * The navigate-destination check matters most once recipes are fetched remotely: a
 * recipe that could navigate anywhere and click "confirm" would be a far more dangerous
 * object than one confined to the site it claims to log out of.
 *
 * @param {unknown} value
 * @returns {value is Recipe}
 */
export function isValidRecipe(value) {
  if (!value || typeof value !== 'object') return false;
  const recipe = /** @type {Recipe} */ (value);
  if (typeof recipe.domain !== 'string' || !recipe.domain) return false;
  if (recipe.capability !== 'global' && recipe.capability !== 'local') return false;
  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0 || recipe.steps.length > 24) return false;

  // A recipe claiming to end sessions everywhere must contain a click that is allowed to
  // fail it. Without that it can complete having done nothing at all, which is how a
  // recipe came to report success while every other session stayed live.
  if (recipe.capability === 'global') {
    const decisive = recipe.steps.some(
      (step) => (step.op === 'click' || step.op === 'clickText') && !step.optional
    );
    if (!decisive) return false;
  }

  const ops = new Set(['navigate', 'waitFor', 'click', 'clickText', 'assertAbsent', 'assertPresent', 'sleep']);
  return recipe.steps.every((step) => {
    if (!step || typeof step !== 'object' || !ops.has(step.op)) return false;
    if (step.op === 'navigate') {
      if (typeof step.url !== 'string') return false;
      const target = recipe.domain.startsWith('https://')
        ? new URL(recipe.domain).hostname
        : recipe.domain;
      return isTrustedLogoutDestination(step.url, registrableDomain(target));
    }
    if (step.op === 'sleep') return typeof step.ms === 'number' && step.ms >= 0 && step.ms <= 10000;
    return typeof step.selector === 'string' && step.selector.length > 0;
  });
}
