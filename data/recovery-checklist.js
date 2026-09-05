/**
 * Fixed recovery guidance, independent of what the browser detected.
 * Used by the screen, printed plan, and text export so each has the same essentials.
 * Provider instructions take precedence over this general checklist. In particular,
 * Google revokes app passwords on a password change; that is not a universal rule.
 * Sources checked 4 September 2026:
 * https://support.google.com/accounts/answer/6294825
 * https://support.google.com/accounts/answer/185833
 */

export const RECOVERY_DEVICE_NOTE =
  'If malware may be on this computer, use another trusted phone or computer for recovery. Do not enter new passwords or view or generate backup codes on the affected device.';

export const RECOVERY_LIMIT_NOTE =
  'A password change does not guarantee every session is closed. Follow each provider\'s recovery instructions and check its session list again. Ticking a checklist records your review; it does not verify revocation.';

export const RECOVERY_BASELINE = [
  { id: 'email', title: 'Main email', detail: 'The mailbox that receives password resets. Check forwarding rules and mail delegation too.' },
  { id: 'identity', title: 'Google, Microsoft or Apple sign-in', detail: 'These accounts may control access to several services and synced devices.' },
  { id: 'password-manager', title: 'Password manager', detail: 'Review trusted devices and follow its instructions if your vault may have been exposed.' },
  { id: 'money', title: 'Banking and payments', detail: 'Check transactions. Contact the provider promptly if money may be at risk.' },
  { id: 'work', title: 'Work and administrator accounts', detail: 'Include cloud, code and website accounts. Tell your IT team if work access was affected.' },
  { id: 'communication', title: 'Social, messaging and gaming', detail: 'Check for impersonation, purchases and changes to account ownership.' }
];

export const RECOVERY_STEPS = [
  { id: 'sessions', title: 'Review sessions and devices', detail: 'Remove unfamiliar sessions. Use sign out everywhere if offered. Follow the provider\'s hacked-account recovery flow promptly if someone still has access.' },
  { id: 'access', title: 'Remove unfamiliar ways back in', detail: 'Review connected apps, app passwords, recovery email and phone, and two-step sign-in methods. Remove access you did not authorize; session sign-out may not remove it.' },
  { id: 'password', title: 'Replace exposed passwords', detail: 'Change an exposed or reused password from your trusted device. Use a unique password, and follow the provider\'s instructions if they specify a different order.' },
  { id: 'verify', title: 'Check recovery methods and recheck access', detail: 'Enable strong two-step sign-in. Replace exposed backup codes only on a trusted device. Recheck sessions and security alerts for unfamiliar changes.' }
];

export const RECOVERY_HANDOFF_NOTE =
  'This plan can be incomplete or altered on a compromised computer. Always check the important accounts above, including accounts missing below. Open services using their official app or a bookmark you trust; do not treat an unfamiliar domain in this list as a trusted destination.';
