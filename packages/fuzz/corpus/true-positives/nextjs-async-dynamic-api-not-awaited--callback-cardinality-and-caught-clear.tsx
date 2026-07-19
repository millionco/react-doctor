// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 final audit

import { cookies } from "next/headers";

export const readAfterEmptyMap = () => {
  let cookieStore = cookies();
  [...[]].map(() => {
    cookieStore = { get: (name: string) => name };
  });
  return cookieStore.get("session");
};

export const readAfterSingleElementReduce = () => {
  let cookieStore = cookies();
  [0].reduce(() => {
    cookieStore = { get: (name: string) => name };
    return 0;
  });
  return cookieStore.get("session");
};

export const readAfterCaughtThrow = (condition: boolean) => {
  let cookieStore = { get: (name: string) => name };
  const update = () => {
    cookieStore = cookies();
    if (condition) throw new Error();
    cookieStore = { get: (name: string) => name };
  };
  try {
    update();
  } catch {}
  return cookieStore.get("session");
};
