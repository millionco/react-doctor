// rule: server-auth-actions
// weakness: control-flow
// source: adversarial parity review
// verdict: pass
"use server";

const removeAccount = async () => db.delete(accounts);

export const previewDeletion = async () => {
  if (false) await removeAccount();
  return { ready: true };
};
