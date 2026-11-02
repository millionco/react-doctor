// rule: no-set-state-after-await-in-effect
// verdict: pass
// file-path: src/native-interval-react-setter-mutation.tsx
// weakness: alias-guard
// source: independent synthetic native interval provider mutation regression
import React from "react";
React.__defineSetter__("useState", () => {});
export const Panel = ({ revision, load }) => {
  const [value, setValue] = React.useState("");
  React.useEffect(() => {
    const interval = setInterval(async () => {
      const first = await load(revision);
      setValue(first);
    }, 5000);
    return () => clearInterval(interval);
  }, [revision]);
  return <output data-value={value} />;
};
