// rule: zustand-no-fresh-selector-result
// source: pmndrs/zustand#3507

import { create } from "zustand";

const useBearStore = create(() => ({ bears: 0 }));

export const BearCount = () => {
  const snapshot = useBearStore((state) => ({ bears: state.bears }));
  return <output>{snapshot.bears}</output>;
};
