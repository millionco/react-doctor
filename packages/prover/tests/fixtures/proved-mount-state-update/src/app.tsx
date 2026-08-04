import { useEffect, useState } from "react";

export const Status = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  return <p>{ready ? "ready" : "starting"}</p>;
};
