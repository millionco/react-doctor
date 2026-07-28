import { useEffect, useState } from "react";

export const DelayedStatus = () => {
  const [status, setStatus] = useState("pending");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setStatus("ready"), 100);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return <output>{status}</output>;
};
