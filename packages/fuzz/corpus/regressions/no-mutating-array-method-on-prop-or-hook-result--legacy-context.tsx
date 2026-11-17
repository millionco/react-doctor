// rule: no-mutating-array-method-on-prop-or-hook-result
// verdict: pass
// weakness: parameter-origin; source: synthetic
import { useMemo } from "react";

const Panel = ({ children }, { entries }) => {
  useMemo(() => {
    entries.splice(0, 1);
  }, []);
  return <section>{children}</section>;
};

Panel.contextTypes = { entries: Array };
