// rule: no-adjust-state-on-prop-change
// weakness: value-provenance
// source: handwritten native parity regression
// verdict: fail

import { useEffect, useState } from "react";

export const ResetPanel = ({ id }) => {
  const [{ sort }, setValue] = useState({ sort: [] });
  useEffect(() => {
    setValue({ sort: [] });
  }, [id]);
  return <div>{sort}</div>;
};
