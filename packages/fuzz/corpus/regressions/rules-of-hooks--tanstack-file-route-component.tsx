// rule: rules-of-hooks
// weakness: library-idiom
// source: synthetic route component render role
// verdict: pass
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/counter")({
  component: () => {
    const [count] = useState(0);
    return <output>{count}</output>;
  },
});
