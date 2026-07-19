// rule: zustand-no-whole-store-destructure
// weakness: cross-file
// source: rule implementation session 2026-07-18

import { useBearStore } from "./store";

export const BearCounter = () => {
  const { bears } = useBearStore();
  return <span>{bears}</span>;
};
