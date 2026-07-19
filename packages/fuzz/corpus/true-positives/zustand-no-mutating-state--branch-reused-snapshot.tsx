// rule: zustand-no-mutating-state
// weakness: control-flow
// source: Laudiolin

import { create } from "zustand";

export const useFuzzStore = create((set, get) => ({
  items: [] as string[],
  add: (item: string, prepend: boolean) => {
    const { items } = get();
    if (prepend) {
      items.unshift(item);
    } else {
      items.push(item);
    }
    set({ items });
  },
}));
