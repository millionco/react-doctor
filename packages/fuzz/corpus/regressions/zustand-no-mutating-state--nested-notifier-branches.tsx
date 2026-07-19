// rule: zustand-no-mutating-state
// weakness: control-flow
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { create } from "zustand";

export const useStore = create((set, get) => ({
  items: [] as string[],
  update: (isOuterEnabled: boolean, isInnerEnabled: boolean) => {
    if (isOuterEnabled) {
      const items = get().items;
      items.push("next");
      if (isInnerEnabled) {
        set({ items: [...items] });
      } else {
        set({ items: items.slice() });
      }
    }
  },
}));
