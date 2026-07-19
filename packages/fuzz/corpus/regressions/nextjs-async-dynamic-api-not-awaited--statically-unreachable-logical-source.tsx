// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const readSession = () => {
  const cookieStore = { get: (name: string) => name } || cookies();
  return cookieStore.get("session");
};

export const readCookieLabel = (suffix: string) => {
  const label = `cookie-${suffix}` || cookies();
  return label.length;
};
