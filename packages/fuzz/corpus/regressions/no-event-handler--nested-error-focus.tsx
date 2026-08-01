// rule: no-event-handler
// verdict: pass
// weakness: external-synchronization
// source: React Bench write-react-theduffman85-crowdse__yzTKQqw
import { useEffect, useRef, useState } from "react";

export const AddDialog = () => {
  const [errorInfo, setErrorInfo] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (errorInfo) {
      if (!isPending) {
        requestAnimationFrame(() => dismissRef.current?.focus());
      }
    }
  }, [errorInfo, isPending]);

  return (
    <button
      onClick={() => {
        setIsPending(false);
        setErrorInfo(new Error("failed"));
      }}
    >
      Add
    </button>
  );
};
