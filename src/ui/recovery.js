/**
 * The recovery workflow.
 *
 * A checklist, in blast-radius order, for the day someone realises an account of theirs
 * is being used by somebody else. Its job is to make a long job finishable: keep the
 * place across restarts, say why each group is where it is, and never lose the thread.
 *
 * Nothing here logs anyone out. That is the point — see the note at the top of the page.
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
        ? 'All done'
        : `${progress.done} of ${progress.total} secured`;

  byId('progress-detail').textContent =
    progress.total === 0
      ? ''
      : progress.nextDomain
        ? `Next: ${progress.nextDomain}. Change its password, then tick it off.`
        : 'Every account on this list has been ticked off. Consider turning on two-factor authentication where you have not already.';

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

  // A shared sign-in means one password change covers several accounts. Saying so stops
  // the user hunting for a password page that does not exist.
  if (step.sharesSignInWith.length) {
    const shared = document.createElement('p');
    shared.textContent = `One password change also covers ${step.sharesSignInWith.join(', ')}.`;
    text.append(shared);
  }
  if (!step.passwordUrl) {
    const hint = document.createElement('p');
    hint.textContent = 'No direct link known — look under account or security settings once the site opens.';
    text.append(hint);
  }

  const controls = document.createElement('div');
  controls.className = 'row-control';

  const open = document.createElement('button');
  open.className = isNext && !isDone ? 'primary small' : 'ghost small';
  open.textContent = step.passwordUrl ? 'Change password' : 'Open site';
  open.addEventListener('click', () => chrome.tabs.create({ url: step.passwordUrl ?? step.siteUrl }));
  controls.append(open);

  if (step.sessionsUrl) {
    const sessions = document.createElement('button');
    sessions.className = 'ghost small';
    sessions.textContent = step.sessionsLabel ?? 'Sessions';
    sessions.title = `Review active sessions on ${step.domain}`;
    sessions.addEventListener('click', () => chrome.tabs.create({ url: step.sessionsUrl }));
    controls.append(sessions);
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
  tickText.textContent = 'Done';
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
