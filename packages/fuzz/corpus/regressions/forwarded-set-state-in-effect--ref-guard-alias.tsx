// rule: forwarded-set-state-in-effect
// weakness: control-flow
// source: a ref-controlled snapshot update retains the compiler allowance through local aliases
// verdict: pass
import { useEffect, useRef, useState } from "react";

const assign = <T,>(setter: (value: T) => void, value: T) => setter(value);

interface SnapshotProps {
  id: string;
}

export const Snapshot = ({ id }: SnapshotProps) => {
  const latestRef = useRef(id);
  const [value, setValue] = useState(id);
  useEffect(() => {
    const changed = latestRef.current !== id;
    if (!changed) return;
    assign(setValue, id);
  }, [id]);
  return <div>{value}</div>;
};
