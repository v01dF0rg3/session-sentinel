/**
 * Tests for the signed recipe bundle.
 *
 * These sign real payloads with a real ephemeral keypair and then attack them, rather
 * than asserting against fixtures. The update channel is the most dangerous surface in
 * the extension — it is the one place where someone else's bytes get to influence what a
 * security tool does — so "it looked right" is not good enough.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BUNDLE_BYTES,
  mergeRecipes,
  validateBundle,
  verifyBundle
} from '../src/core/bundle.js';

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' };

const toBase64 = (buffer) => Buffer.from(buffer).toString('base64');

async function makeSigner() {
  const pair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
  const publicKey = toBase64(await crypto.subtle.exportKey('spki', pair.publicKey));

  /** @param {object} payloadObject */
  async function sign(payloadObject) {
    const payload = JSON.stringify(payloadObject);
    const signature = await crypto.subtle.sign(
      SIGN_PARAMS,
      pair.privateKey,
      new TextEncoder().encode(payload)
    );
    return JSON.stringify({ payload, signature: toBase64(signature) });
  }

  return { publicKey, sign };
}

const recipe = (domain) => ({
  domain,
  capability: 'global',
  steps: [
    { op: 'navigate', url: `https://${domain}/settings/sessions` },
    { op: 'clickText', selector: 'button', text: 'sign out of all' }
  ]
});

const payload = (version, recipes) => ({
  version,
  generatedAt: '2026-08-30T00:00:00Z',
  recipes
});

test('a correctly signed bundle verifies', async () => {
  const { publicKey, sign } = await makeSigner();
  const raw = await sign(payload(2, [recipe('example.com')]));

  const result = await verifyBundle(raw, publicKey);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.payload.version, 2);
  assert.equal(result.payload.recipes.length, 1);
});

test('a tampered payload is rejected', async () => {
  const { publicKey, sign } = await makeSigner();
  const raw = await sign(payload(2, [recipe('example.com')]));

  // Swap the destination for an attacker's while keeping the original signature.
  const envelope = JSON.parse(raw);
  envelope.payload = envelope.payload.replace('example.com/settings', 'attacker.test/settings');

  const result = await verifyBundle(JSON.stringify(envelope), publicKey);
  assert.equal(result.ok, false);
  assert.match(result.error, /signature does not match/);
});

test('a tampered signature is rejected', async () => {
  const { publicKey, sign } = await makeSigner();
  const envelope = JSON.parse(await sign(payload(1, [recipe('example.com')])));

  const bytes = Buffer.from(envelope.signature, 'base64');
  bytes[0] ^= 0xff;
  envelope.signature = bytes.toString('base64');

  const result = await verifyBundle(JSON.stringify(envelope), publicKey);
  assert.equal(result.ok, false);
});

test('a bundle signed by the wrong key is rejected', async () => {
  const mine = await makeSigner();
  const attacker = await makeSigner();

  // Perfectly well-formed, correctly signed — by the wrong person.
  const raw = await attacker.sign(payload(99, [recipe('example.com')]));

  const result = await verifyBundle(raw, mine.publicKey);
  assert.equal(result.ok, false);
  assert.match(result.error, /signature does not match/);
});

test('oversized and malformed bundles are refused before parsing', async () => {
  const { publicKey } = await makeSigner();

  const huge = 'x'.repeat(MAX_BUNDLE_BYTES + 1);
  assert.match((await verifyBundle(huge, publicKey)).error, /exceeds/);

  assert.match((await verifyBundle('not json', publicKey)).error, /not valid JSON/);
  assert.match((await verifyBundle('', publicKey)).error, /empty/);
  assert.match((await verifyBundle('{"payload":"x"}', publicKey)).error, /malformed/);
  assert.match((await verifyBundle('{"payload":1,"signature":2}', publicKey)).error, /malformed/);
});

test('a garbage signature reads as unverified rather than throwing', async () => {
  const { publicKey, sign } = await makeSigner();
  const envelope = JSON.parse(await sign(payload(1, [])));
  envelope.signature = 'not-base64-!!!';

  const result = await verifyBundle(JSON.stringify(envelope), publicKey);
  assert.equal(result.ok, false, 'must fail closed, not raise');
  assert.ok(result.error);
});

test('rolling back to an older signed bundle is refused', () => {
  // The replay attack: an old bundle carries a genuine signature forever, so version
  // must be enforced separately from authorship.
  const old = payload(3, [recipe('example.com')]);
  const result = validateBundle(old, 7);

  assert.equal(result.ok, false);
  assert.match(result.error, /roll back from version 7 to 3/);
});

test('the same version reinstalls cleanly and a newer one is accepted', () => {
  assert.equal(validateBundle(payload(5, [recipe('a.com')]), 5).ok, true);
  assert.equal(validateBundle(payload(6, [recipe('a.com')]), 5).ok, true);
});

test('signed bundles still cannot smuggle an off-site navigation', () => {
  // The key property: a signature proves authorship, not correctness. Even a bundle from
  // the legitimate signer is re-checked against the navigation trust policy, so a
  // compromised signing key still cannot point the engine at an attacker's page.
  const hostile = {
    domain: 'example.com',
    capability: 'global',
    steps: [
      { op: 'navigate', url: 'https://attacker.test/harvest' },
      { op: 'clickText', selector: 'button', text: 'confirm' }
    ]
  };

  const result = validateBundle(payload(1, [hostile, recipe('good.com')]), 0);
  assert.equal(result.ok, true);
  assert.equal(result.recipes.length, 1, 'the hostile recipe must be dropped');
  assert.equal(result.recipes[0].domain, 'good.com');
  assert.equal(result.rejected, 1);
});

test('malformed payloads are rejected', () => {
  assert.equal(validateBundle(null, 0).ok, false);
  assert.equal(validateBundle({ version: 'x', recipes: [] }, 0).ok, false);
  assert.equal(validateBundle({ version: 0, recipes: [] }, 0).ok, false);
  assert.equal(validateBundle({ version: 1 }, 0).ok, false);
  assert.match(validateBundle({ version: 1, recipes: new Array(2001).fill(recipe('a.com')) }, 0).error, /more than/);
});

test('remote recipes override built-ins per domain, and gaps fall back', () => {
  const builtin = [recipe('github.com'), recipe('slack.com')];
  const remote = [{ ...recipe('github.com'), capability: 'local' }, recipe('newsite.com')];

  const merged = mergeRecipes(builtin, remote);
  const byDomain = Object.fromEntries(merged.map((r) => [r.domain, r]));

  assert.equal(merged.length, 3);
  assert.equal(byDomain['github.com'].capability, 'local', 'remote wins');
  assert.ok(byDomain['slack.com'], 'a built-in with no remote counterpart survives');
  assert.ok(byDomain['newsite.com'], 'a remote-only recipe is added');
});
