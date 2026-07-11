// rule: exhaustive-deps
// weakness: alias-guard
// source: Cursor Bugbot review on PR #1128 (2026-07-11)
import { useLayoutEffect, useMemo } from "react";

export const EditorSurface = ({
  pendingMappingOperationsRef,
}: {
  pendingMappingOperationsRef: React.RefObject<string[]>;
}) => {
  const stableRefs = useMemo(() => ({ operations: null }), []);
  const pendingOperationsRef = stableRefs.operations ?? pendingMappingOperationsRef;

  useLayoutEffect(() => {
    pendingOperationsRef.current?.splice(0);
  }, [pendingMappingOperationsRef]);

  return null;
};
