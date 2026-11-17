// rule: no-direct-state-mutation
// verdict: pass
import { useState } from "react";

export const Choices = () => {
  const [entries, setEntries] = useState([{ checked: false }]);
  const change = function Change(position) {
    if (typeof position === "number") {
      Change("map");
      return;
    }
    const nextEntries = [...entries];
    nextEntries[position].checked = false;
    setEntries(nextEntries);
  };
  return entries.map((entry, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(entry.checked)}
    </button>
  ));
};
