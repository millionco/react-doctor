import { useEffect } from "react";

const handleResize = () => undefined;

export const ResizeStatus = () => {
  useEffect(() => {
    window.addEventListener("resize", handleResize, { capture: true });
    return () =>
      window.removeEventListener("resize", handleResize, {
        ["capture"]: false,
      });
  }, []);

  return null;
};
