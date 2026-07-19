// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: PR #1000 final independent audit

import { useState } from "react";

export const ExternalCallResultReceiver = () => {
  const [, setValue] = useState(0);
  setValue((value) => {
    const box = { store: getStore() };
    box.store.setItem("value", value);
    return value + 1;
  });
  return null;
};
