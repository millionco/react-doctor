// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const readSession = async () => {
  let pendingCookies = cookies();
  try {
    pendingCookies = await pendingCookies;
  } catch {
    return null;
  }
  return pendingCookies.get("session");
};
