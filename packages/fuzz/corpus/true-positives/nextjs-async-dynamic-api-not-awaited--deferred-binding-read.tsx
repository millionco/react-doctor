// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const makeSessionReader = () => {
  const pendingCookies = cookies();
  return () => pendingCookies.get("session");
};
