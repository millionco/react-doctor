import { useEffect, useState } from "react";

export const RequestCounter = () => {
  const [requestCount, setRequestCount] = useState(0);

  useEffect(() => {
    setRequestCount((previousCount) => previousCount + 1);
  }, []);

  return <output>{requestCount}</output>;
};
