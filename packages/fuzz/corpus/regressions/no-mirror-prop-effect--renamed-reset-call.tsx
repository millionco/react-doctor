// rule: no-mirror-prop-effect
// verdict: pass
// weakness: dynamic-computed
// source: independently synthetic extra reset dependency
import { useState, useEffect } from "react";
export const EditableLabel = ({ label }: { label: string }) => {
  const [draft, replaceDraft] = useState(label);
  useEffect(() => {
    replaceDraft(label);
  }, [label, readResetVersion()]);
  return <output>{draft}</output>;
};
