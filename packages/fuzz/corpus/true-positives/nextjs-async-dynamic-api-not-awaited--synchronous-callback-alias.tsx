// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const readSession = async () => {
  let pendingCookies = cookies();
  const readPendingCookies = () => pendingCookies.get("session");
  const readPendingCookiesAlias = readPendingCookies;
  const sessions = [0].map(() => readPendingCookiesAlias());
  pendingCookies = await pendingCookies;
  return sessions[0];
};
