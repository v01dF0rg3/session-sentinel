/**
 * How often the user actually visits a site.
 *
 * `chrome.topSites` returns the handful of sites Chrome puts on the new-tab page. It is
 * deliberately used instead of `chrome.history`, which would expose every page the user
 * has ever opened, with timestamps. Top sites is a short list of domains and nothing else,
 * and it is enough for what this is for.
 *
 * WHAT THIS IS AND IS NOT FOR.
 *
 * Frequency is not sensitivity. A news site opened every morning is not more dangerous to
 * lose than a bank opened twice a year, and letting visit counts raise a risk tier would
 * get that exactly backwards. So this never changes a tier. It breaks ties *within* one:
 * given two critical accounts, the one the user actually lives in is the one to secure
 * first, and the one worth naming when a list gets long.
 *
 * The permission is optional and off by default. A privacy tool does not get to quietly
 * widen its own access.
 */

import { registrableDomain, hostnameFromUrl } from '../core/domain.js';

/** @returns {Promise<boolean>} */
export async function hasFrequencyPermission() {
  try {
    return await chrome.permissions.contains({ permissions: ['topSites'] });
  } catch {
    return false;
  }
}

/**
 * Ask for the permission. Must be called from a user gesture, so this lives behind a
 * click in the options page rather than being requested on startup.
 * @returns {Promise<boolean>}
 */
export async function requestFrequencyPermission() {
  try {
    return await chrome.permissions.request({ permissions: ['topSites'] });
  } catch {
    return false;
  }
}

/** @returns {Promise<boolean>} */
export async function dropFrequencyPermission() {
  try {
    return await chrome.permissions.remove({ permissions: ['topSites'] });
  } catch {
    return false;
  }
}

/**
 * Registrable domains among the user's most-visited sites.
 *
 * Returns an empty set when the permission has not been granted, so every caller
 * degrades to plain alphabetical ordering without needing to know why.
 *
 * @returns {Promise<Set<string>>}
 */
export async function getFrequentDomains() {
  if (!(await hasFrequencyPermission())) return new Set();

  try {
    const sites = await chrome.topSites.get();
    /** @type {Set<string>} */
    const domains = new Set();
    for (const site of sites) {
      const host = hostnameFromUrl(site.url);
      if (host) domains.add(registrableDomain(host));
    }
    return domains;
  } catch {
    return new Set();
  }
}
