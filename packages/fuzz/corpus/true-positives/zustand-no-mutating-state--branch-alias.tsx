// rule: zustand-no-mutating-state
// weakness: control-flow
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { create } from "zustand";

export const useFuzzStore = create((set, get) => ({
  items: [] as string[],
  update: (enabled: boolean) => {
    if (enabled) {
      const items = get().items;
      items.push("next");
      set({ items });
    }
  },
}));
