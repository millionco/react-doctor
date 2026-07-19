// rule: no-side-effect-in-state-updater-function
// weakness: library-idiom
// source: PR #1000 final independent audit

import { useState } from "react";

export const GlobalFetch = () => {
  const [, setValue] = useState(0);
  setValue((value) => {
    fetch("/api/value");
    return value + 1;
  });
  return null;
};
