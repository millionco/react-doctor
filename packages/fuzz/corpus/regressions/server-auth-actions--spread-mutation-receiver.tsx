// rule: server-auth-actions
// weakness: copy-tracking
// source: adversarial parity review
// verdict: fail
"use server";

const persist = async (database: typeof db) => database.delete(accounts);

export const deleteAccount = async (databases: Array<typeof db>) => {
  await persist(new FormData());
  await persist(...databases);
};
