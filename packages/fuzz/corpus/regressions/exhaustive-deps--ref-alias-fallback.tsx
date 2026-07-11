// rule: exhaustive-deps
// weakness: alias-guard
// source: RD-FP-016 task-perfection addendum (Softmaple, 2026-07-11)
import { useLayoutEffect, useRef } from "react";

export const EditorSurface = ({
  text,
  pendingMappingOperationsRef,
}: {
  text: string;
  pendingMappingOperationsRef: React.RefObject<string[]> | null;
}) => {
  const fallbackOperationsRef = useRef<string[]>([]);
  const pendingOperationsRef = pendingMappingOperationsRef ?? fallbackOperationsRef;

  useLayoutEffect(() => {
    pendingOperationsRef.current?.splice(0);
  }, [text, pendingMappingOperationsRef]);

  return null;
};
