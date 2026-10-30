// rule: click-events-have-key-events, no-static-element-interactions
// weakness: copy-tracking
// source: invented synthetic regression
// verdict: fail

import { useCallback } from "react";

interface ReedFieldProps {
  save: () => void;
}

export const ReedField = ({ save }: ReedFieldProps) => {
  const selected = document.getElementById("reed-search");
  if (selected) selected.focus = save;
  const handlePointer = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!(event.target as Element).closest(".reed-token")) {
      document.getElementById("reed-search")?.focus();
    }
  }, []);
  return <div onClick={handlePointer} />;
};
