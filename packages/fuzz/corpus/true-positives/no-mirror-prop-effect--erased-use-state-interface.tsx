// rule: no-mirror-prop-effect
// weakness: name-heuristic
// source: independent synthetic typed body array binding review
// verdict: fail

import { useEffect, useState } from "react";
interface useState {}
interface ArrayProps {
  data: string[];
}
export const Panel = (props: ArrayProps) => {
  const { data: sourceValue } = props;
  const [draft, setDraft] = useState(sourceValue);

  useEffect(() => {
    setDraft(sourceValue);
  }, [sourceValue]);
  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;
};
