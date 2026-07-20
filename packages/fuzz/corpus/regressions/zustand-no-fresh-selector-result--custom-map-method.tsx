// rule: zustand-no-fresh-selector-result
// weakness: name-heuristic
// source: PR #1395 deep rule audit

import { create } from "zustand";

const stableValue = {};
const useStore = create(() => ({ index: { map: () => stableValue } }));

export const View = () => {
  const selectedValue = useStore((state) => state.index.map());
  return <span>{Object.keys(selectedValue).length}</span>;
};
