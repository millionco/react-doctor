// rule: no-chain-state-updates
// weakness: control-flow
// source: Cursor Bugbot PR #1256

import { useEffect, useRef, useState } from "react";

export const LabeledBreakChain = ({ revision }: { revision: string }) => {
  const [selection, setSelection] = useState(0);
  const [label, setLabel] = useState("");
  const previousRevisionRef = useRef(revision);

  useEffect(() => {
    const revisionChanged = previousRevisionRef.current !== revision;
    previousRevisionRef.current = revision;

    snapshotGuard: {
      if (!revisionChanged) break snapshotGuard;
    }

    setLabel("selected");
  }, [revision, selection]);

  return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
};
