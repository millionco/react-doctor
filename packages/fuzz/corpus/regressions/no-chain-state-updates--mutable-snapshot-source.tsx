// rule: no-chain-state-updates
// weakness: control-flow
// source: PR #1256 adversarial review

import { useEffect, useRef, useState } from "react";

export const MutableSnapshotSource = ({ config }: { config: { revision: string } }) => {
  const [selection, setSelection] = useState(0);
  const [label, setLabel] = useState("");
  const revision: string = config.revision;
  const previousRevisionRef = useRef(revision);

  useEffect(() => {
    const revisionChanged = previousRevisionRef.current !== revision;
    previousRevisionRef.current = revision;
    if (!revisionChanged) return;
    setLabel(revision);
  }, [revision, selection]);

  return (
    <button
      onClick={() => {
        config.revision = "next";
        setSelection((value) => value + 1);
      }}
    >
      {label}
    </button>
  );
};
