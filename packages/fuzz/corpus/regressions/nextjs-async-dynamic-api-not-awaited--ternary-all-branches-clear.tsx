// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const readSession = async (useRequestCookies: boolean) => {
  let pendingCookies = cookies();
  const selectedCookies = useRequestCookies
    ? (pendingCookies = await pendingCookies)
    : (pendingCookies = getFallbackCookieStore());
  return {
    selectedCookies,
    session: pendingCookies.get("session"),
  };
};
