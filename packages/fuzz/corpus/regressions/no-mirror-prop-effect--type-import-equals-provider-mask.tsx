// rule: no-mirror-prop-effect
// verdict: pass
// weakness: provider-erasure
// source: synthetic
import type require = require("provider-types");
require("react").useState = () => [0, () => {}];
import { useState, useEffect } from "react";
export const Panel = ({ model }) => {
  const [draft, setDraft] = useState(model.value);
  useEffect(() => {
    setDraft(model.value);
  }, [model.value]);
  return <output>{draft}</output>;
};
