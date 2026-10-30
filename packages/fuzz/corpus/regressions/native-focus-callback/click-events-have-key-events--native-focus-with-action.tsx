// rule: click-events-have-key-events, no-static-element-interactions
// weakness: control-flow
// source: invented synthetic regression
// verdict: fail

import { useCallback } from "react";

interface ReedFieldProps {
  save: () => void;
}

export const ReedField = ({ save }: ReedFieldProps) => {
  const handlePointer = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!(event.target as Element).closest(".reed-token")) {
        document.getElementById("reed-search")?.focus();
        save();
      }
    },
    [save],
  );
  return <div onClick={handlePointer} />;
};
