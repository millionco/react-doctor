// rule: prefer-use-effect-event
// verdict: fail
// weakness: provider-erasure
// source: synthetic
import type require = require("provider-types");
require("react").useCallback = () => () => undefined;
import { useCallback, useEffect } from "react";
export const Example = ({ active, value }) => {
  const leaf = useCallback(() => "ready", []);
  const callback = useCallback(() => leaf(), [leaf]);
  useEffect(() => {
    const timer = setTimeout(() => callback(), 0);
    return () => clearTimeout(timer);
  }, [callback, active]);
  return null;
};
