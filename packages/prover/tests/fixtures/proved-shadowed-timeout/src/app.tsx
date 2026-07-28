import { useEffect } from "react";

const setTimeout = (callback: () => void) => {
  callback();
  return 1;
};

export const ShadowedTimeout = () => {
  useEffect(() => {
    setTimeout(() => undefined);
  }, []);

  return <output>complete</output>;
};
