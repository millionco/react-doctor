// rule: zustand-no-mutating-state
// weakness: name-heuristic
// source: PR #1410 deep rule audit

import { create } from "zustand";

const stableQueue = {};

export const useStore = create((set) => ({
  queue: { push: (_value: string) => stableQueue },
  update: () =>
    set((state) => {
      state.queue.push("value");
      return { queue: state.queue };
    }),
}));
