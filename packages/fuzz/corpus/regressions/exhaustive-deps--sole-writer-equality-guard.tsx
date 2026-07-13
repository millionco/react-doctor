// rule: exhaustive-deps
// weakness: effect-semantics
// source: ISSUES_TO_FIX_ASAP.md (state is only written by this equality-guarded effect)
import { useEffect, useState } from "react";

export const SoleWriterSnapshot = ({ source }: { source: string }) => {
  const [snapshot, setSnapshot] = useState(source);
  useEffect(() => {
    if (!Object.is(snapshot, source)) setSnapshot(source);
  }, [source]);
  return <output>{snapshot}</output>;
};
