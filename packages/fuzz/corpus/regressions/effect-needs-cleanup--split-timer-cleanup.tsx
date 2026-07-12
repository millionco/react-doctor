// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: ISSUES_TO_FIX_ASAP.md ReactTooltip split cleanup
import { useEffect, useRef } from "react";

export const DeferredPreview = ({ value }: { value: string }) => {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => console.log(value), 300);
  }, [value]);
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );
  return null;
};
