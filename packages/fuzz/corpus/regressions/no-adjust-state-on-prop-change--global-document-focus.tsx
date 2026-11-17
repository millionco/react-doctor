// rule: no-adjust-state-on-prop-change
// verdict: safe
// weakness: alias-guard
// source: synthetic global document focus acknowledgment
import { useEffect, useState } from "react";
export const Field = ({ inputId }) => {
  const [needsFocus, setNeedsFocus] = useState(false);
  useEffect(() => {
    if (needsFocus) {
      global.document.getElementById(inputId)?.focus();
      setNeedsFocus(false);
    }
  }, [inputId, needsFocus]);
  return <button onClick={() => setNeedsFocus(true)}>Focus input</button>;
};
