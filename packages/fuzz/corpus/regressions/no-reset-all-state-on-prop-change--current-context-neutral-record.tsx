// rule: no-reset-all-state-on-prop-change
// weakness: control-flow
// source: synthetic request-stamped record with neutral render projection
// verdict: pass
import { useEffect, useState } from "react";

export const JobStatus = ({ scopeId, load }) => {
  const currentScope = `scope:${scopeId}`;
  const [status, setStatus] = useState({ scope: currentScope, busy: false });
  useEffect(() => {
    setStatus({ scope: currentScope, busy: false });
  }, [currentScope]);
  const start = async () => {
    const snapshot = currentScope;
    setStatus((previous) => ({
      scope: snapshot,
      busy: true,
      message: previous.scope === snapshot ? previous.message : undefined,
    }));
    const result = await load();
    setStatus({ scope: snapshot, busy: false, message: result.message });
  };
  const visible = status.scope === currentScope ? status : { busy: false };
  return (
    <section>
      <button onClick={start}>Start</button>
      <span>{visible.busy ? "Busy" : "Ready"}</span>
      <p>{visible.message}</p>
    </section>
  );
};
