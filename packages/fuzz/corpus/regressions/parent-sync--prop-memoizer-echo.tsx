// verdict: pass
// rule: no-pass-data-to-parent, no-pass-live-state-to-parent, no-prop-callback-in-effect
// weakness: prop-provenance
// source: React Bench MultiSelectField

import { useEffect, useRef, useState } from "react";

const useDeepCompareMemoize = <Value,>(value: Value): Value => {
  const valueRef = useRef(value);
  if (JSON.stringify(valueRef.current) !== JSON.stringify(value)) valueRef.current = value;
  return valueRef.current;
};

export const MultiSelectField = ({ values, onPendingChange }) => {
  const [preValues, setPreValues] = useState([]);
  const memoizedValues = useDeepCompareMemoize(values);
  const onPendingChangeRef = useRef(onPendingChange);

  useEffect(() => {
    onPendingChangeRef.current = onPendingChange;
  }, [onPendingChange]);

  useEffect(() => {
    setPreValues(memoizedValues);
    onPendingChangeRef.current?.(memoizedValues);
  }, [memoizedValues]);

  return preValues.length;
};
