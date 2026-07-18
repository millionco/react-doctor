// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 independent audit

import { cookies } from "next/headers";

export const readSession = async () => {
  let pendingCookies = cookies();
  const readPendingCookies = () => pendingCookies.get("session");
  const sessions = [0].map(readPendingCookies);
  pendingCookies = await pendingCookies;
  return sessions;
};
