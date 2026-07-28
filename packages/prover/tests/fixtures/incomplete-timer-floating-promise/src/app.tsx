import { useEffect, useState } from "react";

export const FloatingPromiseTimer = () => {
  const [status, setStatus] = useState("pending");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetch("/status").then(() => setStatus("ready"));
    }, 100);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return <output>{status}</output>;
};
