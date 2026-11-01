// rule: no-mirror-prop-effect
// weakness: alias-guard
// source: independently authored synthetic
// verdict: pass
import { useEffect, useState } from "react";
export const Panel = ({ value, reset }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value, reset.version]);
  return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>;
};
