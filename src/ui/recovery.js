/**
 * The recovery workflow.
 *
 * A checklist, in blast-radius order, for the day someone realises an account of theirs
 * is being used by somebody else. Its job is to make a long job finishable: keep the
 * place across restarts, say why each group is where it is, and never lose the thread.
 *
 * Nothing here changes an account automatically. It links to provider-owned security
 * controls and keeps progress; see the clean-device warning at the top of the page.
 */

/** @type {any} */
let data = null;

/**
 * @param {any} message
 * @returns {Promise<any>}
 */
function send(message) {
  return chrome.runtime.sendMessage(message);
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node;
}

async function load() {
  data = await send({ type: 'getRecovery' });
  render();
  void discoverPasswordPages();
}

/**
 * Fill in the password pages nobody wrote down for us.
 *
 * Password settings are useful when credentials may be exposed, but providers vary on
 * whether a password change closes existing sessions. This discovery adds a destination;
 * it never treats the link—or a visit to it—as proof of revocation.
 *
 * It runs after the first render, deliberately. The plan is readable immediately and the
 * links sharpen a moment later; making someone stare at a spinner during a break-in would
 * be a poor trade for a slightly tidier load.
 */
async function discoverPasswordPages() {
  const missing = data.groups
    .flatMap((/** @type {any} */ g) => g.steps)
    .filter((/** @type {any} */ s) => !s.passwordUrl)
    .map((/** @type {any} */ s) => s.domain);

  if (!missing.length) return;

  const found = await send({ type: 'findPasswordPages', domains: missing });
  if (!found || !Object.keys(found).length) return;

  for (const group of data.groups) {
    for (const step of group.steps) {
      if (!step.passwordUrl && found[step.domain]) {
        step.passwordUrl = found[step.domain];
        step.passwordUrlSource = 'discovered';
      }
    }
  }
  render();
}

function render() {
  const { groups, state, progress } = data;

  /** @type {HTMLSelectElement} */ (byId('scope')).value = state.minTier;

  const container = byId('groups');
  container.replaceChildren();
  byId('empty').hidden = progress.total > 0;

  byId('progress-headline').textContent =
    progress.total === 0
      ? 'Nothing to do'
      : progress.done === progress.total
        ? 'Checklist reviewed'
        : `${progress.done} of ${progress.total} reviewed`;

  byId('progress-detail').textContent =
    progress.total === 0
      ? ''
      : progress.nextDomain
        ? `Next: ${progress.nextDomain}. Review its sessions and security settings, then tick it off.`
        : 'Every account on this list has been reviewed. Recheck important session lists and security alerts for anything unfamiliar.';

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  /** @type {HTMLElement} */ (byId('progress-bar')).style.width = `${pct}%`;

  for (const group of groups) {
    container.append(renderGroup(group, new Set(state.done), progress.nextDomain));
  }
}

/**
 * @param {any} group
 * @param {Set<string>} done
 * @param {string | null} nextDomain
 * @returns {HTMLElement}
 */
function renderGroup(group, done, nextDomain) {
  const section = document.createElement('section');
  section.className = 'card';

  const heading = document.createElement('h2');
  heading.textContent = group.label;
  heading.style.marginBottom = '4px';

  const why = document.createElement('p');
  why.className = 'muted';
  why.style.marginBottom = '12px';
  why.textContent = group.why;

  section.append(heading, why);

  for (const step of group.steps) {
    section.append(renderStep(step, done.has(step.domain), step.domain === nextDomain));
  }
  return section;
}

/**
 * @param {any} step
 * @param {boolean} isDone
 * @param {boolean} isNext
 * @returns {HTMLElement}
 */
function renderStep(step, isDone, isNext) {
  const row = document.createElement('div');
  row.className = 'row step' + (isDone ? ' step-done' : '') + (isNext ? ' step-next' : '');

  const text = document.createElement('div');
  text.className = 'row-text';

  const name = document.createElement('h3');
  name.textContent = step.domain;

  const badge = document.createElement('span');
  badge.className = `badge ${step.tier}`;
  badge.textContent = step.tier;
  badge.style.marginLeft = '8px';
  name.append(badge);

  if (step.frequent) {
    const often = document.createElement('span');
    often.className = 'badge frequent';
    often.textContent = 'you use this often';
    often.style.marginLeft = '6px';
    name.append(often);
  }

  text.append(name);

  // A shared identity means one provider may control access to several products. It does
  // not mean a password change is guaranteed to revoke every product session.
  if (step.sharesSignInWith.length) {
    const shared = document.createElement('p');
    shared.textContent = `This sign-in may also control ${step.sharesSignInWith.join(', ')}. Verify those sessions after securing the identity provider.`;
    text.append(shared);
  }
  // Included on the strength of session-looking cookies alone. Saying so is what makes
  // including it honest: the row is worth a glance during a breach, and worth skipping if
  // the account was never yours.
  if (step.unverified) {
    const note = document.createElement('p');
    note.textContent = 'Not confirmed as your account — listed in case it is. Skip it if not.';
    text.append(note);
  }

  if (!step.sessionsUrl) {
    const hint = document.createElement('p');
    hint.textContent = 'No direct session list is known — open security settings and look for Devices, Sessions, Login activity, or Sign out everywhere.';
    text.append(hint);
  }

  if (step.passwordUrlSource === 'discovered') {
    // Say where the link came from. It was found by asking the site, not checked by hand,
    // and a link that lands somewhere unexpected is less alarming when it was not promised
    // to be exact.
    const hint = document.createElement('p');
    hint.textContent = 'Link found by asking the site directly.';
    text.append(hint);
  }

  const controls = document.createElement('div');
  controls.className = 'row-control';

  if (step.sessionsUrl) {
    const sessions = document.createElement('button');
    sessions.className = isNext && !isDone ? 'primary small' : 'ghost small';
    sessions.textContent = 'Review sessions';
    sessions.title = `Review active sessions on ${step.domain}`;
    sessions.addEventListener('click', () => chrome.tabs.create({ url: step.sessionsUrl }));
    controls.append(sessions);
  }

  const securityTarget = step.passwordUrl ?? step.siteUrl;
  if (!step.sessionsUrl || securityTarget !== step.sessionsUrl) {
    const open = document.createElement('button');
    open.className = !step.sessionsUrl && isNext && !isDone ? 'primary small' : 'ghost small';
    open.textContent = step.passwordUrl ? 'Password settings' : 'Open security settings';
    open.title = step.passwordUrl
      ? 'Change the password if it may be exposed; still review active sessions separately'
      : `Open ${step.domain} and find its account security controls`;
    open.addEventListener('click', () => chrome.tabs.create({ url: securityTarget }));
    controls.append(open);
  }

  const tick = document.createElement('label');
  tick.className = 'keep';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = isDone;
  box.addEventListener('change', async () => {
    await send({ type: 'markRecoveryStep', domain: step.domain, done: box.checked });
    await load();
  });
  const tickText = document.createElement('span');
  tickText.textContent = 'Reviewed';
  tick.append(box, tickText);
  controls.append(tick);

  row.append(text, controls);
  return row;
}

byId('scope').addEventListener('change', async (e) => {
  await send({ type: 'setRecoveryScope', minTier: /** @type {HTMLSelectElement} */ (e.target).value });
  await load();
});

byId('reset').addEventListener('click', async () => {
  await send({ type: 'resetRecovery' });
  await load();
});

load();
