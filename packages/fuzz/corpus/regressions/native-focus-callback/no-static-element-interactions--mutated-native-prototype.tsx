// rule: click-events-have-key-events, no-static-element-interactions
// weakness: provenance
// source: invented synthetic regression
// verdict: fail

import { useCallback } from "react";

interface ReedFieldProps {
  save: () => void;
}

export const ReedField = ({ save }: ReedFieldProps) => {
  // oxlint-disable-next-line react/immutability -- intentional mutation regression
  HTMLInputElement.prototype.focus = save;
  const handlePointer = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!(event.target as Element).closest(".reed-token")) {
      document.getElementById("reed-search")?.focus();
    }
  }, []);
  return <div onClick={handlePointer} />;
};
