// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: 0.8.1 parity deep review
// verdict: pass

import { useState } from "react";

export const ReassignedHelper = () => {
  const [, setValue] = useState(0);
  const helpers = { track: () => fetch("/stale") };
  helpers.track = () => {};
  setValue((value) => {
    helpers.track();
    return value;
  });
  return null;
};

export const StableEmptyCollection = () => {
  const [, setValue] = useState(0);
  const empty: number[] = [];
  setValue((value) => {
    empty.map(() => fetch("/unreachable"));
    return value;
  });
  return null;
};
