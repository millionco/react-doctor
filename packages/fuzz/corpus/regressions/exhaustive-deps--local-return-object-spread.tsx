// Rule: exhaustive-deps. Weakness: copy-tracking. Source: synthetic audit regression.
import { useMemo } from "react";

const createSelection = (value, enabled) => ({ value, enabled });

export const SelectionPanel = ({ value, enabled }) => {
  const selection = createSelection(value, enabled);
  return useMemo(() => ({ ...selection }), [selection.value, selection.enabled]);
};
