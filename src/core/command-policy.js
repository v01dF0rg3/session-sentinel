const UI_PAGES = new Set(['popup.html', 'options.html', 'welcome.html', 'recovery.html', 'diagnostics.html']);
const ACCOUNT_ACTIONS = new Set(['runNow', 'runSite', 'clearSite', 'openLogin']);

/** Same extension ID is not sufficient: content scripts also carry that ID. */
export function isTrustedUiSender(sender, extensionId) {
  if (!extensionId || sender?.id !== extensionId || typeof sender.url !== 'string') return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.host === extensionId &&
      !url.username && !url.password && url.pathname.startsWith('/src/ui/') &&
      UI_PAGES.has(url.pathname.slice('/src/ui/'.length));
  } catch { return false; }
}

/** Spanning-mode worker operates the normal profile; do not imply private cleanup. */
export function isUnsupportedPrivateAction(message, sender) {
  return ACCOUNT_ACTIONS.has(message?.type) &&
    (message.incognitoContext === true || sender?.tab?.incognito === true);
}
