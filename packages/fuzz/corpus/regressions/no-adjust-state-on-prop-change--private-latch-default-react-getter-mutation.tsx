// rule: no-adjust-state-on-prop-change
// verdict: fail
// weakness: alias-guard
// source: independent synthetic private initialization latch runtime binding and provider control
React.__defineGetter__("useState", () => replacement);
import React from "react";
interface LayoutInputs {
  revision: number;
  host: React.MutableRefObject<HTMLElement | null>;
}
export const useLayoutSetup = ({ revision, host }: LayoutInputs) => {
  const [needsSetup, setNeedsSetup] = React.useState(true);
  React.useEffect(() => {
    const element = host.current;
    if (element) {
      if (needsSetup) {
        element.style.minHeight = "12px";
        setNeedsSetup(false);
      }
      element.style.height = `${revision}px`;
    }
  }, [revision, host.current]);
};
