// rule: no-mirror-prop-effect
// verdict: fail
// weakness: name-heuristic
// source: independently synthetic renamed native setter
import React, { useState } from "react";
export const EditableLabel = ({ label }: { label: string }) => {
  const [draft, replaceDraft] = useState(label);
  React.useEffect(() => {
    replaceDraft(label);
  }, [label]);
  return <button onClick={() => replaceDraft("edited")}>{draft}</button>;
};
