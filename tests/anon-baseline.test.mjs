/**
 * Tests for telling an authenticated session from an anonymous one.
 *
 * Three earlier rules tried to read authentication out of a cookie's name and flags, and
 * each one fixed the reported site while staying wrong. The data that settled it:
 * bloomberg.com hands a stranger `_session_id_backup` — httpOnly, Secure, 36-char opaque
 * value — before anyone signs in. It is a real session cookie belonging to nobody.
 *
 * So the fixtures here are measured, not invented. Every cookie set below was taken from an
 * actual credentials-omitted fetch of the site.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { baselineFrom, judgeSignIn } from '../src/core/anon-baseline.js';

// Measured 1 September 2026, fetched with no cookies.
const BLOOMBERG = baselineFrom(['_pxhd', 'session_id', '_session_id_backup', 'agent_id', 'session_key']);
const GITHUB = baselineFrom(['_gh_sess', '_octo', 'logged_in']);

test('a site whose session cookies are handed to strangers is not an account', () => {
  // The whole reason this file exists. Every session-looking cookie bloomberg.com sets is
  // one you get for showing up, so a jar containing exactly those proves nothing.
  const verdict = judgeSignIn(['_session_id_backup', 'session_id', 'session_key'], BLOOMBERG);
  assert.equal(verdict, 'anonymous');
});

test('cookies a stranger never receives are what an account looks like', () => {
  // A signed-in GitHub user has the stranger's three plus their own.
  const verdict = judgeSignIn(['_gh_sess', 'user_session', 'dotcom_user'], GITHUB);
  assert.equal(verdict, 'signedIn');
});

test('with nothing ruled out, the answer is unknown rather than yes', () => {
  // Guessing "signed in" from an unexamined session cookie is exactly what put
  // bloomberg.com on a list headed SIGNED IN.
  assert.equal(judgeSignIn(['_session_id_backup'], null), 'unknown');
  assert.equal(judgeSignIn(['_session_id_backup'], { anonymous: [], usable: false }), 'unknown');
});

test('no session-looking cookies at all is a plain no, not an unknown', () => {
  assert.equal(judgeSignIn([], null), 'anonymous');
});

test('what was already there the first time counts as anonymous too', () => {
  // A homepage fetch does not see every cookie a site sets across a whole visit - eBay's
  // `nonsession` arrives deeper than the front page. Anything present before we could have
  // watched a sign-in predates it and proves nothing.
  const verdict = judgeSignIn(['nonsession', 'dp1'], null, ['nonsession', 'dp1']);
  assert.equal(verdict, 'anonymous');
});

test('a new cookie appearing after first sight is a sign-in', () => {
  const verdict = judgeSignIn(['nonsession', 'dp1', 'ebay_session'], null, ['nonsession', 'dp1']);
  assert.equal(verdict, 'signedIn');
});

test('the two sources of doubt combine rather than override each other', () => {
  // The probe missed a cookie; first sight caught it. Neither alone is enough.
  const partial = baselineFrom(['_gh_sess']);
  assert.equal(judgeSignIn(['_gh_sess', '_octo'], partial), 'signedIn', 'probe alone is fooled');
  assert.equal(judgeSignIn(['_gh_sess', '_octo'], partial, ['_octo']), 'anonymous');
});

test('an empty probe result is not mistaken for a site that sets no cookies', () => {
  // A failed fetch and a genuinely cookie-free site look identical from here, so neither
  // is allowed to confirm anything.
  const failed = baselineFrom([]);
  assert.equal(failed.usable, false);
  assert.equal(judgeSignIn(['session_token'], failed), 'unknown');
});
