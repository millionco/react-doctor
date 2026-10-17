// rule: no-mirror-prop-effect
// weakness: alias-guard
// source: independently authored synthetic
// verdict: pass
import { useEffect, useState } from "react";
export const Panel = (props) => {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => {
    setDraft(props.value);
  }, [props, props.resetVersion]);
  return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>;
};
