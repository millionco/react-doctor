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

export const readAfterEquivalentEmptyCallbacks = () => {
  let cookieStore = { get: (name: string) => name };
  const emptyValues: number[] = [];
  emptyValues.map(() => {
    cookieStore = cookies();
  });
  Array.of().map(() => {
    cookieStore = cookies();
  });
  Array.from([], () => {
    cookieStore = cookies();
  });
  return cookieStore.get("session");
};

export const readAfterEquivalentDenseClears = () => {
  let cookieStore = cookies();
  const values = [0];
  values.map(() => {
    cookieStore = { get: (name: string) => name };
  });
  Array.of(0).map(() => {
    cookieStore = { get: (name: string) => name };
  });
  Array.from([0], () => {
    cookieStore = { get: (name: string) => name };
  });
  return cookieStore.get("session");
};

export const readAfterNestedBranchClear = (first: boolean, second: boolean) => {
  let cookieStore = cookies();
  const clear = () => {
    if (first) {
      if (second) cookieStore = { get: (name: string) => name };
      else cookieStore = { get: (name: string) => name };
    } else cookieStore = { get: (name: string) => name };
  };
  clear();
  return cookieStore.get("session");
};

export const readAfterSingleCodePointCallbacks = () => {
  let cookieStore = { get: (name: string) => name };
  [..."💩"].reduce(() => {
    cookieStore = cookies();
    return "";
  });
  return cookieStore.get("session");
};

export const readAfterDeadMutation = () => {
  let cookieStore = cookies();
  const values = [0];
  if (false) values.pop();
  values.map(() => {
    cookieStore = { get: (name: string) => name };
  });
  return cookieStore.get("session");
};

export const readAfterKnownNoop = () => {
  let cookieStore = cookies();
  const noop = () => {};
  const clear = () => {
    noop();
    cookieStore = { get: (name: string) => name };
  };
  try {
    clear();
  } catch {}
  return cookieStore.get("session");
};

export const readAfterSparseLengthGrowth = () => {
  let cookieStore = { get: (name: string) => name };
  const values: number[] = [];
  values.length = 1;
  values.map(() => {
    cookieStore = cookies();
  });
  return cookieStore.get("session");
};
