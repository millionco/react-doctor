// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const readSession = async () => {
  let pendingCookies = cookies();
  ({ pendingCookies } = { pendingCookies: await pendingCookies });
  return pendingCookies.get("session");
};

export const readMissingSession = async () => {
  let pendingCookies = cookies();
  ({ pendingCookies = await pendingCookies } = {});
  return pendingCookies.get("session");
};
