// rule: server-auth-actions
// weakness: control-flow
// source: adversarial parity review
// verdict: fail
"use server";

import { auth } from "@/auth";

const requireSession = async () => auth();

export const deleteAccount = async (shouldAuthenticate: boolean) => {
  if (shouldAuthenticate) await requireSession();
  await db.delete(accounts);
};
