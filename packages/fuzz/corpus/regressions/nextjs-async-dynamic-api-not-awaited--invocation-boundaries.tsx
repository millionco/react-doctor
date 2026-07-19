// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 exact-head audit

import { cookies } from "next/headers";

export const readAfterUnawaitedTaint = () => {
  let cookieStore = { get: (name: string) => name };
  const taint = async () => {
    await 0;
    cookieStore = cookies();
  };
  taint();
  return cookieStore.get("session");
};

export const readAfterNestedReplacement = () => {
  let cookieStore = { get: (name: string) => name };
  const update = () => {
    const taint = () => {
      cookieStore = cookies();
    };
    taint();
    cookieStore = { get: (name: string) => name };
  };
  update();
  return cookieStore.get("session");
};
