// rule: no-mirror-prop-effect
// weakness: alias-guard
// source: independent synthetic typed body array binding review
// verdict: fail

import { useEffect, useState } from "react";
interface ArrayProps {
  data: string[];
}
export const Panel = (props: ArrayProps) => {
  const { data } = props;
  const [draft, setDraft] = useState(data);

  useEffect(() => {
    setDraft(data);
  }, [data]);
  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;
};
