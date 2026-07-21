// rule: server-auth-actions
// weakness: binding-provenance
// source: adversarial parity review
// verdict: fail
"use server";

import * as postgres from "@vercel/postgres";

export const deleteAccount = async (accountId: string) => {
  await postgres.sql`DELETE FROM accounts WHERE id = ${accountId}`;
};
