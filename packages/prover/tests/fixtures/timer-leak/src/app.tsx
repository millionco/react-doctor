import { useEffect } from "react";

export const Poller = () => {
  useEffect(() => {
    setInterval(() => undefined, 1000);
  }, []);

  return <p>Polling</p>;
};
