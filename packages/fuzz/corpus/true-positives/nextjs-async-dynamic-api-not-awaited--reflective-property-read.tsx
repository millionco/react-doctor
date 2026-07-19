// rule: nextjs-async-dynamic-api-not-awaited
// weakness: library-idiom
// source: PR #1000 independent audit

import { cookies } from "next/headers";

export const readSession = () => {
  const pendingCookies = cookies();
  return [
    Reflect.get(pendingCookies, "get"),
    Reflect.getOwnPropertyDescriptor(pendingCookies, "get"),
    Reflect.has(pendingCookies, "get"),
  ];
};
