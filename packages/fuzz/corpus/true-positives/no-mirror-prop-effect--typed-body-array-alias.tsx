// rule: no-mirror-prop-effect
// weakness: alias-guard
// source: synthetic typed array body-property boundary
// verdict: fail

import { useEffect, useState } from "react";
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
