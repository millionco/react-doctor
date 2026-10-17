// rule: no-mirror-prop-effect
// verdict: pass
// weakness: provider-erasure
// source: synthetic
namespace require {}
require("react").useState = () => [0, () => {}];
import React, { useState, useEffect, useLayoutEffect } from "react";
export const Panel = ({ value, reset }) => {
  const [draft, writeDraft] = useState(value);
  useEffect(() => {
    writeDraft(value);
  }, [value]);
  return <output>{draft}</output>;
};
