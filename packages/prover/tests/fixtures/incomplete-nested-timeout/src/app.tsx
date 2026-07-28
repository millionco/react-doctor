import { useEffect, useState } from "react";

export const NestedTimer = () => {
  const [status, setStatus] = useState("pending");

  useEffect(() => {
    const outerTimeoutId = window.setTimeout(() => {
      window.setTimeout(() => setStatus("ready"), 100);
    }, 100);
    return () => window.clearTimeout(outerTimeoutId);
  }, []);

  return <output>{status}</output>;
};
