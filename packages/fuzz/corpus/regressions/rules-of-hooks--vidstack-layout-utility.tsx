// rule: rules-of-hooks
// weakness: library-idiom
// source: synthetic API-role regression
// verdict: pass
import { useEffect } from "react";
import { usePlyrLayoutClasses as useLayoutClasses } from "vidstack";

export const Panel = ({ element, context }) => {
  useEffect(() => {
    if (!element) return;
    return useLayoutClasses(element, context);
  }, [element, context]);
  return <section />;
};
