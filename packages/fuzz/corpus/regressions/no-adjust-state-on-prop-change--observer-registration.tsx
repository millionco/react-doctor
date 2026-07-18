// rule: no-adjust-state-on-prop-change
// weakness: observer-registration-effect
// source: PR #1361 review

import { useEffect, useState } from "react";

export const Feed = ({ source }: { source: Element }) => {
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    setSelection(null);
    const observer = new ResizeObserver(() => setSelection("updated"));
    observer.observe(source);
  }, [source]);

  return <div>{selection}</div>;
};
