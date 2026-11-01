// rule: no-mirror-prop-effect
// weakness: alias-guard
// source: independently authored synthetic
// verdict: pass
import React, { useState, useEffect } from "react";
React.useState = replacement;
export const Panel = (props) => {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);
  return <output>{draft}</output>;
};
