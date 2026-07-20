// rule: zustand-no-mutating-state
// weakness: library-idiom
// source: Zustand Immer middleware documentation

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export const useFuzzStore = create(
  immer((set) => ({
    count: 0,
    increment: () => set((state) => void state.count++),
  })),
);
