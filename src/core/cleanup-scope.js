import { isCleanupDomain, normalizeCookieDomain, registrableDomain } from './domain.js';

export const CLEARABLE_TYPES = new Set(['cookies', 'localStorage', 'serviceWorkers', 'indexedDB', 'cacheStorage', 'fileSystems']);

/** Concrete origins only. Cookie and tab evidence must not widen the site boundary. */
export function cleanupOrigins(domain, cookieHosts = [], tabUrls = []) {
  if (!isCleanupDomain(domain)) return [];
  const origins = new Set();
  const addHost = (value) => {
    const host = normalizeCookieDomain(value);
    if (!host || registrableDomain(host) !== domain) return;
    origins.add(`https://${host}`);
    origins.add(`http://${host}`);
  };
  addHost(domain);
  if (!domain.startsWith('[') && !/^\d+(?:\.\d+){3}$/.test(domain)) addHost(`www.${domain}`);
  cookieHosts.forEach(addHost);
  for (const value of tabUrls) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      if (registrableDomain(url.hostname) === domain) origins.add(url.origin);
    } catch { /* Malformed or non-web tabs never enter the removal scope. */ }
  }
  return [...origins].sort();
}
