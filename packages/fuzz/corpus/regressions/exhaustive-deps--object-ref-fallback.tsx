// rule: exhaustive-deps
// weakness: alias-guard
// source: Cursor Bugbot review on PR #1128 (2026-07-11)
import { useLayoutEffect, useRef } from "react";

export const EditorSurface = ({
  pendingMappingOperationsRef,
}: {
  pendingMappingOperationsRef: React.RefObject<string[]> | null;
}) => {
  const fallbackRefs = { operations: useRef<string[]>([]) };
  const pendingOperationsRef = pendingMappingOperationsRef ?? fallbackRefs.operations;

  useLayoutEffect(() => {
    pendingOperationsRef.current?.splice(0);
  }, [pendingMappingOperationsRef]);

  return null;
};
