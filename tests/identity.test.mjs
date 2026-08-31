/**
 * Tests for federated sign-in groups.
 *
 * These exist because of a logout that appeared to do nothing: clearing youtube.com while
 * google.com stayed signed in, after which accounts.google.com simply handed YouTube a
 * fresh session. A site whose identity lives on another domain cannot be logged out alone,
 * and an extension that pretends otherwise reports success for nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { expandForIdentity, keptSiblings, siblingsOf } from '../src/core/identity.js';

test('federated siblings are known', () => {
  assert.ok(siblingsOf('youtube.com').includes('google.com'));
  assert.ok(siblingsOf('google.com').includes('youtube.com'));
  assert.ok(siblingsOf('instagram.com').includes('facebook.com'));
  assert.ok(siblingsOf('outlook.com').includes('microsoftonline.com'));
});

test('unrelated sites have no siblings', () => {
  assert.deepEqual(siblingsOf('chase.com'), []);
  assert.deepEqual(siblingsOf('somerandomblog.net'), []);
  // Shared ownership is not shared sign-in: an Amazon session does not restore Twitch.
  assert.deepEqual(siblingsOf('twitch.tv'), []);
});

test('clearing youtube also clears google when the user is signed into both', () => {
  const known = ['youtube.com', 'google.com', 'chase.com'];
  const { domains, added } = expandForIdentity(['youtube.com'], known);

  assert.ok(domains.includes('google.com'), 'otherwise Google signs YouTube straight back in');
  assert.deepEqual(added, [{ domain: 'google.com', because: 'youtube.com' }]);
  assert.ok(!domains.includes('chase.com'), 'unrelated sites are untouched');
});

test('expansion only reaches sites the user is actually signed into', () => {
  // Otherwise a one-site logout would list a pile of Google properties the user has
  // never used, and look far more sweeping than it is.
  const { domains, added } = expandForIdentity(['youtube.com'], ['youtube.com']);
  assert.deepEqual(domains, ['youtube.com']);
  assert.deepEqual(added, []);
});

test('expansion does not duplicate or reorder existing targets', () => {
  const known = ['google.com', 'youtube.com'];
  const { domains } = expandForIdentity(['google.com', 'youtube.com'], known);
  assert.equal(domains.length, 2);
  assert.equal(new Set(domains).size, 2);
});

test('a kept sibling is reported, because it will undo the logout', () => {
  const kept = keptSiblings('youtube.com', (d) => d === 'google.com');
  assert.deepEqual(kept, ['google.com']);

  assert.deepEqual(keptSiblings('youtube.com', () => false), []);
  assert.deepEqual(keptSiblings('chase.com', () => true), []);
});
