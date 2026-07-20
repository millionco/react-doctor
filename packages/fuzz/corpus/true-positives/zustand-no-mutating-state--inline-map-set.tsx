// rule: zustand-no-mutating-state
// weakness: library-idiom
// source: PR #1410 deep rule audit

import { create } from "zustand";

export const useStore = create((set) => ({
  values: new Map<string, number>(),
  update: () =>
    set((state) => ({
      values: state.values.set("key", 1),
    })),
}));
