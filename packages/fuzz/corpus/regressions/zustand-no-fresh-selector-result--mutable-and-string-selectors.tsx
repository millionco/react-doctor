import { create } from "zustand";

const useBearStore = create(() => ({ bears: [], label: "bears" }));

let selectBears = (state) => ({ bears: state.bears });
selectBears = (state) => state.bears;

export const BearSummary = () => {
  const bears = useBearStore(selectBears);
  const prefix = useBearStore((state) => state.label.slice(0, 2));
  const decorated = useBearStore((state) => state.label.concat("!"));
  return <p>{bears.length + prefix.length + decorated.length}</p>;
};
