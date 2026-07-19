// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 independent audit

import { cookies } from "next/headers";

export const readSession = async (shouldCall: boolean) => {
  let pendingCookies = cookies();
  const readPendingCookies = () => pendingCookies.get("session");
  let readAlias = readPendingCookies;
  if (shouldCall) {
    readAlias = () => null;
    readAlias();
  }
  pendingCookies = await pendingCookies;
};
