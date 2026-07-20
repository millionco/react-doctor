import { create } from "zustand";

const useBearStore = create(() => ({ bears: 0, fish: 0 }));

export const BearCounter = () => {
  const { bears } = useBearStore();
  return <span>{bears}</span>;
};
