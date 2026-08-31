/**
 * Registrable-domain ("eTLD+1") extraction without shipping the full Public Suffix List.
 *
 * A compact suffix subset covers the multi-label public suffixes that actually show up
 * in browser cookie jars. Anything not listed falls back to "last two labels", which is
 * correct for every single-label TLD. Getting this wrong only ever mis-groups sites in
 * the UI - destruction is always driven from concrete origins, never from this guess.
 */

/** Multi-label public suffixes, longest-match wins. */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'org.mx', 'gob.mx', 'com.ar', 'gob.ar', 'com.co', 'gov.co',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'lg.jp',
  'co.kr', 'or.kr', 'go.kr', 'ac.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'com.hk', 'org.hk', 'gov.hk',
  'com.tw', 'org.tw', 'gov.tw', 'com.sg', 'gov.sg', 'com.my', 'gov.my',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'co.id', 'go.id',
  'com.tr', 'gov.tr', 'com.ua', 'com.pl', 'gov.pl', 'com.ru', 'gov.ru',
  'co.il', 'org.il', 'gov.il', 'com.sa', 'gov.sa', 'ae.org',
  'com.ph', 'gov.ph', 'com.vn', 'gov.vn', 'co.th', 'go.th', 'or.th',
  'gov.ie', 'gouv.fr', 'gov.it', 'gob.es', 'gov.gr', 'gov.pt',
  // Suffixes where each subdomain is an independent security origin.
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app',
  'herokuapp.com', 'firebaseapp.com', 'web.app', 'appspot.com', 'azurewebsites.net',
  'cloudfront.net', 's3.amazonaws.com', 'blob.core.windows.net',
  'myshopify.com', 'zendesk.com', 'atlassian.net', 'sharepoint.com', 'freshdesk.com'
]);

/**
 * Strip a leading dot from a cookie `domain` attribute.
 * @param {string} domain
 * @returns {string}
 */
export function normalizeCookieDomain(domain) {
  return domain.replace(/^\./, '').toLowerCase();
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
  if (labels.length <= 2) return host;

  // Longest matching multi-label suffix wins, so `s3.amazonaws.com` beats `amazonaws.com`.
  for (let take = Math.min(3, labels.length - 1); take >= 2; take--) {
    const suffix = labels.slice(-take).join('.');
    if (MULTI_LABEL_SUFFIXES.has(suffix)) {
      return labels.slice(-(take + 1)).join('.');
    }
  }
  return labels.slice(-2).join('.');
}

/**
 * Best-effort origin for a registrable domain. Everything relevant is HTTPS in practice,
 * and `browsingData` keys cookie removal by registrable domain regardless of scheme.
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
