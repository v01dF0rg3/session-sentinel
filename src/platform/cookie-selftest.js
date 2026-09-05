import { wipeSite } from './sessions.js';

export const COOKIE_TEST_DOMAIN = 'session-sentinel-selftest.invalid';
const PARTITION_SITE = 'https://session-sentinel-partition.invalid';

/** Exercise real cookie deletion without touching a real website or a real credential. */
export async function testCookieCleanup() {
  const plain = '__Host-sentinel_canary';
  const partitioned = '__Host-sentinel_partitioned_canary';
  try {
    for (const [name, partitionKey] of [[plain, undefined], [partitioned, { topLevelSite: PARTITION_SITE }]]) {
      await chrome.cookies.set({
        url: `https://${COOKIE_TEST_DOMAIN}/`, name, value: 'public-diagnostic-canary',
        path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction',
        expirationDate: Math.floor(Date.now() / 1000) + 120,
        ...(partitionKey ? { partitionKey } : {})
      });
    }
    const observed = await chrome.cookies.getAll({ domain: COOKIE_TEST_DOMAIN, partitionKey: {} });
    if (!observed.some((c) => c.name === plain && !c.partitionKey) ||
        !observed.some((c) => c.name === partitioned && c.partitionKey?.topLevelSite === PARTITION_SITE)) {
      throw new Error('both cookie types were not observed');
    }
    const result = await wipeSite(COOKIE_TEST_DOMAIN, ['cookies']);
    return result.ok
      ? { ok: true, detail: 'created ordinary and partitioned canaries, deleted both, then verified an empty test jar' }
      : { ok: false, detail: 'test-cookie cleanup could not be verified; any remaining canaries expire within two minutes' };
  } catch {
    await wipeSite(COOKIE_TEST_DOMAIN, ['cookies']).catch(() => {});
    return { ok: false, detail: 'could not create, read, or remove both test-cookie types; any remaining canaries expire within two minutes' };
  }
}
