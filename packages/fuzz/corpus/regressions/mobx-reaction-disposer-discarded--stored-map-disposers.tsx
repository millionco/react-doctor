// rule: mobx-reaction-disposer-discarded
// weakness: lifecycle
// source: PR #1402 local Daytona parity

import { reaction } from "mobx";

export const useReactions = (names: string[]) => {
  const disposers = names.map((name) =>
    reaction(
      () => store[name],
      (value) => persist(name, value),
    ),
  );

  return () => {
    for (const disposer of disposers) disposer();
  };
};
