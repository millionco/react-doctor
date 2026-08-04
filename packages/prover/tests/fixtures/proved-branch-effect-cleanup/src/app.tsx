import { useEffect } from "react";

const handleResize = () => undefined;

const getServerKey = (): string | Promise<string> | undefined => "local";

export const Application = () => {
  useEffect(() => {
    const result = getServerKey();
    window.addEventListener("resize", handleResize);
    const dispose = () => {
      window.removeEventListener("resize", handleResize);
    };
    if (!result) return dispose;
    if (result instanceof Promise) return dispose;
    return dispose;
  }, []);

  return null;
};
