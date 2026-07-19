// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const readSession = async () => {
  let pendingCookies = cookies();
  const session = (() => pendingCookies.get("session"))();
  pendingCookies = await pendingCookies;
  return session;
};
