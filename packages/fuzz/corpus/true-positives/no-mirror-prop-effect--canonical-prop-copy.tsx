// rule: no-mirror-prop-effect
// weakness: alias-guard
// source: independently authored synthetic
// verdict: fail
import { useEffect, useState } from "react";
export const Panel = ({ value }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>;
};
