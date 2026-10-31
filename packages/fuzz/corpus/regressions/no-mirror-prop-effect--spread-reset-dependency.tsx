// rule: no-mirror-prop-effect
// weakness: dynamic-computed
// source: independently authored synthetic
// verdict: pass
import React, { useState, useEffect } from "react";
export const Panel = (props) => {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => {
    setDraft(props.value);
  }, [props.value, ...resetVersions]);
  return <output>{draft}</output>;
};
