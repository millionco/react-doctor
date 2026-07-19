import { create } from "zustand";

export const useStore = create((set, get) => ({
  items: [] as string[],
  update: (isOuterEnabled: boolean, isInnerEnabled: boolean) => {
    const items = get().items;
    items.push("next");
    if (isOuterEnabled) {
      if (isInnerEnabled) set({ items: [...items] });
    } else {
      set({ items: items.slice() });
    }
  },
}));
