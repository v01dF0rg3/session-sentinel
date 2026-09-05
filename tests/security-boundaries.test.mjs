import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrableDomain } from '../src/core/domain.js';
import { isTrustedLogoutDestination } from '../src/core/trust.js';
import { isValidRecipe, heuristicRecipe } from '../src/core/recipes.js';
import { buildPlan } from '../src/core/plan.js';
import { DEFAULT_SETTINGS } from '../src/core/policy.js';
import { isTrustedUiSender, isUnsupportedPrivateAction } from '../src/core/command-policy.js';

test('private suffix tenants are independent security boundaries', () => {
  for (const suffix of ['blogspot.com', 'duckdns.org', 'eu.org', 's3.amazonaws.com', 'github.io']) {
    assert.equal(registrableDomain(`app.alice.${suffix}`), `alice.${suffix}`);
    assert.equal(isTrustedLogoutDestination(`https://bob.${suffix}/logout`, `alice.${suffix}`), false);
  }
});

test('PSL wildcard and exception rules preserve the registrant', () => {
  assert.equal(registrableDomain('a.b.ck'), 'a.b.ck');
  assert.equal(registrableDomain('app.www.ck'), 'www.ck');
  assert.equal(registrableDomain('a.city.kawasaki.jp'), 'city.kawasaki.jp');
  assert.equal(registrableDomain('a.b.kawasaki.jp'), 'a.b.kawasaki.jp');
  assert.equal(registrableDomain('WWW.BÜCHER.DE.'), 'xn--bcher-kva.de');
});

test('public suffixes and URL-shaped inputs cannot become cleanup targets', () => {
  for (const bad of ['com', 'co.uk', 'blogspot.com', 'b.ck', 'https://example.com', 'example.com/path', 'user@example.com', 'example.com:443', 'example..com']) {
    const plan = buildPlan([bad], 'manualSite', DEFAULT_SETTINGS);
    assert.equal(plan.targets.length, 0, `must refuse ${bad}`);
  }
});

test('unrelated sites cannot steer sign-out into another account provider', () => {
  for (const url of ['https://accounts.google.com/Logout', 'https://tenant.auth0.com/v2/logout', 'https://login.microsoftonline.com/common/oauth2/logout']) {
    assert.equal(isTrustedLogoutDestination(url, 'attacker.example'), false);
  }
  assert.equal(isTrustedLogoutDestination('https://accounts.google.com/Logout', 'google.com'), true);
});

test('credential-bearing and nonstandard-port navigation is refused', () => {
  for (const url of ['https://user:pass@example.com/logout', 'https://example.com:8443/logout', 'https://example.com.evil.test/logout']) {
    assert.equal(isTrustedLogoutDestination(url, 'example.com'), false);
  }
});

test('recipe validation never throws on malformed untrusted data', () => {
  for (const domain of ['https://', 'com', 'https://user:pass@example.com', 'https://example.com/path', 'example.com:8443']) {
    const recipe = { domain, capability: 'local', steps: [{ op: 'navigate', url: 'https://example.com/logout' }] };
    assert.doesNotThrow(() => isValidRecipe(recipe));
    assert.equal(isValidRecipe(recipe), false);
  }
  for (const step of [null, { op: 'waitFor', selector: 'body', timeoutMs: Infinity }, { op: 'clickText', selector: 'button', text: {} }, { op: 'click', selector: '*', optional: 'false' }]) {
    assert.equal(isValidRecipe({ domain: 'example.com', capability: 'local', steps: [{ op: 'navigate', url: 'https://example.com/' }, step] }), false);
  }
});

test('generic recipes do not approve ambiguous confirmation controls', () => {
  for (const mode of ['home', 'path']) {
    const recipe = heuristicRecipe('https://example.com', mode);
    for (const step of recipe.steps.filter((s) => s.op === 'clickText')) {
      assert.equal(step.text.split('|').some((s) => ['yes', 'confirm', 'continue'].includes(s)), false);
    }
  }
});

test('only packaged extension UI pages may send privileged commands', () => {
  assert.equal(isTrustedUiSender({ id: 'abc', url: 'chrome-extension://abc/src/ui/popup.html' }, 'abc'), true);
  for (const sender of [
    { id: 'abc', url: 'https://example.com/' },
    { id: 'abc', url: 'chrome-extension://abc/dev/fixture.html' },
    { id: 'abc', url: 'chrome-extension://abc/src/ui/unknown.html' },
    { id: 'other', url: 'chrome-extension://abc/src/ui/popup.html' },
    { id: 'abc', url: 'chrome-extension://other/src/ui/popup.html' },
    { id: 'abc' }, null
  ]) assert.equal(isTrustedUiSender(sender, 'abc'), false);
});

test('Incognito account actions cannot silently operate the normal profile', () => {
  assert.equal(isUnsupportedPrivateAction({ type: 'runNow', incognitoContext: true }, {}), true);
  assert.equal(isUnsupportedPrivateAction({ type: 'clearSite' }, { tab: { incognito: true } }), true);
  assert.equal(isUnsupportedPrivateAction({ type: 'getOverview', incognitoContext: true }, {}), false);
  assert.equal(isUnsupportedPrivateAction({ type: 'runNow', incognitoContext: false }, {}), false);
});
