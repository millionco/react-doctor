// rule: zustand-no-mutating-state
// weakness: copy-tracking
// source: Zustand issue #244

import { create } from "zustand";

export const useFuzzStore = create((set) => ({
  items: [] as string[],
  add: (item: string) =>
    set((state) => {
      state.items.push(item);
      return { items: state.items };
    }),
}));
