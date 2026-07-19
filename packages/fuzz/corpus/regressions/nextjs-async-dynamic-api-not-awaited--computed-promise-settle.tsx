// rule: nextjs-async-dynamic-api-not-awaited
// weakness: library-idiom
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const readSession = () => {
  const pendingCookies = cookies();
  return pendingCookies["then"]((cookieStore) => cookieStore.get("session"));
};
