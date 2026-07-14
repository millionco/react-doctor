// rule: rules-of-hooks
// weakness: control-flow
// source: alibaba-fusion/next d5582ba6e5a70978bd5b90cb77d9420a333df788
import { useEffect, useRef, useState } from "react";

export const VersionGuardedDialog = () => {
  if (!useState || !useRef || !useEffect) {
    return null;
  }

  const [isOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {}, []);
  return isOpen ? <div ref={dialogRef} /> : null;
};
