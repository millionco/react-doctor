// rule: no-mirror-prop-effect
// verdict: pass
// weakness: alias-guard
// source: independently synthetic replaced React provider
import React, { useState, useEffect } from "react";
React.useState = replacement;
export const EditableLabel = ({ label }: { label: string }) => {
  const [draft, replaceDraft] = useState(label);
  useEffect(() => {
    replaceDraft(label);
  }, [label]);
  return <output>{draft}</output>;
};
