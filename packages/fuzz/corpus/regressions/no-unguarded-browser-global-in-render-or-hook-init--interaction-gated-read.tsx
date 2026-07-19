// rule: no-unguarded-browser-global-in-render-or-hook-init
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (hyperdx add-connection: JSX gated by a falsy-initial useState flag never evaluates during SSR)
import { useState } from "react";
import { ConnectionForm } from "./connection-form";

export function ConnectionsSection() {
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setIsCreatingConnection(true)}>
        Add Connection
      </button>
      {isCreatingConnection && <ConnectionForm host={window.location.origin} />}
    </div>
  );
}
