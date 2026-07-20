// rule: zustand-no-mutating-state
// weakness: library-idiom
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { createStore } from "zustand/vanilla";

export const fuzzStore = createStore(() => ({ items: [] as string[] }));

fuzzStore.setState((state) => {
  state.items.push("next");
  return { items: state.items };
});
