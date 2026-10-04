// verdict: pass
// rule: no-pass-data-to-parent, no-prop-callback-in-effect
// weakness: prop-provenance
// source: React Bench MultiSelectField

import { useEffect, useEffectEvent, useMemo, useState } from "react";

export const SerializedValues = ({ values, onPendingChange }) => {
  const valuesKey = JSON.stringify(values);

  useEffect(() => {
    const parsedValues = JSON.parse(valuesKey);
    onPendingChange?.(parsedValues);
  }, [valuesKey, onPendingChange]);

  return null;
};

export const MemoizedValues = ({ values, onPendingChange }) => {
  const resolvedValues = useMemo(() => values ?? [], [values]);
  const reportPendingChange = useEffectEvent((nextValues) => {
    onPendingChange?.(nextValues);
  });

  useEffect(() => {
    reportPendingChange(resolvedValues);
  }, [resolvedValues]);

  return null;
};

export const OpenLifecycle = ({ values, onPendingChange, onSearch }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState(values);
  const [searchValue, setSearchValue] = useState("stale");

  useEffect(() => {
    if (!isOpen) return;
    setPendingValues(values);
    onPendingChange?.(values);
    setSearchValue("");
    onSearch?.("");
  }, [isOpen, values, onPendingChange, onSearch]);

  return (
    <button onClick={() => setIsOpen(true)}>
      Open {pendingValues.length + searchValue.length}
    </button>
  );
};
