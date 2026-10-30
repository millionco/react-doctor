// rule: rerender-state-only-in-handlers
// weakness: control-flow
// source: synthetic
// verdict: pass
import { useState } from "react";

export const Panel = () => {
  const [connection, setConnection] = useState(null);
  const connect = () => {
    if (connection) connection.subscribe();
  };
  connect();
  return <button onClick={() => setConnection(createConnection())}>Connect</button>;
};
