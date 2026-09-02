/**
 * Tests for coverage measurement.
 *
 * Four sites have a hand-written recipe; 218 rely on a generic fallback nobody has
 * measured. The number this produces is meant to decide where recipes get written, so it
 * has to mean what it says — a rate that quietly counts sites the extension never tried
 * would send that effort to the wrong places.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeCoverage, summariseCoverage } from '../src/core/coverage.js';

const entry = (domain, outcome, method, attempted = true, at = 1) => ({
  domain,
  outcome,
  method,
  attempted,
  at,
  runs: 1
});

test('the reach rate counts only sites where a logout was attempted', () => {
  // A site below the tier threshold was never tried. Counting it as a miss would blame
  // the fallback for a decision the planner made, and make the number meaningless.
  const summary = summariseCoverage([
    entry('a.com', 'logoutAttempted', 'path'),
    entry('b.com', 'cleared', 'none'),
    entry('c.com', 'cleared', 'none', false) // never attempted
  ]);

  assert.equal(summary.total, 3, 'all sites are still counted as seen');
  assert.equal(summary.attempted, 2);
  assert.equal(summary.logoutReached, 1);
  assert.equal(summary.verifiedRevoked, 0);
  assert.equal(summary.clearedOnly, 1);
  assert.equal(summary.reachRate, 50, 'one of two attempts, not one of three sites');
});

test('sites where nothing worked are the ones named', () => {
  const summary = summariseCoverage([
    entry('worked.com', 'logoutAttempted', 'home'),
    entry('failed-a.com', 'cleared', 'none', true, 10),
    entry('failed-b.com', 'cleared', 'none', true, 20),
    entry('never-tried.com', 'cleared', 'none', false)
  ]);

  assert.deepEqual(
    summary.needsRecipe.map((e) => e.domain),
    ['failed-b.com', 'failed-a.com'],
    'most recent first, and only attempted sites'
  );
});

test('a revoked result is counted separately from an unverified attempt', () => {
  const summary = summariseCoverage([entry('a.com', 'revoked', 'recipe')]);
  assert.equal(summary.logoutReached, 1);
  assert.equal(summary.verifiedRevoked, 1);
  assert.equal(summary.reachRate, 100);
});

test('failures are counted apart from misses', () => {
  // "The wipe itself failed" is a different problem from "the sign-out was not found",
  // and folding them together would hide one behind the other.
  const summary = summariseCoverage([
    entry('a.com', 'failed', 'none'),
    entry('b.com', 'logoutAttempted', 'recipe')
  ]);

  assert.equal(summary.failed, 1);
  assert.equal(summary.attempted, 1, 'a failed wipe is not an attempt that missed');
  assert.equal(summary.reachRate, 100);
  assert.equal(summary.needsRecipe.length, 0);
});

test('which tier did the work is counted, so the fallback can be judged', () => {
  const summary = summariseCoverage([
    entry('a.com', 'logoutAttempted', 'recipe'),
    entry('b.com', 'logoutAttempted', 'path'),
    entry('c.com', 'logoutAttempted', 'path'),
    entry('d.com', 'logoutAttempted', 'home'),
    entry('e.com', 'cleared', 'none')
  ]);

  assert.deepEqual(summary.byMethod, { recipe: 1, path: 2, home: 1, none: 1 });
});

test('nothing measured yet says so rather than showing a fake rate', () => {
  const empty = summariseCoverage([]);
  assert.equal(empty.reachRate, null);
  assert.equal(describeCoverage(empty), null);

  const untried = summariseCoverage([entry('a.com', 'cleared', 'none', false)]);
  assert.equal(untried.reachRate, null);
  assert.match(describeCoverage(untried), /nothing to measure/);
});

test('the summary sentence states the real proportion', () => {
  const summary = summariseCoverage([
    entry('a.com', 'logoutAttempted', 'path'),
    entry('b.com', 'logoutAttempted', 'home'),
    entry('c.com', 'cleared', 'none')
  ]);
  const description = describeCoverage(summary);
  assert.match(description, /2 of 3 attempts reached a site sign-out route or control \(67%\)/);
  assert.match(description, /does not prove a copied token was invalidated/i);
  assert.match(description, /None had separately verified revoke-everywhere behavior/);
});

test('legacy loggedOut records are treated as attempts, not verified revocations', () => {
  const summary = summariseCoverage([entry('old.example', 'loggedOut', 'path')]);
  assert.equal(summary.logoutReached, 1);
  assert.equal(summary.verifiedRevoked, 0);
  assert.equal(summary.reachRate, 100);
});
