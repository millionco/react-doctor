// rule: server-auth-actions
// weakness: name-heuristic
// source: adversarial parity review
// verdict: fail
"use server";

export const registerWebhook = async (endpoint: string) => {
  await db.insert(webhooks).values({ endpoint });
};
