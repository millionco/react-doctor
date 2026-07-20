// rule: zustand-no-fresh-selector-result
// weakness: library-idiom
// source: PR #1395 review finding

import { create } from "zustand";

const useInventoryStore = create(() => ({ counts: { apples: 1, pears: 2 } }));

export const Inventory = () => {
  const entries = useInventoryStore((state) =>
    Object.entries(state.counts).map(([name, count]) => `${name}: ${count}`),
  );
  return <span>{entries.join(", ")}</span>;
};
