// rule: zustand-no-mutating-state
// weakness: copy-tracking
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { create } from "zustand";

export const useFuzzStore = create((set, get) => ({
  items: [] as string[],
  updateWithBinding: () => {
    const items = get().items;
    items.push("next");
    const nextItems = [...items];
    set({ items: nextItems });
  },
  updateInsideUpdater: () =>
    set(() => {
      const items = get().items;
      items.push("next");
      return { items: [...items] };
    }),
  updateInBranch: (enabled: boolean) => {
    const items = get().items;
    if (enabled) {
      items.push("next");
      set({ items: [...items] });
    }
  },
}));
