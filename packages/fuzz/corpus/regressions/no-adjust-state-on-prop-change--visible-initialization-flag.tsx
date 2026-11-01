// rule: no-adjust-state-on-prop-change
// weakness: private-state-control
// source: independent synthetic regression
// verdict: fail
import * as React from "react";
export const useVisibleSetup = (revision: number) => {
  const [pending, setPending] = React.useState(true);
  React.useEffect(() => {
    if (pending) setPending(false);
  }, [revision]);
  return pending;
};
