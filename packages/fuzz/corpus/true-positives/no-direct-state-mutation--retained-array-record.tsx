// rule: no-direct-state-mutation
// verdict: fail
import { useState } from "react";

export const Choices = () => {
  const [entries, setEntries] = useState([{ checked: false }]);
  const change = (position) => {
    const nextEntries = [...entries];
    nextEntries[position].checked = true;
    setEntries(nextEntries);
  };
  return entries.map((entry, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(entry.checked)}
    </button>
  ));
};
