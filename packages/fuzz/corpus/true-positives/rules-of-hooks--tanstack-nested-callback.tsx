// rule: rules-of-hooks
// weakness: nested-callback
// source: synthetic route component render role
// verdict: fail
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/counter")({
  component: () =>
    [0].map(() => {
      const [count] = useState(0);
      return <output>{count}</output>;
    }),
});
