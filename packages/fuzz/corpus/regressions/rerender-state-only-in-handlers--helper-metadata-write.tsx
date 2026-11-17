// rule: rerender-state-only-in-handlers
// weakness: alias-guard
// source: synthetic
// verdict: pass
import { useState } from "react";

export const StatusPanel = () => {
  const [connection, setConnection] = useState(null);
  function connect() {
    connection?.subscribe();
  }
  connect.description = "ready";
  connect();
  return <button onClick={() => setConnection(createConnection())}>Connect</button>;
};
