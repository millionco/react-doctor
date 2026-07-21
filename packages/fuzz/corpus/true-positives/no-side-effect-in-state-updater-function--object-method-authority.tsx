// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: 0.8.1 parity deep review
// verdict: fail

import { useState } from "react";

export const DirectAssignedHelper = () => {
  const [, setValue] = useState(0);
  const helpers = { run: () => {} };
  helpers.run = () => fetch("/track");
  setValue((value) => {
    helpers.run();
    return value;
  });
  return null;
};

export const AliasedAssignedHelper = () => {
  const [, setValue] = useState(0);
  const helpers = { run: () => {} };
  const alias = helpers;
  alias.run = () => fetch("/track");
  setValue((value) => {
    helpers.run();
    return value;
  });
  return null;
};
