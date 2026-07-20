// rule: zustand-no-mutating-state
// weakness: path-tracking
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { create } from "zustand";

export const useFuzzStore = create((set, get) => ({
  nested: { items: [] as string[] },
  update: () => {
    get().nested.items.push("next");
    set({ nested: { items: get().nested.items } });
  },
}));
