// rule: no-pass-live-state-to-parent
// weakness: callback-provenance
// source: independently authored local loader regression
import { useCallback, useEffect, useState } from "react";
export const Panel = ({ initialValues }) => {
  const [key] = useState("default");
  const [values, setValues] = useState([]);
  const loadValues = useCallback(
    async (key) => {
      if (Object.keys(initialValues).length) return;
      const response = await fetch(`/items/${key}`);
      setValues(await response.json());
    },
    [initialValues],
  );
  useEffect(() => {
    loadValues(key);
  }, []);
  return <div>{values.length}</div>;
};
