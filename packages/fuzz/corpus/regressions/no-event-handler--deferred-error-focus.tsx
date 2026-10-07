// rule: no-event-handler
// verdict: pass
// weakness: external-synchronization
// source: React Bench write-react-theduffman85-crowdse__Dmxf8wU
import { useEffect, useRef, useState } from "react";

export const DeleteDialog = () => {
  const [deleteError, setDeleteError] = useState<Error | null>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (deleteError) {
      setTimeout(() => dismissRef.current?.focus(), 0);
    }
  }, [deleteError]);

  return (
    <form onSubmit={() => setDeleteError(new Error("failed"))}>
      {deleteError && <button ref={dismissRef}>Dismiss</button>}
    </form>
  );
};
