import { create } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/shallow";
import { bearStore } from "./bear-store";

const useBearStore = create(() => ({ bears: [], label: "bears" }));

let selectBears = (state) => ({ bears: state.bears });
selectBears = (state) => state.bears;

function selectLabel(state) {
  return { label: state.label };
}
selectLabel = (state) => state.label;

const useBearSummary = (undefined = shallow) =>
  useStoreWithEqualityFn(bearStore, (state) => ({ bears: state.bears }), undefined);

export const BearSummary = () => {
  const bears = useBearStore(selectBears);
  const label = useBearStore(selectLabel);
  const prefix = useBearStore((state) => state.label.slice(0, 2));
  const decorated = useBearStore((state) => state.label.concat("!"));
  const summary = useBearSummary();
  return (
    <p>{bears.length + label.length + prefix.length + decorated.length + summary.bears.length}</p>
  );
};
