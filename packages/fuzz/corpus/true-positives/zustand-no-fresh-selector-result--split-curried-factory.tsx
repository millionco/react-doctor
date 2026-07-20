// rule: zustand-no-fresh-selector-result
// weakness: library-idiom
// source: PR #1395 review finding

import { create } from "zustand";

interface BearState {
  bears: string[];
}

const makeBearStore = create<BearState>();
const useBearStore = makeBearStore(() => ({ bears: [] }));

export const BearNames = () => {
  const names = useBearStore((state) => state.bears.map((bear) => bear.toUpperCase()));
  return <span>{names.join(", ")}</span>;
};
