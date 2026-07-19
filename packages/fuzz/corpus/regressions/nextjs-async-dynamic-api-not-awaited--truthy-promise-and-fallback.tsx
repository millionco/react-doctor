// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

const fallbackCookieStore = { get: (name: string) => name };

export const readSession = () => {
  const cookieStore = cookies() && fallbackCookieStore;
  return cookieStore.get("session");
};
