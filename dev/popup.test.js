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
  await until(() => !get('home-scope').textContent.startsWith('Finding') || !get('status').hidden);
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
  const scroller = get('panel-accounts');
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const win = frame.contentWindow;
    if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || box.width <= 0 || box.height <= 0) return false;
    if (box.left < 0 || box.top < 0 || box.right > win.innerWidth || box.bottom > win.innerHeight) return false;
    for (let parent = element.parentElement; parent && !element.closest('dialog[open]'); parent = parent.parentElement) {
      if (!['auto', 'scroll', 'hidden', 'clip'].includes(win.getComputedStyle(parent).overflowY)) continue;
      const bounds = parent.getBoundingClientRect();
      if (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) return false;
    }
    return true;
  };
  const view = (name) => get(`tab-${name}`).click();
  const category = (name) => doc.querySelector(`[data-category="${name}"]`).click();
  return { doc, get, api, button, runs, pages, scroller, visible, view, category };
}

try {
  const f = await fixture();
  f.view('accounts');
  const dialog = f.get('signout-dialog');
  const github = f.button('github.com');
  github.scrollIntoView({ block: 'center' });
  github.focus({ preventScroll: true });
  const previousScroll = f.scroller.scrollTop;
  check(previousScroll > 0, 'Reproduce an account action below the top of the account list');
  github.click();
  check(dialog.open && dialog.matches(':modal') && f.runs().length === 0, 'Opening the confirmation is modal and does not start cleanup');
  check(f.get('signout-domain').textContent === 'github.com', 'The selected site is named, not the current-tab site');
  check(f.doc.activeElement === f.get('signout-title'), 'Initial keyboard focus is a non-action heading');
  check(f.visible(dialog) && ['signout-title', 'signout-pending', 'signout-warning', 'signout-recovery', 'signout-sessions', 'signout-confirm', 'signout-cancel']
    .every((id) => f.visible(f.get(id))), 'Warning and all choices fit in the narrower 360px popup without scrolling');
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
  check(!dialog.open && f.visible(f.get('status')) && f.get('status').textContent.includes('Attempting sign-out of github.com'), 'Busy feedback is immediately visible above every tab after confirmation');
  check([...f.doc.querySelectorAll('[data-signout-domain]')].every((button) => button.disabled), 'Account sign-out buttons are disabled while the action runs');
  await until(() => !f.get('logout-current').disabled);
  check(f.visible(f.get('status')) && f.get('status').textContent.includes('Sign-out attempted'), 'The compact result remains visible when the user stays with the action');
  check(f.get('panel-activity').hidden && !f.get('run-evidence').open, 'Finishing does not automatically expose the verbose activity report');
  check(f.visible(f.get('open-recovery')) && f.visible(f.get('open-options')), 'Results retain the recovery and settings controls');

  f.button('chase.com').click();
  check(dialog.open && f.get('signout-sessions').hidden && f.get('signout-domain').textContent === 'chase.com', 'A site without a known sessions page does not inherit the previous link');
  f.get('signout-cancel').click();
  f.view('home');
  f.get('logout-current').click();
  check(!dialog.open && f.runs().at(-1).domain === 'youtube.com', 'Default high-risk prompt policy still lets a low-risk action start directly');
  await until(() => !f.get('logout-current').disabled);

  // Use only the public fake message API; its settings object is the preview overview's.
  await f.api.runtime.sendMessage({ type: 'updateSettings', patch: { compromisePrompt: 'always' } });
  f.get('logout-current').click();
  check(dialog.open && f.get('signout-domain').textContent === 'youtube.com', 'Always-prompt policy also applies to the current-site button');
  f.get('signout-cancel').click();
  await f.api.runtime.sendMessage({ type: 'updateSettings', patch: { compromisePrompt: 'never' } });
  f.view('accounts');
  f.button('github.com').click();
  check(!dialog.open && f.runs().at(-1).domain === 'github.com', 'Never-prompt preference is preserved for high-risk sites');
  await until(() => !f.get('logout-current').disabled);

  f.button('github.com').click();
  const filter = f.get('site-filter');
  filter.value = 'slack';
  filter.dispatchEvent(new Event('input'));
  filter.focus();
  const filteredScroll = f.scroller.scrollTop;
  check(f.button('slack.com').disabled, 'Filtering during a run does not re-enable account actions');
  await until(() => !f.get('logout-current').disabled);
  check(f.doc.activeElement === filter && f.scroller.scrollTop === filteredScroll, 'Completion preserves focus and the filtered view’s scroll position');

  const errors = await fixture();
  errors.view('accounts');
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
  compact.view('accounts');
  frame.style.height = '400px';
  compact.button('github.com').click();
  check(compact.visible(compact.get('signout-dialog')) && ['signout-recovery', 'signout-sessions', 'signout-confirm', 'signout-cancel']
    .every((id) => compact.visible(compact.get(id))), 'Confirmation choices also fit in a short 400px viewport');
  compact.get('signout-details').open = true;
  check(compact.visible(compact.get('signout-cancel')) && compact.visible(compact.get('signout-confirm')), 'Short viewport keeps actions visible even with the full advice expanded');
  compact.get('signout-cancel').click();
  frame.style.height = '560px';

  const home = await fixture();
  check(home.doc.body.dataset.view === 'home' && home.get('panel-accounts').hidden && home.get('panel-activity').hidden, 'Every fresh popup starts with Home; account lists and logs stay behind tabs');
  check(home.get('panel-home').scrollHeight <= home.get('panel-home').clientHeight + 1, `The default Home screen needs no scrolling (${home.get('panel-home').scrollHeight}/${home.get('panel-home').clientHeight}px)`);
  check(home.doc.body.getBoundingClientRect().width === 360 && home.doc.body.getBoundingClientRect().height === 484, 'Home is a compact 360 × 484 layout');
  check(home.get('logout-all-label').textContent === 'Sign out of all confirmed accounts' && home.get('logout-current').textContent === 'Sign out site', 'The visible action labels distinguish all confirmed accounts from the current site');
  check(!home.get('logout-all').hasAttribute('aria-label') && home.get('logout-all').getAttribute('aria-describedby').includes('home-action-note') && home.get('home-action-note').textContent.includes('Tries site sign-out'), 'The accessible bulk action name matches the visible label and retains its attempt-only explanation');
  check(home.get('logout-all').scrollWidth <= home.get('logout-all').clientWidth && home.visible(home.get('logout-all-label')), 'The explicit all-account label fits the compact button without clipping');
  check(home.visible(home.doc.querySelector('.home-limit')) && home.visible(home.get('logout-current')), 'The brief security limit and single-site action remain visible');
  check(!home.get('current-options').open && !home.visible(home.get('clear-current')), 'Keep, priority, and local-data clearing start behind Site options');
  check(home.get('activity-preview').dataset.attention === 'true' && !home.get('activity-dot').hidden, 'A prior failed run is still signposted without showing its full report');
  home.get('tab-home').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  check(home.doc.body.dataset.view === 'accounts' && home.doc.activeElement === home.get('tab-accounts') && home.get('tab-home').tabIndex === -1, 'Arrow keys switch tabs with roving keyboard focus');
  home.get('tab-accounts').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  check(home.doc.body.dataset.view === 'activity', 'End selects the final tab');
  home.get('tab-activity').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  check(home.doc.body.dataset.view === 'home', 'Home returns to the first tab');
  home.view('accounts');
  home.category('candidates');
  check(home.get('site-list').textContent.includes('bloomberg.com') && !home.button('bloomberg.com'), 'Candidates offer Login, never a confirmed-account sign-out control');
  home.get('site-list').querySelector('button').click();
  check(home.get('status').classList.contains('busy'), 'Login shows immediate animated opening feedback');
  await until(() => !home.get('status').classList.contains('busy'));
  check(home.get('count-confirmed').textContent === '5' && home.runs().length === 0, 'Opening Login does not promote a candidate or dispatch cleanup');
  home.category('other');
  check(home.get('site-list').textContent.includes('netflix.com') && home.get('account-help').textContent.includes('not confirmed accounts'), 'Other cookied sites include kept non-accounts with an explicit evidence caveat');
  home.scroller.scrollTop = 150;
  const savedScroll = home.scroller.scrollTop;
  home.view('activity');
  home.view('accounts');
  check(home.scroller.scrollTop === savedScroll, 'Switching tabs restores the account list scroll position');
  home.category('confirmed');
  home.get('site-filter').value = 'bloomberg';
  home.get('site-filter').dispatchEvent(new Event('input'));
  check(!home.get('site-list').textContent.includes('bloomberg.com'), 'Searching Confirmed never relabels a visitor-cookie candidate as an account');
  home.view('home');
  home.get('logout-all').click();
  check(home.runs().at(-1).type === 'runNow' && home.doc.body.dataset.working === 'true', 'The primary action still dispatches the confirmed-only command and starts working animation');
  await until(() => home.doc.body.dataset.working === 'false');
  check(home.get('logout-all-label').textContent === 'Sign out of all confirmed accounts', 'The all-account scope remains explicit after an action finishes');
  check(!home.get('status').classList.contains('green'), 'Completion does not use an all-safe green result');
  home.get('status-view').click();
  check(home.doc.body.dataset.view === 'activity' && home.get('run-evidence').open && home.get('revoke-guidance').textContent.includes('Open'), 'Details opens the full evidence and provider-owned next steps on Activity');
  home.get('status-dismiss').click();
  check(home.get('status').hidden && !home.get('run-evidence').hidden, 'Dismissing feedback never discards the underlying evidence');

  const large = await fixture('?popup=large');
  large.view('accounts');
  check(large.get('count-candidates').textContent === '35' && large.get('count-other').textContent === '173', 'Large account inventories show separate candidate and visitor-site counts');
  check(large.get('list-actions').scrollWidth <= large.get('list-actions').clientWidth, 'Three-digit counts fit without horizontal overflow');
  large.category('other');
  large.scroller.scrollTop = large.scroller.scrollHeight;
  check(large.visible(large.get('open-recovery')) && large.visible(large.get('open-options')), 'Recovery and Settings remain reachable with hundreds of discovered sites');

  const ready = await fixture('?automation=ready');
  ready.get('toggle-enabled').click();
  await until(() => ready.get('enabled-label').textContent === 'Cleanup paused');
  check(ready.doc.body.dataset.working === 'false' && ready.get('status').textContent.includes('paused') && ready.get('logout-current').disabled && ready.get('clear-current').disabled, 'Pausing cleanup gives feedback and disables manual cleanup as the engine requires');
  ready.get('toggle-enabled').click();
  await until(() => ready.get('enabled-label').textContent === 'Automation on');
  check(ready.runs().length === 0, 'Resuming configured automation does not dispatch immediate sign-out');

  for (const theme of ['light', 'dark']) {
    const themed = await fixture(`?theme=${theme}&motion=reduce`);
    const win = frame.contentWindow;
    check(win.getComputedStyle(themed.doc.querySelector('.art-spark')).animationName === 'none', `${theme}: reduced motion disables decorative animation`);
    themed.get('logout-all').click();
    check(win.getComputedStyle(themed.doc.querySelector('.status-orbit')).animationName === 'none' && themed.get('status').classList.contains('busy'), `${theme}: reduced motion keeps truthful working text without a spinning loader`);
    await until(() => themed.doc.body.dataset.working === 'false');
    check(themed.visible(themed.get('status')) && themed.visible(themed.get('open-recovery')), `${theme}: completion and recovery controls remain in view`);
  }

  const active = await fixture('?run=active');
  check(active.doc.body.dataset.working === 'true' && active.get('logout-all').disabled, 'Reopening during an existing run shows live work, not a fresh ready state');
  await until(() => active.doc.body.dataset.working === 'false');
  check(active.get('status-text').textContent.includes('attention'), 'Read-only polling stops the animation when the real worker response says the run ended');

  const empty = await fixture('?popup=empty');
  check(empty.get('logout-all').disabled && empty.get('current-site').hidden && !empty.get('no-current').hidden, 'No-account/non-website state disables bulk cleanup and offers a clear starting point');
  empty.view('activity');
  check(!empty.get('activity-empty').hidden && empty.get('run-evidence').hidden, 'A new installation has an honest empty Activity view');
  empty.get('toggle-enabled').click();
  await until(() => empty.pages.length === 1);
  check(empty.pages[0] === '/dev/welcome-preview.html' && empty.runs().length === 0, 'Set up automation opens onboarding rather than silently enabling cleanup');

  const kept = await fixture('?popup=kept');
  check(kept.get('logout-all').disabled && kept.get('home-scope').textContent.includes('Keep'), 'All-kept accounts disable bulk cleanup without making a false no-account claim');

  const long = await fixture('?popup=long');
  check(long.get('current-domain').scrollWidth <= long.get('current-domain').clientWidth + 1 && long.visible(long.get('logout-current')), 'Long current-site names wrap without hiding the single-site action');
  long.get('current-options').open = true;
  await until(() => long.visible(long.get('clear-current')));
  check(long.visible(long.get('open-recovery')), 'Expanding Site options reveals its controls while preserving the recovery route');

  const unavailable = await fixture('?popup=error');
  check(unavailable.get('logout-all').disabled && unavailable.doc.body.dataset.working === 'false' && unavailable.get('nav-account-count').textContent === '—', 'An unreadable overview is unavailable, not a zero-account or endless-working claim');
  check(unavailable.visible(unavailable.get('status')) && unavailable.visible(unavailable.get('open-options')), 'Read errors and Settings stay visible in the compact failure state');
  const homeDialog = await fixture('?popup=github');
  frame.style.height = '484px';
  homeDialog.get('logout-current').click();
  check(['signout-warning', 'signout-recovery', 'signout-sessions', 'signout-confirm', 'signout-cancel'].every((id) => homeDialog.visible(homeDialog.get(id))), 'The full confirmation remains usable from the smaller 484px Home viewport');
  homeDialog.get('signout-cancel').click();
  frame.style.height = '560px';
  await fixture('?automation=ready');
} catch (error) {
  check(false, error instanceof Error ? error.message : String(error));
}
summary.textContent = `${passed} passed, ${failed} failed. Fictional accounts only; installed-extension behavior is not proved by this fixture.`;
document.title = `${passed} passed, ${failed} failed — Popup confirmation tests`;
