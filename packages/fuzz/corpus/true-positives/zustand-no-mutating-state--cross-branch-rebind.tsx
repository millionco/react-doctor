// rule: zustand-no-mutating-state
// weakness: control-flow
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { create } from "zustand";

export const useFuzzStore = create((set, get) => ({
  items: [] as string[],
  update: (shouldMutate: boolean) => {
    let items = get().items;
    if (shouldMutate) {
      items.push("next");
    } else {
      items = [...items];
    }
    set({ items });
  },
}));
