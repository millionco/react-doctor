// rule: server-auth-actions
// weakness: control-flow
// source: adversarial parity review
// verdict: fail
"use server";

import { auth } from "@/auth";
import * as postgres from "@vercel/postgres";

export const deleteAccount = async () => {
  await postgres.sql`/* audit */ DELETE FROM accounts`;
  await auth();
};
