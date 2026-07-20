// rule: zustand-no-mutating-state
// weakness: library-idiom
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { create } from "zustand";

export const useFuzzStore = create((set, get) => ({
  items: [] as string[],
  update: () => {
    const items = get().items;
    set({ items: (items.push("next"), [...items]) });
  },
}));
