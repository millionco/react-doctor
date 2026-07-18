// rule: nextjs-async-dynamic-api-not-awaited
// weakness: copy-tracking
// source: PR #1000 independent audit

import { cookies } from "next/headers";

export const readSession = () => {
  let pendingCookies;
  pendingCookies ??= cookies();
  return pendingCookies.get("session");
};
