// rule: server-auth-actions
// weakness: helper-reachability
// source: 0.8.1-to-main all-rules parity review
// verdict: fail
"use server";

const mutate = async (database: typeof db) => database.delete(accounts);

export const deleteAccount = async () => mutate(db);
