// rule: rerender-functional-setstate
// weakness: false-positive
// source: local RDE validation (PostHog SessionSummariesSettings)
import { useState } from "react";

export const SessionSummaryEditor = () => {
  const [editingIndex, setEditingIndex] = useState(0);

  const selectPreviousSummary = () => {
    if (editingIndex === 0) {
      setEditingIndex(-1);
    } else {
      setEditingIndex(editingIndex - 1);
    }
  };

  return <button onClick={selectPreviousSummary}>Previous</button>;
};
