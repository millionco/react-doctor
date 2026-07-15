// rule: no-chain-state-updates
// weakness: effect-hook-provenance
// source: nteract/semiotic AccessibleNavTree benchmark trial

import * as React from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export const NavigationTree = () => {
  const [activeId, setActiveId] = React.useState("");
  const [selectedId, setSelectedId] = React.useState("");
  const clearLater = () => setTimeout(() => setActiveId(""), 100);

  useIsomorphicLayoutEffect(() => {
    setSelectedId(activeId);
  }, [activeId]);

  return (
    <button onClick={() => setActiveId("next")} onBlur={clearLater}>
      {selectedId}
    </button>
  );
};
