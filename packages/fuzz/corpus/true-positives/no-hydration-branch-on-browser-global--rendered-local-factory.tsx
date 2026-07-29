// rule: no-hydration-branch-on-browser-global
// weakness: provenance
// source: ReactBench hydration audit

import React from "react";

const renderer = {
  createElement: (value: string) => value,
};

export const Page = () =>
  React.createElement(
    "main",
    null,
    typeof window === "undefined"
      ? renderer.createElement("server")
      : renderer.createElement("client"),
  );
