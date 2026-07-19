// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

declare const getFallbackCookieStore: () => {
  get: (name: string) => string;
};

export const readSession = async () => {
  let pendingCookies = cookies();
  try {
    pendingCookies = await pendingCookies;
  } catch {
    pendingCookies = getFallbackCookieStore();
  }
  return pendingCookies.get("session");
};
