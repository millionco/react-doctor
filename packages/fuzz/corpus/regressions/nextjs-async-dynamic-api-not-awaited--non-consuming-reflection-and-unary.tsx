// rule: nextjs-async-dynamic-api-not-awaited
// weakness: library-idiom
// source: PR #1393 Bugbot

import { cookies } from "next/headers";

export const inspectPendingCookies = () => {
  const pendingCookies = cookies();
  return [
    Reflect.getOwnPropertyDescriptor(pendingCookies, "then"),
    Reflect.has(pendingCookies, "catch"),
    Object.getOwnPropertyDescriptor(pendingCookies, "finally"),
    !pendingCookies,
    typeof pendingCookies,
  ];
};
