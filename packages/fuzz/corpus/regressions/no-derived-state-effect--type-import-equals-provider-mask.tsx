// rule: no-derived-state-effect
// verdict: fail
// weakness: provider-erasure
// source: synthetic
import type require = require("provider-types");
require("react").useRef = () => ({ current: 0 });
import { useEffect, useRef, useState, useCallback } from "react";
export const Example = ({ value, other, enabled }) => {
  const [count, writeCount] = useState(0);
  const current = useRef(count);
  useEffect(() => {
    writeCount(value);
    current.current = value;
  }, [value]);
  return <output>{count}</output>;
};
