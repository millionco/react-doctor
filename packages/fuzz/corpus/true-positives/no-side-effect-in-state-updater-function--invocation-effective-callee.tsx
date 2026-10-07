// rule: no-side-effect-in-state-updater-function
// weakness: control-flow
// source: 0.8.1 parity adversarial review
// verdict: fail

import { useState } from "react";

export const ReusedUpdaterWithChangingHelper = () => {
  const [, setValue] = useState(0);
  const helpers = { run: () => {} };
  const update = (value: number) => {
    helpers.run();
    return value;
  };

  setValue(update);
  helpers.run = () => trackEvent();
  setValue(update);
  return null;
};
