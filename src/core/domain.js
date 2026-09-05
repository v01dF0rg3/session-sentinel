/**
 * Site boundaries are security boundaries, not just display grouping. Include the full
 * ICANN + PRIVATE Public Suffix List so unrelated hosted tenants are never siblings.
 * The bundled snapshot is updated at build time, never fetched from a user's browser.
 */

import { PUBLIC_SUFFIX_RULES } from '../../data/public-suffix-rules.js';

const SUFFIXES = new Set(PUBLIC_SUFFIX_RULES);

/**
 * Strip a leading dot from a cookie `domain` attribute.
 * @param {string} domain
 * @returns {string}
 */
export function normalizeCookieDomain(domain) {
  if (typeof domain !== 'string') return '';
  const host = domain.replace(/^\./, '').replace(/\.$/, '').toLowerCase();
  if (!host || /[\s/@?#\\]/.test(host)) return '';
  try {
    const parsed = new URL(`https://${host}`);
    if (parsed.port || parsed.username || parsed.password) return '';
    // A hostname, never a host:port (including an explicit default port).
    if (host.includes(':') && !/^\[[0-9a-f:]+\]$/.test(host)) return '';
    if (parsed.hostname.startsWith('[')) return parsed.hostname;
    const ascii = parsed.hostname;
    if (ascii.length > 253 || ascii.split('.').some((label) =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return '';
    return ascii;
  } catch {
    return '';
  }
}

/**
 * Reduce a hostname to its registrable domain.
 * @param {string} hostname
 * @returns {string}
 */
export function registrableDomain(hostname) {
  const host = normalizeCookieDomain(hostname);
  if (!host || host === 'localhost') return host;
  // Bare IP addresses have no registrable domain; treat them as their own site.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;

  const labels = host.split('.');
  let suffixLength = 1; // PSL implicit '*' rule for an unknown TLD.
  for (let index = 0; index < labels.length; index++) {
    const suffix = labels.slice(index).join('.');
    if (SUFFIXES.has(`!${suffix}`)) return labels.slice(index).join('.');
    if (SUFFIXES.has(suffix)) suffixLength = Math.max(suffixLength, labels.length - index);
    if (index > 0 && SUFFIXES.has(`*.${suffix}`)) {
      suffixLength = Math.max(suffixLength, labels.length - index + 1);
    }
  }
  return labels.length > suffixLength ? labels.slice(-(suffixLength + 1)).join('.') : '';
}

/** Only an exact normalized site boundary may reach a destructive API. */
export function isCleanupDomain(domain) {
  return typeof domain === 'string' && domain !== 'localhost' && domain !== '' &&
    normalizeCookieDomain(domain) === domain && registrableDomain(domain) === domain;
}

/**
 * Default HTTPS address for a registrable site. This is not a complete storage-origin
 * inventory; cleanup uses the separately validated origin scope.
 * @param {string} domain
 * @returns {string}
 */
export function domainToOrigin(domain) {
  return `https://${domain}`;
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function hostnameFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}
