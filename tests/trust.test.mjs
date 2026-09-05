/**
 * Tests for the navigation trust policy.
 *
 * This is the security boundary around attacker-influenced input: a site's own OIDC
 * discovery document names where the extension should go to log out, and a remotely
 * fetched recipe could do the same. Both must be prevented from steering a background
 * tab - carrying the user's cookies - somewhere of the attacker's choosing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTrustedLogoutDestination } from '../src/core/trust.js';
import { isValidRecipe } from '../src/core/recipes.js';

test('the site itself and its subdomains are trusted', () => {
  assert.ok(isTrustedLogoutDestination('https://example.com/logout', 'example.com'));
  assert.ok(isTrustedLogoutDestination('https://accounts.example.com/logout', 'example.com'));
  assert.ok(isTrustedLogoutDestination('https://a.b.c.example.com/out?x=1', 'example.com'));
});

test('recognised providers do not authorize cross-account automation', () => {
  // Recognising a provider cannot let an arbitrary site direct clicks into it.
  assert.ok(!isTrustedLogoutDestination('https://acme.okta.com/oauth2/v1/logout', 'acme-corp.com'));
  assert.ok(!isTrustedLogoutDestination('https://login.microsoftonline.com/common/oauth2/v2.0/logout', 'contoso.com'));
  assert.ok(!isTrustedLogoutDestination('https://tenant.auth0.com/v2/logout', 'startup.io'));
});

test('an unrelated destination is refused', () => {
  // The core attack: evil.com serves a discovery document pointing at its own page, and
  // without this check the engine navigates there and clicks "confirm".
  assert.ok(!isTrustedLogoutDestination('https://evil.example/steal', 'yourbank.com'));
  assert.ok(!isTrustedLogoutDestination('https://phishing.test/login', 'example.com'));
});

test('lookalike domains do not slip past the provider allowlist', () => {
  assert.ok(!isTrustedLogoutDestination('https://okta.com.evil.test/logout', 'example.com'));
  assert.ok(!isTrustedLogoutDestination('https://evil-okta.com/logout', 'example.com'));
  assert.ok(!isTrustedLogoutDestination('https://notokta.com/logout', 'example.com'));
  assert.ok(!isTrustedLogoutDestination('https://auth0.com.attacker.test/v2/logout', 'example.com'));
});

test('non-https schemes are refused outright', () => {
  // http would put the session cookie on the wire; the rest have no business here.
  assert.ok(!isTrustedLogoutDestination('http://example.com/logout', 'example.com'));
  assert.ok(!isTrustedLogoutDestination('javascript:alert(1)', 'example.com'));
  assert.ok(!isTrustedLogoutDestination('data:text/html,<h1>hi', 'example.com'));
  assert.ok(!isTrustedLogoutDestination('chrome-extension://abc/page.html', 'example.com'));
  assert.ok(!isTrustedLogoutDestination('file:///C:/Windows/System32', 'example.com'));
});

test('malformed input is refused rather than throwing', () => {
  for (const value of ['', 'not a url', '///', 'https://', '://example.com']) {
    assert.doesNotThrow(() => isTrustedLogoutDestination(value, 'example.com'));
    assert.ok(!isTrustedLogoutDestination(value, 'example.com'), `${value} must be refused`);
  }
});

test('a recipe cannot navigate off the site it claims to log out of', () => {
  const offsite = {
    domain: 'example.com',
    capability: 'global',
    steps: [
      { op: 'navigate', url: 'https://attacker.test/harvest' },
      { op: 'clickText', selector: 'button', text: 'confirm' }
    ]
  };
  assert.ok(!isValidRecipe(offsite), 'a remote bundle must not be able to redirect the engine');

  const onsite = {
    domain: 'example.com',
    capability: 'global',
    steps: [
      { op: 'navigate', url: 'https://www.example.com/settings/sessions' },
      // A global recipe must also carry a click that can fail it - see recipes.js.
      { op: 'clickText', selector: 'button', text: 'sign out of all' }
    ]
  };
  assert.ok(isValidRecipe(onsite));
});
