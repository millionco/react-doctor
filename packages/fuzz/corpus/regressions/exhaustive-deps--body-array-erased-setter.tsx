// rule: exhaustive-deps
// weakness: name-heuristic
// source: independent synthetic typed body array binding review
// verdict: pass

import { useEffect, useState } from "react";
interface ArrayProps {
  data: string[];
}
export const Panel = (props: ArrayProps) => {
  const { data: sourceValue } = props;
  const [draft, setDraft] = useState(sourceValue);
  interface setDraft {}

  useEffect(() => {
    setDraft(sourceValue);
  }, [sourceValue]);
  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;
};
