import { useEffect, useState } from "react";

export const MicrotaskStatus = () => {
  const [status, setStatus] = useState("pending");

  useEffect(() => {
    window.queueMicrotask(() => setStatus("ready"));
    return () => undefined;
  }, []);

  return <output>{status}</output>;
};
