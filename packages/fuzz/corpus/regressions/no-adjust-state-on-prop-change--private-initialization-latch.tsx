// rule: no-adjust-state-on-prop-change
// weakness: private-state-control
// source: independent synthetic regression
// verdict: pass
import * as React from "react";
export const usePrivateSetup = (revision: number) => {
  const [pending, setPending] = React.useState(true);
  React.useEffect(() => {
    if (pending) setPending(false);
  }, [revision]);
};
