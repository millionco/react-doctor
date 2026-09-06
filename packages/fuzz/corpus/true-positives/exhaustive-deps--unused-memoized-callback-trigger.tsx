// rule: exhaustive-deps
// weakness: dependency-provenance
// source: handwritten native parity regression
// verdict: fail

import { useCallback, useEffect } from "react";

export const UnusedCallbackTrigger = ({ onSave }: { onSave: () => void }) => {
  const save = useCallback(() => onSave(), [onSave]);
  useEffect(() => {}, [save]);
  return null;
};
