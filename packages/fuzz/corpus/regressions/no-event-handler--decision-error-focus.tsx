// rule: no-event-handler
// verdict: pass
// weakness: external-synchronization
// source: React Bench write-react-theduffman85-crowdse__rbzUMnz Decisions
import { useEffect, useRef, useState } from "react";

export const DecisionDialog = () => {
  const [errorInfo, setErrorInfo] = useState<Error | null>(null);
  const focusPendingRef = useRef(false);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (errorInfo && focusPendingRef.current) {
      focusPendingRef.current = false;
      requestAnimationFrame(() => dismissRef.current?.focus());
    }
  }, [errorInfo]);

  return (
    <button
      onClick={() => {
        focusPendingRef.current = true;
        setErrorInfo(new Error("failed"));
      }}
    >
      Delete
    </button>
  );
};
