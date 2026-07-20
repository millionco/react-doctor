// rule: zustand-no-fresh-selector-result
// weakness: library-idiom
// source: PR #1395 deep rule audit

import { create } from "zustand";

interface BearState {
  bears: number;
}

const makeBearStore = create<BearState>();
export const useBearStore = makeBearStore(() => ({ bears: 0 }));
