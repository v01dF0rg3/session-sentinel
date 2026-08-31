/**
 * The active recipe set: what shipped in the extension, overlaid with a verified remote
 * bundle if one has been fetched.
 *
 * Privacy property, and the reason this is a bundle rather than an API: the WHOLE set is
 * fetched in one request, never queried per domain. The host therefore learns that
 * somebody downloaded the recipe list — not which sites that person is signed into. An
 * endpoint answering "what is the logout recipe for chase.com?" would leak exactly the
 * thing this extension exists to protect.
 *
 * Failure is always closed: any problem fetching, verifying, or validating leaves the
 * built-in recipes in place. There is no state in which a bad bundle removes coverage.
 */

import { RECIPES as BUILTIN_RECIPES } from '../core/recipes.js';
import { mergeRecipes, validateBundle, verifyBundle } from '../core/bundle.js';

/**
 * Pinned signing key (ECDSA P-256, SPKI, base64). Changing this requires an extension
 * update, which is the point: the update channel is only as trustworthy as this pin.
 */
export const BUNDLE_PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEKgoZSnrLxEBpR8mJV4jlb9g0uOsQHmtu03TdCbINlfr1b0A24H+egCZzaiySimTPvBLxy7oMxC8rZrDLTSi5aQ==';

/**
 * Where the bundle is published. No host is live yet, which is why recipe updates
 * default to OFF in settings — a feature that silently fails every week is worse than
 * one that is honestly switched off until it works.
 */
export const DEFAULT_BUNDLE_URL = 'https://session-sentinel.pages.dev/recipes/bundle.json';

const STORAGE_KEY = 'recipeBundle';

/** @typedef {import('../core/recipes.js').Recipe} Recipe */

/**
 * @typedef {object} StoredBundle
 * @property {number} version
 * @property {string} generatedAt
 * @property {Recipe[]} recipes
 * @property {number} fetchedAt
 */

/** Module-scope cache. The service worker is torn down often enough to bound its life. */
/** @type {Recipe[] | null} */
let cache = null;

/** @returns {Promise<StoredBundle | null>} */
export async function getStoredBundle() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const bundle = stored[STORAGE_KEY];
  return bundle && Array.isArray(bundle.recipes) ? bundle : null;
}

/**
 * Every recipe currently in force.
 * @returns {Promise<Recipe[]>}
 */
export async function getActiveRecipes() {
  if (cache) return cache;
  const stored = await getStoredBundle();
  cache = stored ? mergeRecipes(BUILTIN_RECIPES, stored.recipes) : [...BUILTIN_RECIPES];
  return cache;
}

/**
 * @param {string} domain Registrable domain.
 * @returns {Promise<Recipe | null>}
 */
export async function findActiveRecipe(domain) {
  const recipes = await getActiveRecipes();
  return recipes.find((r) => r.domain === domain) ?? null;
}

/**
 * @typedef {object} RefreshResult
 * @property {boolean} updated
 * @property {number} [version]
 * @property {number} [recipeCount]
 * @property {number} [rejected]
 * @property {string} [error]
 */

/**
 * Fetch, verify, validate, and install a new bundle.
 *
 * @param {string} url
 * @returns {Promise<RefreshResult>}
 */
export async function refreshBundle(url = DEFAULT_BUNDLE_URL) {
  // A non-https host would let a network attacker swap the body. The signature would
  // still catch it, but refusing outright means one fewer thing depending on that check.
  if (!url.startsWith('https://')) {
    return { updated: false, error: 'bundle URL must be https' };
  }

  let rawText;
  try {
    const response = await fetch(url, {
      // No cookies, no referrer: fetching the recipe list must not identify the user.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-cache'
    });
    if (!response.ok) return { updated: false, error: `bundle host returned ${response.status}` };
    rawText = await response.text();
  } catch (error) {
    return { updated: false, error: error instanceof Error ? error.message : String(error) };
  }

  const verified = await verifyBundle(rawText, BUNDLE_PUBLIC_KEY);
  if (!verified.ok || !verified.payload) {
    return { updated: false, error: verified.error ?? 'verification failed' };
  }

  const current = await getStoredBundle();
  const validation = validateBundle(verified.payload, current?.version ?? 0);
  if (!validation.ok) {
    return { updated: false, error: validation.error ?? 'validation failed' };
  }

  // Same version we already hold: nothing to do, and no reason to churn storage.
  if (current && verified.payload.version === current.version) {
    return { updated: false, version: current.version, recipeCount: current.recipes.length };
  }

  /** @type {StoredBundle} */
  const bundle = {
    version: verified.payload.version,
    generatedAt: verified.payload.generatedAt,
    recipes: validation.recipes,
    fetchedAt: Date.now()
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: bundle });
  cache = null;

  return {
    updated: true,
    version: bundle.version,
    recipeCount: bundle.recipes.length,
    rejected: validation.rejected
  };
}

/** Drop any fetched bundle and return to the recipes that shipped with the extension. */
export async function resetToBuiltin() {
  await chrome.storage.local.remove(STORAGE_KEY);
  cache = null;
}
