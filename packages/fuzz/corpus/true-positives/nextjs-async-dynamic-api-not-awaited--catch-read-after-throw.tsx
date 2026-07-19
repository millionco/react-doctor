// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

declare const getCookieStoreOrThrow: () => {
  get: (name: string) => string;
};

export const readSession = () => {
  let pendingCookies = cookies();
  try {
    pendingCookies = getCookieStoreOrThrow();
  } catch {
    return pendingCookies.get("session");
  }
  return null;
};
