// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 final audit

import { cookies } from "next/headers";
import { useMemo, useState } from "react";

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

export const readAfterSparseClear = () => {
  let cookieStore = cookies();
  Array(1).map(() => {
    cookieStore = { get: (name: string) => name };
  });
  return cookieStore.get("session");
};

export const readAfterNamedHookTaint = () => {
  let cookieStore = { get: (name: string) => name };
  useMemo(() => {
    cookieStore = cookies();
  }, []);
  useState(() => {
    cookieStore = cookies();
    return 0;
  });
  return cookieStore.get("session");
};

export const readAfterMutatedArrayTaint = () => {
  let cookieStore = { get: (name: string) => name };
  const values: number[] = [];
  values.push(0);
  values.map(() => {
    cookieStore = cookies();
  });
  return cookieStore.get("session");
};

export const readAfterCaughtUnknownCall = () => {
  let cookieStore = cookies();
  const clear = () => {
    mayThrow();
    cookieStore = { get: (name: string) => name };
  };
  try {
    clear();
  } catch {}
  return cookieStore.get("session");
};
