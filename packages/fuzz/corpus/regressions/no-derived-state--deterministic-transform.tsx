// rule: no-derived-state
// weakness: value-provenance
// source: ISSUES_TO_FIX_ASAP.md cross-version transform matrix
import { useEffect, useState } from "react";

export const SortedPreview = ({ values }: { values: string[] }) => {
  const [sortedValues, setSortedValues] = useState<string[]>([]);
  useEffect(() => {
    setSortedValues(Array.from(values).toSorted());
  }, [values]);
  return <output>{sortedValues.join(", ")}</output>;
};
