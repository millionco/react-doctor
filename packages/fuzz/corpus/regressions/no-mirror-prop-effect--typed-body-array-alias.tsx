// rule: no-mirror-prop-effect
// weakness: alias-guard
// source: synthetic typed array body-property boundary
// verdict: pass

import { useEffect, useState } from "react";
interface ArrayProps {
  data: string[];
  resetNonce: number;
}
export const Panel = (props: ArrayProps) => {
  const { data: sourceValue, resetNonce } = props;
  const [draft, setDraft] = useState(sourceValue);

  useEffect(() => {
    setDraft(sourceValue);
  }, [sourceValue, resetNonce]);
  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;
};
