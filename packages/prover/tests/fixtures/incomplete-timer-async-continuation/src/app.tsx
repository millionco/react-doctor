import { useEffect, useState } from "react";

export const AsyncTimer = () => {
  const [status, setStatus] = useState("pending");

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      await Promise.resolve();
      setStatus("ready");
    }, 100);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return <output>{status}</output>;
};
