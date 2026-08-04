import { useState } from "react";

export const DeferredSelection = () => {
  const [selection, setSelection] = useState("none");
  const selectLater = () => {
    window.setTimeout(() => setSelection("blueberry"), 100);
  };

  return (
    <button type="button" onClick={selectLater}>
      {selection}
    </button>
  );
};
