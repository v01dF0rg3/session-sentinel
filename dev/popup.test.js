// Browser-only integration checks against the generated popup and fake chrome.*.
const frame = document.getElementById('popup');
const results = document.getElementById('results');
const summary = document.getElementById('summary');
let passed = 0;
let failed = 0;

function check(ok, label) {
  const row = document.createElement('li');
  row.className = ok ? 'pass' : 'fail';
  row.textContent = `${ok ? 'PASS' : 'FAIL'}: ${label}`;
  results.append(row);
  ok ? passed++ : failed++;
}

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for popup state');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function fixture(query = '') {
  await new Promise((resolve) => {
    frame.onload = resolve;
    frame.src = `popup-preview.html${query}`;
  });
  const doc = frame.contentDocument;
  const get = (id) => doc.getElementById(id);
  await until(() => get('site-count').textContent === '5 confirmed');
  const messages = [];
  const pages = [];
  const api = frame.contentWindow.chrome;
  const send = api.runtime.sendMessage;
  api.runtime.sendMessage = (message) => {
    messages.push(message);
    return send(message);
  };
  api.tabs.create = async ({ url }) => { pages.push(url); return { id: 1234 }; };
  const button = (domain) => [...doc.querySelectorAll('[data-signout-domain]')]
    .find((el) => el.dataset.signoutDomain === domain);
  const runs = () => messages.filter((message) => ['runSite', 'runNow', 'clearSite'].includes(message.type));
  const scroller = doc.querySelector('.popup-content');
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const win = frame.contentWindow;
    return !element.hidden && box.width > 0 && box.height > 0 &&
      box.left >= 0 && box.top >= 0 && box.right <= win.innerWidth && box.bottom <= win.innerHeight;
  };
  return { doc, get, api, button, runs, pages, scroller, visible };
}

try {
  const f = await fixture();
  const dialog = f.get('signout-dialog');
  const github = f.button('github.com');
  f.get('run-evidence').open = true;
  github.scrollIntoView({ block: 'center' });
  github.focus({ preventScroll: true });
  const previousScroll = f.scroller.scrollTop;
  check(previousScroll > 100, 'Reproduce an account action well below the top of the popup');
  github.click();
  check(dialog.open && dialog.matches(':modal') && f.runs().length === 0, 'Opening the confirmation is modal and does not start cleanup');
  check(f.get('signout-domain').textContent === 'github.com', 'The selected site is named, not the current-tab site');
  check(f.doc.activeElement === f.get('signout-title'), 'Initial keyboard focus is a non-action heading');
  check(f.visible(dialog) && ['signout-title', 'signout-pending', 'signout-warning', 'signout-recovery', 'signout-sessions', 'signout-confirm', 'signout-cancel']
    .every((id) => f.visible(f.get(id))), 'Warning and all choices fit in the 380 × 584 popup without scrolling');
  f.get('logout-all').focus();
  check(dialog.contains(f.doc.activeElement), 'Native modal prevents focus from escaping to background cleanup controls');
  f.get('signout-details').open = true;
  check(['signout-recovery', 'signout-sessions', 'signout-confirm', 'signout-cancel'].every((id) => f.visible(f.get(id))), 'Expanded recovery advice never pushes the choices outside the popup');
  f.get('signout-cancel').click();
  check(!dialog.open && f.doc.activeElement === github && f.scroller.scrollTop === previousScroll && f.runs().length === 0, 'Cancel restores the originating account and scroll position without cleanup');
  github.click();
  check(!f.get('signout-details').open && f.doc.querySelector('.signout-dialog-body').scrollTop === 0, 'Reopening starts at the concise advice, not the previous scroll position');
  // A trusted Escape key is checked manually as well; here exercise its native cancel handler.
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  check(!dialog.open && f.doc.activeElement === github && f.runs().length === 0, 'Escape/cancel handling never authorizes a sign-out');
  github.click();
  f.get('signout-sessions').click();
  await until(() => !f.get('status').hidden);
  check(f.pages[0] === 'https://github.com/settings/sessions' && f.runs().length === 0, 'Session review opens only the selected provider page, without cleanup');
  github.click();
  f.get('signout-recovery').click();
  await until(() => f.get('status').textContent.includes('Opened the recovery checklist'));
  check(f.pages[1] === '/dev/recovery-preview.html' && f.runs().length === 0, 'Recovery opens only the checklist, without cleanup');
  github.click();
  f.get('signout-confirm').click();
  f.get('signout-confirm').click();
  check(f.runs().length === 1 && f.runs()[0].type === 'runSite' && f.runs()[0].domain === 'github.com', 'Repeated confirmation dispatches exactly one action for the selected domain');
  check(!dialog.open && f.scroller.scrollTop === 0 && f.visible(f.get('status')) && f.get('status').textContent.includes('Attempting sign-out of github.com'), 'Busy feedback is immediately visible after confirmation');
  check([...f.doc.querySelectorAll('[data-signout-domain]')].every((button) => button.disabled), 'Account sign-out buttons are disabled while the action runs');
  await until(() => !f.get('logout-current').disabled);
  check(f.scroller.scrollTop === 0 && f.visible(f.get('status')) && f.get('status').textContent.includes('site sign-out attempted'), 'The result remains visible when the user stays with the action');
  check(f.visible(f.get('open-recovery')) && f.visible(f.get('open-options')), 'Expanded results retain the recovery and settings footer');

  f.button('chase.com').click();
  check(dialog.open && f.get('signout-sessions').hidden && f.get('signout-domain').textContent === 'chase.com', 'A site without a known sessions page does not inherit the previous link');
  f.get('signout-cancel').click();
  f.get('logout-current').click();
  check(!dialog.open && f.runs().at(-1).domain === 'youtube.com', 'Default high-risk prompt policy still lets a low-risk action start directly');
  await until(() => !f.get('logout-current').disabled);

  // Use only the public fake message API; its settings object is the preview overview's.
  await f.api.runtime.sendMessage({ type: 'updateSettings', patch: { compromisePrompt: 'always' } });
  f.get('logout-current').click();
  check(dialog.open && f.get('signout-domain').textContent === 'youtube.com', 'Always-prompt policy also applies to the current-site button');
  f.get('signout-cancel').click();
  await f.api.runtime.sendMessage({ type: 'updateSettings', patch: { compromisePrompt: 'never' } });
  f.button('github.com').click();
  check(!dialog.open && f.runs().at(-1).domain === 'github.com', 'Never-prompt preference is preserved for high-risk sites');
  await until(() => !f.get('logout-current').disabled);

  f.button('github.com').click();
  const filter = f.get('site-filter');
  filter.value = 'slack';
  filter.dispatchEvent(new Event('input'));
  filter.focus();
  check(f.button('slack.com').disabled, 'Filtering during a run does not re-enable account actions');
  await until(() => !f.get('logout-current').disabled);
  check(f.doc.activeElement === filter && f.scroller.scrollTop > 0, 'Completion does not steal focus or jump to the top after the user moves to the filter');

  const errors = await fixture();
  errors.api.tabs.create = async () => { throw new Error('fixture page failure'); };
  errors.button('github.com').click();
  errors.get('signout-recovery').click();
  await until(() => errors.get('status').textContent.includes('fixture page failure'));
  check(errors.visible(errors.get('status')) && errors.runs().length === 0, 'A recovery-page failure is visible and does not fall through to sign-out');
  const fakeSend = errors.api.runtime.sendMessage;
  errors.api.runtime.sendMessage = (message) => {
    if (message.type === 'runSite') return Promise.reject(new Error('fixture sign-out failure'));
    return fakeSend(message);
  };
  errors.button('github.com').click();
  errors.get('signout-confirm').click();
  await until(() => !errors.get('logout-current').disabled);
  check(errors.visible(errors.get('status')) && errors.get('status').textContent.includes('fixture sign-out failure'), 'A failed action stays visible and releases the busy state');
  errors.api.runtime.sendMessage = (message) => {
    if (message.type === 'getOverview') return Promise.reject(new Error('fixture refresh failure'));
    return fakeSend(message);
  };
  errors.button('github.com').click();
  errors.get('signout-confirm').click();
  await until(() => !errors.get('logout-current').disabled);
  check(errors.visible(errors.get('status')) && errors.get('status').textContent.includes('Reopen the popup'), 'A refresh failure releases the busy state and explains how to inspect the result');

  const compact = await fixture();
  frame.style.height = '400px';
  compact.button('github.com').click();
  check(compact.visible(compact.get('signout-dialog')) && ['signout-recovery', 'signout-sessions', 'signout-confirm', 'signout-cancel']
    .every((id) => compact.visible(compact.get(id))), 'Confirmation choices also fit in a short 400px viewport');
  compact.get('signout-details').open = true;
  check(compact.visible(compact.get('signout-cancel')) && compact.visible(compact.get('signout-confirm')), 'Short viewport keeps actions visible even with the full advice expanded');
  compact.get('signout-cancel').click();
  frame.style.height = '584px';
  compact.button('github.com').click();
} catch (error) {
  check(false, error instanceof Error ? error.message : String(error));
}
summary.textContent = `${passed} passed, ${failed} failed. Fictional accounts only; installed-extension behavior is not proved by this fixture.`;
document.title = `${passed} passed, ${failed} failed — Popup confirmation tests`;
