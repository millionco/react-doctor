// rule: rules-of-hooks
// weakness: import-provenance
// source: synthetic inherited route options accessor
// verdict: fail
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/counter")({
  __proto__: {
    get id() {
      this.component();
      return undefined;
    },
  },
  component: () => {
    const [count] = useState(0);
    return <output>{count}</output>;
  },
});
