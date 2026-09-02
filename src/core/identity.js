/**
 * Federated sign-in groups.
 *
 * A site whose identity provider is a different domain may be signed straight back in if
 * processed alone. Clearing youtube.com while google.com stays signed in can be undone on
 * the next visit. So cleanup has to consider the whole group and report what it included.
 *
 * Pure - no chrome.* - so the rule is testable.
 */

import { IDENTITY_GROUPS } from '../../data/identity-groups.js';

/** domain -> every domain sharing its sign-in (including itself). */
const GROUP_BY_DOMAIN = new Map();
for (const group of IDENTITY_GROUPS) {
  for (const domain of group) GROUP_BY_DOMAIN.set(domain, group);
}

/**
 * Domains sharing a sign-in with this one, excluding itself. Empty for most sites.
 * @param {string} domain
 * @returns {string[]}
 */
export function siblingsOf(domain) {
  const group = GROUP_BY_DOMAIN.get(domain);
  return group ? group.filter((d) => d !== domain) : [];
}

/**
 * Expand a target list to cover federated siblings the user is actually signed into.
 *
 * Restricted to `known` - the domains with cookies in this profile - deliberately. Adding
 * every sibling unconditionally would list sites the user has never used, and would make
 * a per-site logout look like it was reaching much further than it is.
 *
 * @param {string[]} targets Domains the user asked to clear.
 * @param {string[]} known Domains with cookies in this profile.
 * @returns {{ domains: string[], added: Array<{ domain: string, because: string }> }}
 */
export function expandForIdentity(targets, known) {
  const knownSet = new Set(known);
  const result = new Set(targets);
  /** @type {Array<{ domain: string, because: string }>} */
  const added = [];

  for (const target of targets) {
    for (const sibling of siblingsOf(target)) {
      if (!knownSet.has(sibling) || result.has(sibling)) continue;
      result.add(sibling);
      added.push({ domain: sibling, because: target });
    }
  }

  return { domains: [...result], added };
}

/**
 * Members of a group that the user has asked never to clear.
 *
 * These are the reason a logout can silently fail: the kept site re-authenticates the one
 * that was cleared. The engine reports it rather than letting the user believe otherwise.
 *
 * @param {string} domain
 * @param {(domain: string) => boolean} isKept
 * @returns {string[]}
 */
export function keptSiblings(domain, isKept) {
  return siblingsOf(domain).filter(isKept);
}
