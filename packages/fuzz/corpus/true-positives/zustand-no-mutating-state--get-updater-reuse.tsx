// rule: zustand-no-mutating-state
// weakness: snapshot-provenance
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { create } from "zustand";

export const useFuzzStore = create((set, get) => ({
  items: [] as string[],
  update: () =>
    set((state) => {
      state.items.push("next");
      return get();
    }),
}));
