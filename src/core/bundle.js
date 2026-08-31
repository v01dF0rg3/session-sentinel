/**
 * Signed recipe bundle: verification and validation.
 *
 * Recipes are the one part of this extension that changes faster than releases - sites
 * move their "sign out everywhere" buttons constantly. Fetching them remotely is
 * therefore worth doing, but it hands an attacker who controls (or MITMs) the bundle
 * host a way to steer a security extension. Everything here exists to close that.
 *
 * The rules, in order of application:
 *
 *   1. Size cap before parsing, so a huge body cannot be used to wedge the worker.
 *   2. Signature verified BEFORE the payload is parsed as anything meaningful.
 *   3. Version must not go backwards - otherwise an attacker who can replay an old,
 *      signed bundle could roll users back to a recipe set with a known problem.
 *   4. Every recipe re-validated individually, including the navigation trust policy,
 *      so a signed-but-wrong bundle still cannot send the engine off-site.
 *   5. Any failure keeps the recipes that shipped in the extension. It fails closed to
 *      known-good, never open.
 *
 * Uses WebCrypto, which exists in both the service worker and node, so the whole path is
 * testable against real keys and real forgeries.
 *
 * ECDSA P-256 rather than Ed25519: Ed25519 only reached WebCrypto in recent Chrome, and
 * an extension that silently cannot verify its updates on an older browser is worse than
 * one using a slightly older curve. P-256 has been available for a decade.
 */

import { isValidRecipe } from './recipes.js';

/** Hard ceiling on the fetched document, before any parsing. */
export const MAX_BUNDLE_BYTES = 512 * 1024;

/** Sanity ceiling on recipe count, so a valid signature cannot deliver a memory bomb. */
export const MAX_RECIPES = 2000;

/**
 * @typedef {object} BundlePayload
 * @property {number} version Monotonically increasing.
 * @property {string} generatedAt ISO 8601.
 * @property {import('./recipes.js').Recipe[]} recipes
 */

/**
 * @typedef {object} VerifyResult
 * @property {boolean} ok
 * @property {BundlePayload} [payload]
 * @property {string} [error]
 */

/**
 * @param {string} base64
 * @returns {Uint8Array}
 */
function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Import the pinned public key.
 * @param {string} spkiBase64
 * @returns {Promise<CryptoKey>}
 */
export async function importVerifyKey(spkiBase64) {
  return crypto.subtle.importKey(
    'spki',
    fromBase64(spkiBase64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

/**
 * Verify a fetched bundle document and return its payload.
 *
 * The envelope carries the payload as an opaque STRING, and the signature covers exactly
 * those bytes. Signing a string rather than an object sidesteps JSON canonicalisation
 * entirely - there is no re-serialisation step in which the verified bytes and the parsed
 * bytes could drift apart.
 *
 * @param {string} rawText Body as fetched.
 * @param {string} publicKeySpkiBase64 Pinned key.
 * @returns {Promise<VerifyResult>}
 */
export async function verifyBundle(rawText, publicKeySpkiBase64) {
  if (typeof rawText !== 'string' || rawText.length === 0) {
    return { ok: false, error: 'empty bundle' };
  }
  if (rawText.length > MAX_BUNDLE_BYTES) {
    return { ok: false, error: `bundle exceeds ${MAX_BUNDLE_BYTES} bytes` };
  }

  /** @type {any} */
  let envelope;
  try {
    envelope = JSON.parse(rawText);
  } catch {
    return { ok: false, error: 'bundle is not valid JSON' };
  }

  if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') {
    return { ok: false, error: 'bundle envelope is malformed' };
  }

  let verified = false;
  try {
    const key = await importVerifyKey(publicKeySpkiBase64);
    verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      fromBase64(envelope.signature),
      new TextEncoder().encode(envelope.payload)
    );
  } catch (error) {
    // A malformed signature or key must read as "not verified", never as an exception
    // that some caller might treat as a transient failure and retry past.
    return { ok: false, error: `signature could not be checked: ${error instanceof Error ? error.message : error}` };
  }

  if (!verified) return { ok: false, error: 'signature does not match' };

  /** @type {any} */
  let payload;
  try {
    payload = JSON.parse(envelope.payload);
  } catch {
    return { ok: false, error: 'signed payload is not valid JSON' };
  }

  return { ok: true, payload };
}

/**
 * Structural and policy checks on an already-verified payload.
 *
 * Signature checks authorship, not correctness: it proves the bundle came from the right
 * signer, not that the signer got it right. Recipes are therefore re-validated here with
 * exactly the same rules applied to the built-in ones.
 *
 * @param {any} payload
 * @param {number} currentVersion Version already installed; 0 if none.
 * @returns {{ ok: boolean, recipes: import('./recipes.js').Recipe[], rejected: number, error?: string }}
 */
export function validateBundle(payload, currentVersion) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, recipes: [], rejected: 0, error: 'payload is not an object' };
  }
  if (!Number.isInteger(payload.version) || payload.version < 1) {
    return { ok: false, recipes: [], rejected: 0, error: 'payload has no valid version' };
  }
  if (payload.version < currentVersion) {
    // Replaying an old, correctly signed bundle is a real attack: it rolls users back to
    // a recipe set whose problems are already known.
    return {
      ok: false,
      recipes: [],
      rejected: 0,
      error: `refusing to roll back from version ${currentVersion} to ${payload.version}`
    };
  }
  if (!Array.isArray(payload.recipes)) {
    return { ok: false, recipes: [], rejected: 0, error: 'payload has no recipe list' };
  }
  if (payload.recipes.length > MAX_RECIPES) {
    return { ok: false, recipes: [], rejected: 0, error: `bundle declares more than ${MAX_RECIPES} recipes` };
  }

  const recipes = payload.recipes.filter((/** @type {unknown} */ r) => isValidRecipe(r));
  return { ok: true, recipes, rejected: payload.recipes.length - recipes.length };
}

/**
 * Built-in recipes overlaid with verified remote ones.
 *
 * Remote wins per domain, because the point of the bundle is to fix a recipe faster than
 * a release can. A remote recipe that failed validation was already dropped, so the
 * built-in entry survives in its place rather than the site losing coverage.
 *
 * @param {import('./recipes.js').Recipe[]} builtin
 * @param {import('./recipes.js').Recipe[]} remote
 * @returns {import('./recipes.js').Recipe[]}
 */
export function mergeRecipes(builtin, remote) {
  const byDomain = new Map(builtin.map((r) => [r.domain, r]));
  for (const recipe of remote) byDomain.set(recipe.domain, recipe);
  return [...byDomain.values()];
}
