// rule: server-auth-actions
// weakness: control-flow
// source: adversarial parity review
// verdict: pass
"use server";

export const previewDeletion = async () => {
  false && (() => db.delete(accounts))();
  return { ready: true };
};
