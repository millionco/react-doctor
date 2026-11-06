// rule: no-adjust-state-on-prop-change
// weakness: control-flow
// source: applied-compute Fix React verifier audit, the boundary kept by the read-only cleanup fix
// verdict: pass
import { useEffect, useState } from "react";

export const ConnectionStatus = ({ connection }: { connection: { state: string } }) => {
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    setStatus(null);
    return () => {
      connection.state;
    };
  }, [connection]);
  return <p>{status}</p>;
};
