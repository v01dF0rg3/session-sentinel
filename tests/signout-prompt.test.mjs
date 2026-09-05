import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSignoutPrompt } from '../src/ui/signout-prompt.js';
import { compromiseAdviceFor } from '../src/core/session-pages.js';

// These fakes test dispatch and state, not browser layout/focus behavior. The real
// popup and native modal are exercised separately in dev/popup.test.html.
function fixture() {
  let focused = null;
  class Element extends EventTarget {
    textContent = '';
    hidden = false;
    open = false;
    scrollTop = 0;
    focus(options) { focused = { element: this, options }; }
    click() { this.dispatchEvent(new Event('click')); }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const elements = new Map();
  const dialog = new Element();
  dialog.querySelector = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const calls = [];
  const prompt = createSignoutPrompt(dialog, {
    onConfirm: (domain) => calls.push(['confirm', domain]),
    onRecovery: () => calls.push(['recovery']),
    onSessions: (url, domain) => calls.push(['sessions', url, domain])
  });
  const opener = new Element();
  const show = (domain = 'github.com') => prompt.show(domain, compromiseAdviceFor(domain), opener);
  return { dialog, prompt, calls, opener, show, get: (selector) => dialog.querySelector(selector), focused: () => focused };
}

test('showing a site prompt does not act and focuses a non-action heading', () => {
  const f = fixture();
  f.show();
  assert.equal(f.dialog.open, true);
  assert.deepEqual(f.calls, []);
  assert.equal(f.get('#signout-domain').textContent, 'github.com');
  assert.equal(f.focused().element, f.get('#signout-title'));
  assert.deepEqual(f.focused().options, { preventScroll: true });
  assert.equal(f.get('#signout-advice').textContent, compromiseAdviceFor('github.com').advice);
});

for (const method of ['button', 'escape']) {
  test(`${method} cancellation restores the opener without dispatching sign-out`, () => {
    const f = fixture();
    f.show();
    if (method === 'button') f.get('#signout-cancel').click();
    else {
      const event = new Event('cancel', { cancelable: true });
      f.dialog.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    }
    assert.equal(f.dialog.open, false);
    assert.equal(f.focused().element, f.opener);
    f.get('#signout-confirm').click();
    assert.deepEqual(f.calls, []);
  });
}

test('confirmation consumes the exact domain once before starting work', () => {
  const f = fixture();
  f.show();
  f.get('#signout-confirm').click();
  f.get('#signout-confirm').click();
  f.get('#signout-recovery').click();
  assert.deepEqual(f.calls, [['confirm', 'github.com']]);
  assert.equal(f.dialog.open, false);
});

test('recovery opens only recovery, never the sign-out action', () => {
  const f = fixture();
  f.show();
  f.get('#signout-recovery').click();
  f.get('#signout-confirm').click();
  assert.deepEqual(f.calls, [['recovery']]);
});

test('session review uses that site’s known page without sign-out', () => {
  const f = fixture();
  f.show();
  f.get('#signout-sessions').click();
  f.get('#signout-confirm').click();
  assert.deepEqual(f.calls, [['sessions', 'https://github.com/settings/sessions', 'github.com']]);
});

test('unknown session pages are hidden and cannot dispatch a stale URL', () => {
  const f = fixture();
  f.show();
  f.get('#signout-cancel').click();
  f.show('unknown.example');
  assert.equal(f.get('#signout-sessions').hidden, true);
  assert.equal(f.get('#signout-sessions').title, '');
  f.get('#signout-sessions').click();
  assert.deepEqual(f.calls, []);
  assert.equal(f.dialog.open, true);
});

test('a new prompt resets expanded advice and scroll and uses the new site', () => {
  const f = fixture();
  f.show();
  f.get('#signout-details').open = true;
  f.get('.signout-dialog-body').scrollTop = 300;
  f.get('#signout-cancel').click();
  f.show('google.com');
  assert.equal(f.get('#signout-details').open, false);
  assert.equal(f.get('.signout-dialog-body').scrollTop, 0);
  assert.equal(f.get('#signout-explanation').textContent, compromiseAdviceFor('google.com').explanation);
  f.get('#signout-confirm').click();
  assert.deepEqual(f.calls, [['confirm', 'google.com']]);
});

test('an already-open prompt cannot be silently retargeted to another account', () => {
  const f = fixture();
  f.show();
  f.show('google.com');
  assert.equal(f.get('#signout-domain').textContent, 'github.com');
  f.get('#signout-confirm').click();
  assert.deepEqual(f.calls, [['confirm', 'github.com']]);
});

test('buttons in a closed dialog cannot authorize a pending action', () => {
  const f = fixture();
  f.show();
  f.dialog.close();
  f.get('#signout-confirm').click();
  assert.deepEqual(f.calls, []);
});
