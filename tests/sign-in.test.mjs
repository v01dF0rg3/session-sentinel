/**
 * Tests for deciding whether the user actually has an account on a site.
 *
 * The bug that prompted this: a real profile reported 225 signed-in sites, and the list
 * led with aol.com — an account the user does not have. Anything that sets a cookie while
 * you read a page was being counted as a login, so the number was meaningless and the
 * accounts that mattered were buried under it.
 *
 * There are two questions here and they must not be confused. "Might this cookie carry a
 * session, and therefore be worth destroying" is answered generously, because missing one
 * leaves a live token behind. "Does this person have an account here, and should we say so
 * on screen" must not be, because a wrong yes is what produced the wall.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { looksLikeSessionCookie, sessionEvidence } from '../src/core/risk.js';

const cookie = (name, extra = {}) => ({
  name,
  value: 'x'.repeat(32),
  httpOnly: true,
  secure: true,
  ...extra
});

test('real auth cookies from real stacks read as strong', () => {
  for (const name of ['sessionid', 'PHPSESSID', '__Secure-1PSID', 'user_session', 'JSESSIONID']) {
    assert.equal(sessionEvidence(cookie(name)), 'strong', name);
  }
});

test('analytics and consent cookies are not evidence of an account', () => {
  // These are the reason the count reached 225. Every one is script-readable by necessity.
  for (const name of ['_ga', '_gid', '_fbp', 'OptanonConsent', 'AWSALB', '__utma']) {
    assert.equal(
      sessionEvidence({ name, value: 'GA1.2.1234567890.1600000000', httpOnly: false, secure: true }),
      'none',
      name
    );
  }
});

test('httpOnly is the discriminator, not the name', () => {
  assert.equal(sessionEvidence(cookie('sessionid', { httpOnly: false })), 'weak');
  assert.equal(sessionEvidence(cookie('sessionid', { httpOnly: true })), 'strong');
});

test('names that say they are not a session are not counted as one', () => {
  // eBay's `nonsession` cookie is httpOnly, Secure and long, and the stem `sess` matches
  // anywhere in a name — so it graded as a real auth token and put ebay.com on the
  // signed-in list of someone who has never had an eBay account.
  for (const name of [
    'nonsession',
    'anon_session',
    'unauth',
    'preauth',
    'no_session',
    'sessionless',
    'logged_out',
    'signed_out',
    'oauth_state',
    'csrftoken',
    'xsrf-token',
    'assessment'
  ]) {
    assert.equal(sessionEvidence(cookie(name)), 'none', name);
  }
});

test('the negation guard does not swallow real auth cookies', () => {
  // Anchored to a separator and required to sit immediately before the stem, so a name
  // that merely starts with those letters is untouched.
  for (const name of ['unified_auth', 'nonce_auth', '__Secure-authjs.session-token']) {
    assert.equal(sessionEvidence(cookie(name)), 'strong', name);
  }
});

test('a short value is not a session token', () => {
  // "1", "en-GB", "true" - preference cookies wearing a plausible name.
  assert.equal(sessionEvidence(cookie('auth', { value: '1' })), 'moderate');
  assert.equal(sessionEvidence({ name: 'auth', value: '1', httpOnly: false, secure: true }), 'none');
});

test('an http-only intranet session still counts as something', () => {
  // Missing Secure is old, not fake. Two of these are enough; one is not.
  assert.equal(sessionEvidence(cookie('JSESSIONID', { secure: false })), 'moderate');
});

test('a missing value is treated as no evidence of length, not as long', () => {
  assert.equal(sessionEvidence({ name: 'sessionid', httpOnly: true, secure: true }), 'moderate');
});

test('the generous heuristic stays generous, because it decides what to destroy', () => {
  // The two questions are separate on purpose. Narrowing this one to match the display
  // rule would start leaving live tokens behind - the exact failure the extension exists
  // to prevent.
  assert.equal(looksLikeSessionCookie('remember_me'), true);
  assert.equal(looksLikeSessionCookie('csrftoken'), true);
  assert.equal(sessionEvidence(cookie('remember_me', { httpOnly: true })), 'weak');
});

// --- the aggregate rule, against a fake cookie jar -----------------------------------

/** @param {any[]} cookies */
function fakeJar(cookies) {
  globalThis.chrome = { cookies: { getAll: async () => cookies } };
}

const jarCookie = (domain, name, extra = {}) => ({
  domain,
  name,
  value: 'x'.repeat(32),
  httpOnly: true,
  secure: true,
  expirationDate: 2000000000,
  ...extra
});

test('a site that only ever set analytics cookies is not signed in', async () => {
  // The 225-site profile, in miniature. Note the missing expiry on the consent cookie:
  // treating any session-scoped cookie as a login is what produced the original count.
  fakeJar([
    jarCookie('.news.example', '_ga', { httpOnly: false, expirationDate: undefined }),
    jarCookie('.news.example', 'OptanonConsent', { httpOnly: false, expirationDate: undefined }),
    jarCookie('.news.example', '_fbp', { httpOnly: false })
  ]);

  const { discoverSessions, likelyLoggedIn } = await import('../src/platform/sessions.js');
  const [site] = await discoverSessions();

  assert.equal(site.signedIn, false, 'nothing here says the user has an account');
  assert.equal(
    likelyLoggedIn([site]).length,
    1,
    'but it is still in scope for a wipe - display and destruction are separate questions'
  );
});

test('one unmistakable auth cookie is enough', async () => {
  fakeJar([
    jarCookie('.app.example', 'sessionid'),
    jarCookie('.app.example', '_ga', { httpOnly: false })
  ]);

  const { discoverSessions } = await import('../src/platform/sessions.js');
  const [site] = await discoverSessions();
  assert.equal(site.signedIn, true);
  assert.equal(site.strongCount, 1);
});

test('two near-misses are enough, one is not', async () => {
  fakeJar([jarCookie('.old.example', 'JSESSIONID', { secure: false })]);
  const { discoverSessions } = await import('../src/platform/sessions.js');

  const [alone] = await discoverSessions();
  assert.equal(alone.signedIn, false, 'a single unverifiable cookie is a guess');

  fakeJar([
    jarCookie('.old.example', 'JSESSIONID', { secure: false }),
    jarCookie('.old.example', 'auth_id', { secure: false })
  ]);
  const [pair] = await discoverSessions();
  assert.equal(pair.signedIn, true);
});

test('a site whose only session-ish cookie is an anonymous one is not signed in', async () => {
  // The eBay case, end to end. `nonsession` is httpOnly, Secure and long — everything a
  // real auth cookie looks like except what it means.
  fakeJar([
    jarCookie('.ebay.com', 'nonsession'),
    jarCookie('.ebay.com', 'dp1'),
    jarCookie('.ebay.com', 's', { httpOnly: false })
  ]);

  const { discoverSessions } = await import('../src/platform/sessions.js');
  const [site] = await discoverSessions();

  assert.equal(site.signedIn, false);
  assert.equal(site.strongCount, 0, 'nothing here is evidence of an account');
});

test('the judgement is re-derived from the jar every time, never remembered', async () => {
  // The bug that outlived the fix above. A permanent record of "domains judged signed in"
  // meant ebay.com stayed listed after the rule that put it there was corrected, because
  // nothing re-checked it. Sites misjudged in that window were all frozen the same way.
  // Deriving the answer fresh is what makes a fix actually reach the user.
  fakeJar([jarCookie('.ebay.com', 'sessionid')]);
  const { discoverSessions } = await import('../src/platform/sessions.js');
  assert.equal((await discoverSessions())[0].signedIn, true);

  fakeJar([jarCookie('.ebay.com', 'nonsession')]);
  assert.equal(
    (await discoverSessions())[0].signedIn,
    false,
    'the previous yes must not survive the evidence for it'
  );
});
