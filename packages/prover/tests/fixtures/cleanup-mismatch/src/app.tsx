import { useEffect } from "react";

export const ResizeStatus = () => {
  useEffect(() => {
    const handleResize = () => undefined;
    window.addEventListener("resize", handleResize, true);
    return () => window.removeEventListener("resize", handleResize, false);
  }, []);

  return <p>Ready</p>;
};
