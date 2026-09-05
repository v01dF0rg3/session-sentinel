/** Presentation only. These views never authorize cleanup or infer a login from cookies. */
export function accountGroups(sites = [], relevance = {}) {
  const confirmed = new Set(relevance?.confirmed ?? []);
  const candidates = new Set(relevance?.questions ?? []);
  const groups = { confirmed: [], candidates: [], other: [] };
  for (const site of sites) {
    if (confirmed.has(site.domain)) groups.confirmed.push(site);
    else if (site.mode !== 'ignored' && (candidates.has(site.domain) || site.needsConfirmation)) groups.candidates.push(site);
    else groups.other.push(site);
  }
  return groups;
}

export function compactResult(report, running = false) {
  if (running) return { title: 'Cleanup in progress', detail: 'Waiting for the browser. You can review Activity.', tone: 'busy' };
  if (!report) return { title: 'No activity yet', detail: 'Your next cleanup will appear here.', tone: 'neutral' };
  if (report.status === 'running' || report.pending?.length) return { title: 'Cleanup was interrupted', detail: 'Some work is unfinished. Review Activity.', tone: 'red' };
  const sites = report.sites ?? [];
  const failed = sites.filter((site) => site.outcome === 'failed' || site.localCleanup?.status === 'incomplete').length;
  if (failed) return { title: `${failed} site${failed === 1 ? ' needs' : 's need'} attention`, detail: 'Some cleanup could not be completed or verified.', tone: 'red' };
  if (!sites.length) return { title: 'No sites processed', detail: 'Review Activity for the scope and any skipped sites.', tone: 'neutral' };
  const attempted = sites.some((site) => ['logoutAttempted', 'loggedOut', 'revoked'].includes(site.outcome) || site.serverAction === 'attempted');
  if (!attempted && sites.some((site) => site.outcome !== 'cleared')) return { title: 'Review the cleanup result', detail: 'This result could not be fully interpreted. Open Activity.', tone: 'amber' };
  return {
    title: attempted ? 'Sign-out attempted' : 'Local cleanup finished',
    detail: 'Other sessions or stolen tokens may still work.',
    tone: 'amber'
  };
}

export function automationState(settings = {}) {
  if (!settings.onboarded) return { label: 'Set up automation', state: 'setup', hint: 'Automatic cleanup is off until setup is complete.' };
  if (!settings.enabled) return { label: 'Cleanup paused', state: 'paused', hint: 'Resume manual and automatic cleanup.' };
  const configured = ['onIdle', 'onLock', 'onBrowserClose'].some((key) => settings[key]?.enabled);
  return configured
    ? { label: 'Automation on', state: 'on', hint: 'Pause cleanup, including manual actions. This indicator is not a guarantee of account security.' }
    : { label: 'Automation off', state: 'off', hint: 'Open Settings to choose an automatic cleanup trigger.' };
}

/** Native buttons, roving tab focus, and separate scroll positions for each panel. */
export function createPopupTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((tab) => root.querySelector(`#${tab.getAttribute('aria-controls')}`));
  const scroll = new Map();
  let index = 0;
  function select(name, focusTab = false) {
    const next = tabs.findIndex((tab) => tab.dataset.view === name);
    if (next < 0) return;
    scroll.set(index, panels[index].scrollTop);
    index = next;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    panels[index].scrollTop = scroll.get(index) ?? 0;
    root.dataset.view = name;
    if (focusTab) tabs[index].focus({ preventScroll: true });
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab.dataset.view));
    tab.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      select(tabs[next].dataset.view, true);
    });
  });
  select('home');
  return { select };
}
