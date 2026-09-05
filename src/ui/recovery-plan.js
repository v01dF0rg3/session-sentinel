import {
  RECOVERY_BASELINE, RECOVERY_DEVICE_NOTE, RECOVERY_HANDOFF_NOTE,
  RECOVERY_LIMIT_NOTE, RECOVERY_STEPS
} from '../../data/recovery-checklist.js';
import { recoveryHandoffText } from '../core/recovery-handoff.js';

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

/** Fixed guidance renders even if the background worker cannot supply any accounts. */
export function renderRecoveryEssentials(container) {
  const baseline = element('section', '', 'card recovery-essentials');
  baseline.append(
    element('h2', 'Always check these accounts'),
    element('p', 'Include accounts missing from the browser list. Start with email and sign-in accounts.', 'muted')
  );
  const list = element('ul', '', 'baseline-grid');
  for (const item of RECOVERY_BASELINE) {
    const row = element('li');
    row.append(element('h3', item.title), element('p', item.detail, 'muted'));
    list.append(row);
  }
  baseline.append(list);

  const steps = element('section', '', 'card recovery-essentials');
  steps.append(element('h2', 'For each account'));
  const ordered = element('ol', '', 'recovery-instructions');
  for (const item of RECOVERY_STEPS) {
    const row = element('li');
    row.append(element('strong', item.title), element('p', item.detail, 'muted'));
    ordered.append(row);
  }
  steps.append(ordered, element('p', RECOVERY_LIMIT_NOTE, 'muted'));
  container.replaceChildren(baseline, steps);
}

/** @param {HTMLElement} container @param {import('../core/recovery-handoff.js').RecoveryHandoff | null} plan */
export function renderPrintablePlan(container, plan) {
  const header = element('header');
  header.append(element('h1', 'Session Sentinel — recovery plan'));
  header.append(element('p', plan ? `Created: ${new Date(plan.generatedAt).toISOString()}` : 'Account list unavailable — use the essential checklist below.'));
  header.append(element('p', RECOVERY_DEVICE_NOTE, 'note'));
  const essentials = element('div');
  renderRecoveryEssentials(essentials);
  const accounts = element('section', '', 'print-accounts');
  accounts.append(element('h2', `Confirmed account domains${plan ? ` (${plan.accounts.length})` : ''} — all risk levels`));
  accounts.append(element('p', 'Confirmation means browser login evidence was found. This is not a live check of access.', 'muted'));
  if (plan?.accounts.length) {
    const table = element('table', '', 'recovery-print-table');
    const thead = element('thead');
    const headings = element('tr');
    for (const title of ['Reviewed', 'Website', 'Risk', 'Evidence']) {
      const cell = element('th', title);
      cell.scope = 'col';
      headings.append(cell);
    }
    thead.append(headings);
    const tbody = element('tbody');
    for (const account of plan.accounts) {
      const row = element('tr');
      for (const value of ['[ ]', account.domain, account.tier, account.evidence]) row.append(element('td', value));
      tbody.append(row);
    }
    table.append(thead, tbody);
    accounts.append(table);
  } else {
    accounts.append(element('p', plan ? 'No confirmed account domains were available. Start with the checklist above.' : 'The browser account list could not be loaded. Check your important accounts independently.'));
  }
  if (plan?.excludedCount) accounts.append(element('p', `${plan.excludedCount} confirmed entries were omitted because their domain or risk was invalid.`));
  const footer = element('footer', '', 'print-plan-footer');
  footer.append(
    element('p', RECOVERY_HANDOFF_NOTE),
    element('p', 'Review every login you use on each service; several accounts can share one domain.'),
    element('p', 'Keep this list private. No passwords, cookies, tokens or account usernames are included.')
  );
  container.replaceChildren(header, essentials, accounts, footer);
}

/** @param {import('../core/recovery-handoff.js').RecoveryHandoff} plan */
export function saveRecoveryText(plan) {
  const blob = new Blob([recoveryHandoffText(plan)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `session-sentinel-recovery-${new Date(plan.generatedAt).toISOString().slice(0, 10)}.txt`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser time to begin the download before releasing the in-memory file.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
