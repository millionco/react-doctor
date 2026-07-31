// rule: no-hydration-branch-on-browser-global
// weakness: dataflow
// source: ReactBench hydration audit

import { useState } from "react";

export const useMetadata = () => {
  const [runtime] = useState(typeof window === "undefined" ? "server" : "client");
  return { runtime };
};
