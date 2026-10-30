// rule: click-events-have-key-events, no-static-element-interactions
// weakness: wrapper-transparency
// source: invented synthetic regression
// verdict: pass

import { useCallback } from "react";

export const ReedField = () => {
  const handlePointer = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!(event.target as Element).closest(".reed-token")) {
      const destination = document.getElementById("reed-search");
      destination?.focus();
    }
  }, []);
  return <div onClick={handlePointer} />;
};
