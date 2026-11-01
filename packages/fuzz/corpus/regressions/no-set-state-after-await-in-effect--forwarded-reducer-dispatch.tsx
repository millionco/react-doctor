// rule: no-set-state-after-await-in-effect
// weakness: forwarded-setter
// source: reducer dispatch forwarded through a transparent setter helper inside a microtask
// verdict: fail
import { useEffect, useReducer } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

interface SelectionAction {
  type: "clear" | "select";
}

const selectionReducer = (count: number, action: SelectionAction) =>
  action.type === "clear" ? 0 : count + 1;

export const SelectionCounter = ({ selectedIds }: { selectedIds: string[] }) => {
  const [selectedCount, dispatch] = useReducer(selectionReducer, 0);

  useEffect(() => {
    if (selectedIds.length === 0) {
      queueMicrotask(() => assign(dispatch, { type: "clear" }));
    }
  }, [selectedIds]);

  return <output>{selectedCount}</output>;
};
