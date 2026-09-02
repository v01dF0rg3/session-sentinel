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

import {
  compareSites,
  confirmedAccountDomains,
  contextFor,
  groupByTier,
  partitionSites,
  reasonsToShow
} from '../src/core/relevance.js';

const site = (domain, tier = 'medium', mode = 'default') => ({ domain, tier, mode });

/** Enough filler to push past the "not worth hiding" threshold. */
const filler = (n, tier = 'low') =>
  Array.from({ length: n }, (_, i) => site(`filler-${String(i).padStart(2, '0')}.example`, tier));

test('being open in a tab does not put a site on the list', () => {
  // The counterexample that forced this. Sitting on ebay.com's sign-in page — not signed
  // in, no account, form unfilled — put ebay.com on a list headed SIGNED IN.
  assert.deepEqual(reasonsToShow(site('ebay.com', 'high'), { open: new Set(['ebay.com']) }), []);
  assert.deepEqual(contextFor(site('ebay.com', 'high'), { open: new Set(['ebay.com']) }), [
    'open in a tab now'
  ]);
});

test('having tried to clear a site before is not account evidence', () => {
  // A full run acts on every plausible session-bearing site, including Bloomberg and eBay
  // false positives. Treating the action as proof would cache the original guess forever.
  assert.deepEqual(reasonsToShow(site('bloomberg.com', 'low'), {
    acted: new Set(['bloomberg.com'])
  }), []);
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

test('account evidence and ordering context stay separate', () => {
  const signals = {
    signedIn: new Set(['github.com']),
    open: new Set(['github.com'])
  };
  assert.deepEqual(reasonsToShow(site('github.com', 'critical'), signals), ['signed in here']);
  assert.deepEqual(contextFor(site('github.com', 'critical'), signals), ['open in a tab now']);
});

test('the split hides the long tail and says that it did', () => {
  const sites = [site('github.com', 'critical'), ...filler(20)];
  const { used, questions, other, narrowed } = partitionSites(sites, { signedIn: new Set(['github.com']) });

  assert.deepEqual(used.map((s) => s.domain), ['github.com']);
  assert.equal(questions.length, 0);
  assert.equal(other.length, 20);
  assert.equal(narrowed, true);
  assert.equal(used.length + other.length, sites.length, 'nothing is dropped, only moved');
});

test('even a small unknown set is not merged into Signed in', () => {
  // A layout shortcut must not turn an unconfirmed cookie into an authentication claim.
  const sites = [site('github.com', 'critical'), site('a.example'), site('b.example')];
  const { used, other, narrowed } = partitionSites(sites, { signedIn: new Set(['github.com']) });

  assert.equal(narrowed, true);
  assert.equal(other.length, 2);
  assert.deepEqual(used.map((s) => s.domain), ['github.com']);
});

test('unanswered candidates form a review queue, not the confirmed list', () => {
  const sites = [site('github.com', 'high'), site('bloomberg.com', 'high'), ...filler(3)];
  const { used, questions, other } = partitionSites(sites, {
    signedIn: new Set(['github.com']),
    unconfirmed: new Set(['bloomberg.com']),
    frequent: new Set(['bloomberg.com'])
  });

  assert.deepEqual(used.map((s) => s.domain), ['github.com']);
  assert.deepEqual(questions.map((s) => s.domain), ['bloomberg.com']);
  assert.equal(questions[0].needsConfirmation, true);
  assert.equal(other.length, 3);
});

test('the anonymous-cookie safeguard is domain-agnostic and frequency cannot bypass it', () => {
  const candidates = [
    site('bloomberg.com', 'high'),
    site('shop-with-guest-session.example', 'critical'),
    site('news-with-anon-id.example', 'low')
  ];
  const everyDomain = candidates.map((candidate) => candidate.domain);
  const signals = {
    unconfirmed: new Set(everyDomain),
    frequent: new Set(everyDomain),
    open: new Set(everyDomain)
  };

  const { used, questions } = partitionSites(candidates, signals);
  assert.deepEqual(used, [], 'no unknown domain is promoted, even when open and frequent');
  assert.deepEqual(questions.map((candidate) => candidate.domain).sort(), [...everyDomain].sort());
  assert.deepEqual(confirmedAccountDomains(candidates, signals), []);
});

test('a site the user chose to keep is never buried', () => {
  // They made a decision about it. Hiding that decision where they cannot find it to
  // reverse makes the setting useless.
  const sites = [site('youtube.com', 'low', 'ignored'), ...filler(10)];
  const { used, configured } = partitionSites(sites, {});
  assert.equal(used.length, 0, 'configuration alone is not authentication evidence');
  assert.deepEqual(configured.map((s) => s.domain), ['youtube.com']);
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

test('within a tier, usage context orders confirmed accounts', () => {
  const strong = { ...site('a-lived-in.example', 'high'), reasons: ['signed in'], context: ['frequent'] };
  const weak = { ...site('a-barely-used.example', 'high'), reasons: ['signed in'], context: [] };
  assert.ok(compareSites(strong, weak) < 0);

  // With equal context it falls back to alphabetical, which puts them the other way.
  const tied = { ...weak, context: ['frequent'] };
  assert.ok(compareSites(strong, tied) > 0, 'a-barely-used sorts before a-lived-in');
});

test('recovery receives confirmed accounts only', () => {
  const sites = [site('github.com'), site('bloomberg.com'), site('ebay.com')];
  const signals = {
    signedIn: new Set(['github.com']),
    unconfirmed: new Set(['bloomberg.com']),
    frequent: new Set(['bloomberg.com', 'ebay.com']),
    open: new Set(['ebay.com'])
  };

  assert.deepEqual(confirmedAccountDomains(sites, signals), ['github.com']);
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
