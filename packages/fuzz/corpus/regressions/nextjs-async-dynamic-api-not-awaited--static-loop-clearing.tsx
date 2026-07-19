// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 independent audit

import { cookies } from "next/headers";

export const readSession = async () => {
  let pendingCookies = cookies();
  while (1) {
    pendingCookies = await pendingCookies;
    break;
  }
  return pendingCookies.get("session");
};
