/**
 * Tests for spotting a completed federated sign-in.
 *
 * The gap this closes is narrow and worth stating exactly: a site that carries the same
 * cookie name through login — anonymous session and authenticated session alike, changing
 * only the value — produces no new name, so the transition test sees nothing. Federation
 * makes that common, because the round trip leaves the site's own cookie untouched until
 * the callback.
 *
 * The danger is the opposite error. google.com is on the identity-provider list and is
 * also the most-used search engine on earth, so a loose rule would read every search
 * result click as a completed sign-in and refill the list with exactly the false accounts
 * this project has spent six versions removing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { carriesAuthCode, looksLikeAuthStep, signInCompletedFor } from '../src/core/oauth-return.js';

test('an authorization callback is a sign-in on its own', () => {
  assert.equal(
    signInCompletedFor('https://store.epicgames.com/login/callback?code=abc123&state=xyz'),
    'epicgames.com'
  );
});

test('a bare code parameter is not enough', () => {
  // Sites use `code` for discount codes, referral codes and tracking. Only `code` together
  // with `state` is the authorization-code flow.
  assert.equal(carriesAuthCode('https://shop.example/checkout?code=SAVE20'), false);
  assert.equal(signInCompletedFor('https://shop.example/checkout?code=SAVE20'), null);
  assert.equal(carriesAuthCode('https://shop.example/cb?code=a&state=b'), true);
});

test('a search result click is not a sign-in', () => {
  // The trap. google.com is a trusted identity provider AND the search engine everyone
  // arrives from, so "came from google.com" describes a search far more often than a login.
  assert.equal(looksLikeAuthStep('https://www.google.com/search?q=epic+games'), false);
  assert.equal(
    signInCompletedFor('https://store.epicgames.com/', 'https://www.google.com/search?q=epic+games'),
    null
  );
});

test('a return trip from a real authorize endpoint is a sign-in', () => {
  for (const from of [
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=1',
    'https://login.microsoftonline.com/common/oauth2/authorize',
    'https://example.okta.com/oauth2/v1/authorize',
    'https://auth0.com/authorize?x=1'
  ]) {
    assert.equal(looksLikeAuthStep(from), true, from);
    assert.equal(signInCompletedFor('https://store.epicgames.com/', from), 'epicgames.com', from);
  }
});

test('coming back to the provider itself proves nothing', () => {
  // Navigating around Google's own pages is not Google signing you into Google.
  assert.equal(
    signInCompletedFor('https://accounts.google.com/signin', 'https://accounts.google.com/o/oauth2/v2/auth'),
    null
  );
});

test('a site that is not a known provider cannot vouch for another', () => {
  // Otherwise any site could hand the user to any other and manufacture a confirmation.
  assert.equal(looksLikeAuthStep('https://random-blog.example/login'), false);
  assert.equal(signInCompletedFor('https://shop.example/', 'https://random-blog.example/login'), null);
});

test('http is refused throughout', () => {
  assert.equal(looksLikeAuthStep('http://accounts.google.com/o/oauth2/v2/auth'), false);
  assert.equal(signInCompletedFor('http://shop.example/cb?code=a&state=b'), null);
});

test('malformed input is refused rather than throwing', () => {
  assert.equal(signInCompletedFor('not a url'), null);
  assert.equal(signInCompletedFor('https://shop.example/', 'not a url'), null);
  assert.equal(looksLikeAuthStep(null), false);
  assert.equal(carriesAuthCode(''), false);
});

test('the implicit flow is still recognised', () => {
  assert.equal(carriesAuthCode('https://app.example/cb#access_token=abc&token_type=bearer'), true);
  assert.equal(signInCompletedFor('https://app.example/cb#id_token=abc'), 'app.example');
});
