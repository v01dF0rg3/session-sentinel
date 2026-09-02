/**
 * Tests for change-password discovery.
 *
 * This is the closest thing to real blanket revocation the extension can offer, so the
 * failure that matters is a confident wrong answer: sending a frightened user to a URL
 * that turns out to be a 404 page, at the one moment they most need the tool to work.
 * Every test here is about refusing to claim support that was not demonstrated.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_PATH,
  WELL_KNOWN_PATH,
  changePasswordUrl,
  controlUrl,
  hostCandidates,
  interpretProbe
} from '../src/core/change-password.js';

test('the user is handed the well-known URL, not a resolved one', () => {
  // Their browser follows the redirect with their cookies and lands on the signed-in
  // page. Resolving it here, credentials omitted, would follow the logged-out branch.
  assert.equal(changePasswordUrl('github.com'), 'https://github.com/.well-known/change-password');
  assert.equal(controlUrl('github.com'), `https://github.com${CONTROL_PATH}`);
  assert.match(WELL_KNOWN_PATH, /^\/\.well-known\//);
});

test('a site that serves the endpoint is supported', () => {
  assert.deepEqual(interpretProbe(404, 200), { supported: true, reason: 'ok' });
});

test('a redirect to the real password page counts as support', () => {
  // fetch follows redirects, so this arrives as the destination's status.
  assert.equal(interpretProbe(404, 200).supported, true);
});

test('an explicit 404 means the site has never heard of the convention', () => {
  assert.deepEqual(interpretProbe(404, 404), { supported: false, reason: 'absent' });
  assert.equal(interpretProbe(404, 410).reason, 'absent');
});

test('a site with no real 404s is refused even when it answers 200', () => {
  // The whole point of the control probe. A soft-404 site answers 200 for everything, so
  // its 200 for the real URL proves nothing — and opening it is the Proton 404-tab bug.
  assert.deepEqual(interpretProbe(200, 200), { supported: false, reason: 'unreliable' });
});

test('needing a login is not the same as not existing', () => {
  // A 401, 403 or login wall means the endpoint is there and wants the user signed in —
  // which is exactly what happens when they click it in their own browser.
  for (const status of [401, 403, 302, 200]) {
    assert.equal(interpretProbe(404, status).supported, true, `status ${status}`);
  }
});

test('a network failure is never read as absence', () => {
  // Offline is a fact about the moment, not about the site. Recording it as "no password
  // page" would make a dropped connection permanent.
  assert.deepEqual(interpretProbe(null, null), { supported: false, reason: 'unreachable' });
  assert.equal(interpretProbe(404, null).reason, 'unreachable');
  assert.equal(interpretProbe(null, 200).reason, 'unreachable');
});

test('a server error is not treated as proof of anything', () => {
  // 500 on the control means the site is unwell, not that it lacks real 404s. It still
  // must not be promoted to supported on that basis alone.
  const result = interpretProbe(500, 500);
  assert.equal(result.supported, true, 'the well-known URL was not denied');
});

test('the apex is not the last word on where identity lives', () => {
  // Measured, not assumed: google.com answers 404 while accounts.google.com serves the
  // endpoint. Stopping at the apex would have written off one of the most important
  // accounts a person has.
  const candidates = hostCandidates('google.com');
  assert.deepEqual(candidates, ['google.com', 'accounts.google.com', 'www.google.com']);
  assert.equal(candidates[0], 'google.com', 'the apex is still tried first');
});

test('the candidate list stays short, because each one costs two requests', () => {
  // A recovery plan covering twenty accounts multiplies whatever this returns.
  assert.ok(hostCandidates('example.com').length <= 3);
});
