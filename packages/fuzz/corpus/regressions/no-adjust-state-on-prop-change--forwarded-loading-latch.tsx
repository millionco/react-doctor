// rule: no-adjust-state-on-prop-change
// weakness: wrapper-transparency
// source: related asynchronous completion forwarded through a transparent helper
// verdict: pass
import { useEffect, useState } from "react";

const assign = (setter, value) => setter(value);

export const Loading = ({ refreshKey }) => {
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    assign(setLoading, true);
    fetch("/refresh").then(() => assign(setLoading, false));
  }, [refreshKey]);
  return loading ? <p>Loading</p> : null;
};
