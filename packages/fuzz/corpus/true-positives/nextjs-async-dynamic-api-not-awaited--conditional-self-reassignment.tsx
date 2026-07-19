// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const readSession = async (shouldAwait: boolean) => {
  let pendingCookies = cookies();
  pendingCookies = shouldAwait ? await pendingCookies : pendingCookies;
  return pendingCookies.get("session");
};
