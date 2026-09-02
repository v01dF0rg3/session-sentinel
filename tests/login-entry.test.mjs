import { test } from 'node:test';
import assert from 'node:assert/strict';

import { activateLoginControl } from '../src/engine/login-entry.js';

function element({ text = '', href = '', visible = true, click = () => {} } = {}) {
  const attributes = { 'aria-label': '', href, target: '' };
  return {
    innerText: text,
    textContent: text,
    getAttribute(name) {
      return attributes[name] ?? '';
    },
    setAttribute(name, value) { attributes[name] = value; },
    getBoundingClientRect: () => ({ width: visible ? 80 : 0, height: visible ? 24 : 0 }),
    click
  };
}

function page(elements) {
  globalThis.document = { querySelectorAll: () => elements };
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block', opacity: '1' });
}

test('a visible Sign in link sends the user to the site chosen destination', () => {
  let clicks = 0;
  page([element({ text: 'Sign in', href: '/account/signin?next=%2F', click: () => { clicks += 1; } })]);
  assert.deepEqual(activateLoginControl(), { activated: true, kind: 'link' });
  assert.equal(clicks, 1);
});

test('a login button is clicked when navigation belongs to page code', () => {
  let clicks = 0;
  page([element({ text: 'Log in', click: () => { clicks += 1; } })]);
  assert.deepEqual(activateLoginControl(), { activated: true, kind: 'button' });
  assert.equal(clicks, 1);
});

test('hidden controls and unrelated account prose are not activated', () => {
  page([
    element({ text: 'Sign in', href: '/login', visible: false }),
    element({ text: 'How to sign in safely', href: '/help/sign-in' }),
    element({ text: 'Create account', href: '/register' })
  ]);
  assert.deepEqual(activateLoginControl(), { activated: false });
});
