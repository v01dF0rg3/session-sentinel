/**
 * Tests for which sites get shown first.
 *
 * The load-bearing property is that this is a *display* split. A profile has hundreds of
 * cookied domains and only a dozen the user would recognise, so the list has to be
 * narrowed — but narrowing what is shown while the run still covers everything is only
 * honest if the two never get confused. These tests pin the split itself; the run's scope
 * is proven where the plan is built.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareSites, groupByTier, partitionSites, reasonsToShow } from '../src/core/relevance.js';

const site = (domain, tier = 'medium', mode = 'default') => ({ domain, tier, mode });

/** Enough filler to push past the "not worth hiding" threshold. */
const filler = (n, tier = 'low') =>
  Array.from({ length: n }, (_, i) => site(`filler-${String(i).padStart(2, '0')}.example`, tier));

test('a site open in a tab is shown, whatever its tier', () => {
  const reasons = reasonsToShow(site('some-forum.example', 'low'), {
    open: new Set(['some-forum.example'])
  });
  assert.deepEqual(reasons, ['open in a tab now']);
});

test('an unremarkable site with no signals is not shown first', () => {
  assert.deepEqual(reasonsToShow(site('never-visited.example', 'low'), {}), []);
});

test('being signed in is what puts a site on the list', () => {
  assert.deepEqual(reasonsToShow(site('chase.com', 'critical'), {
    signedIn: new Set(['chase.com'])
  }), ['signed in here']);
});

test('a high-value account the user has no account on is not shown', () => {
  // The bug this replaced. aol.com is in the curated critical list, so promoting anything
  // critical put it in front of a user with no AOL account — and it was compensating for
  // a sign-in signal too weak to trust. With a signal that answers the question, the
  // compensation is the bug.
  assert.deepEqual(reasonsToShow(site('aol.com', 'critical'), {}), []);
  assert.deepEqual(reasonsToShow(site('somewhere.example', 'high'), {}), []);
});

test('reasons accumulate, strongest first', () => {
  const reasons = reasonsToShow(site('github.com', 'critical'), {
    signedIn: new Set(['github.com']),
    open: new Set(['github.com']),
    acted: new Set(['github.com'])
  });
  assert.deepEqual(reasons, [
    'signed in here',
    'open in a tab now',
    'you have signed out of this before'
  ]);
});

test('the split hides the long tail and says that it did', () => {
  const sites = [site('github.com', 'critical'), ...filler(20)];
  const { used, other, narrowed } = partitionSites(sites, { open: new Set(['github.com']) });

  assert.deepEqual(used.map((s) => s.domain), ['github.com']);
  assert.equal(other.length, 20);
  assert.equal(narrowed, true);
  assert.equal(used.length + other.length, sites.length, 'nothing is dropped, only moved');
});

test('a split that would hide almost nothing is not made at all', () => {
  // Two extra rows do not justify a disclosure control the user has to find and click.
  const sites = [site('github.com', 'critical'), site('a.example'), site('b.example')];
  const { used, other, narrowed } = partitionSites(sites, { signedIn: new Set(['github.com']) });

  assert.equal(narrowed, false);
  assert.equal(other.length, 0);
  assert.equal(used.length, 3, 'everything stays visible');
});

test('a site the user chose to keep is never buried', () => {
  // They made a decision about it. Hiding that decision where they cannot find it to
  // reverse makes the setting useless.
  const sites = [site('youtube.com', 'low', 'ignored'), ...filler(10)];
  const { used } = partitionSites(sites, {});
  assert.deepEqual(used.map((s) => s.domain), ['youtube.com']);
});

test('sensitivity outranks evidence of use', () => {
  // The same rule the recovery plan follows: a site visited daily is not more dangerous to
  // lose than a bank visited twice a year.
  const sites = [site('chase.com', 'critical'), site('reddit.com', 'medium'), ...filler(5)];
  const { used } = partitionSites(sites, {
    signedIn: new Set(['chase.com', 'reddit.com']),
    open: new Set(['reddit.com']),
    frequent: new Set(['reddit.com'])
  });

  assert.deepEqual(used.map((s) => s.domain), ['chase.com', 'reddit.com']);
});

test('within a tier, the better-evidenced site comes first', () => {
  const strong = { ...site('a-lived-in.example', 'high'), reasons: ['x', 'y'] };
  const weak = { ...site('a-barely-used.example', 'high'), reasons: ['x'] };
  assert.ok(compareSites(strong, weak) < 0);

  // With equal evidence it falls back to alphabetical, which puts them the other way.
  const tied = { ...weak, reasons: ['x', 'y'] };
  assert.ok(compareSites(strong, tied) > 0, 'a-barely-used sorts before a-lived-in');
});

test('grouping keeps tier order and drops empty tiers', () => {
  const groups = groupByTier([
    site('c.example', 'low'),
    site('a.example', 'critical'),
    site('b.example', 'low')
  ]);

  assert.deepEqual(groups.map((g) => g.tier), ['critical', 'low']);
  assert.deepEqual(groups[1].sites.map((s) => s.domain), ['c.example', 'b.example']);
});
