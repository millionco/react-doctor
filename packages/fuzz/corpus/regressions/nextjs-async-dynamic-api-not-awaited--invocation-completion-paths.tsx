// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 final audit

import { cookies } from "next/headers";

export const readAfterBranchClear = (condition: boolean) => {
  let cookieStore = cookies();
  const clear = () => {
    if (condition) cookieStore = { get: (name: string) => name };
    else cookieStore = { get: (name: string) => name };
  };
  clear();
  return cookieStore.get("session");
};

export const readAfterCaughtClear = (condition: boolean) => {
  let cookieStore = { get: (name: string) => name };
  const update = () => {
    cookieStore = cookies();
    if (condition) throw new Error();
    cookieStore = { get: (name: string) => name };
  };
  try {
    update();
  } catch {
    cookieStore = { get: (name: string) => name };
  }
  return cookieStore.get("session");
};

export const readAfterStaticLoopAwait = () => {
  let cookieStore = cookies();
  const clear = async () => {
    while (false) await 0;
    cookieStore = { get: (name: string) => name };
  };
  clear();
  return cookieStore.get("session");
};

export const readAfterEmptyCallbacks = () => {
  let cookieStore = { get: (name: string) => name };
  [...[]].map(() => {
    cookieStore = cookies();
  });
  [0].reduce(() => {
    cookieStore = cookies();
    return 0;
  });
  [0].sort(() => {
    cookieStore = cookies();
    return 0;
  });
  return cookieStore.get("session");
};
