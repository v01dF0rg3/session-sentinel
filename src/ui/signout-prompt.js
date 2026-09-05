/**
 * A site action waits for an explicit choice. Opening/dismissing never dispatches it.
 * @param {HTMLDialogElement} dialog
 * @param {{ onConfirm: (domain: string) => unknown, onRecovery: () => unknown,
 *   onSessions: (url: string, domain: string) => unknown }} callbacks
 */
export function createSignoutPrompt(dialog, { onConfirm, onRecovery, onSessions }) {
  const title = dialog.querySelector('#signout-title');
  const domainLabel = dialog.querySelector('#signout-domain');
  const explanation = dialog.querySelector('#signout-explanation');
  const adviceText = dialog.querySelector('#signout-advice');
  const details = dialog.querySelector('#signout-details');
  const body = dialog.querySelector('.signout-dialog-body');
  const sessions = dialog.querySelector('#signout-sessions');
  let pending = null;

  // Consume the choice synchronously, before any async work or another click. Native
  // showModal makes the background inert; close restores the initiating control's focus.
  function takeChoice() {
    if (!pending || !dialog.open) return null;
    const choice = pending;
    pending = null;
    dialog.close();
    choice.opener?.focus({ preventScroll: true });
    return choice;
  }

  dialog.querySelector('#signout-confirm').addEventListener('click', () => {
    const choice = takeChoice();
    if (choice) onConfirm(choice.domain);
  });
  dialog.querySelector('#signout-recovery').addEventListener('click', () => {
    if (takeChoice()) onRecovery();
  });
  sessions.addEventListener('click', () => {
    if (!pending?.sessionsUrl) return;
    const choice = takeChoice();
    if (choice) onSessions(choice.sessionsUrl, choice.domain);
  });
  dialog.querySelector('#signout-cancel').addEventListener('click', takeChoice);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    takeChoice();
  });

  return {
    show(domain, advice, opener) {
      if (dialog.open) return;
      pending = { domain, sessionsUrl: advice.sessionsUrl, opener };
      domainLabel.textContent = domain;
      explanation.textContent = advice.explanation;
      adviceText.textContent = advice.advice;
      sessions.hidden = !advice.sessionsUrl;
      sessions.title = advice.sessionsUrl
        ? `Open ${advice.sessionsLabel ?? 'session settings'} for ${domain}; use only on a trusted device`
        : '';
      details.open = false;
      dialog.showModal();
      body.scrollTop = 0;
      // Start on a non-action heading: Enter must not accidentally authorize sign-out.
      title.focus({ preventScroll: true });
    }
  };
}
