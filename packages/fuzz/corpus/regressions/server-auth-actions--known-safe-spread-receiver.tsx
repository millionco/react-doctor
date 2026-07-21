// rule: server-auth-actions
// weakness: copy-tracking
// source: adversarial parity review
// verdict: pass
"use server";

const normalize = async (values: FormData) => values.set("name", "Ada");

export const normalizeRequest = async () => {
  await normalize(...[new FormData()]);
};
