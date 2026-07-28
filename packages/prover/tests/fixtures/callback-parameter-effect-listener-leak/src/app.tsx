import { useEffect } from "react";

const invokeCallback = (callback: () => void) => callback();

const handleResize = () => {};

export const App = () => {
  useEffect(() => {
    invokeCallback(() => window.addEventListener("resize", handleResize));
  }, []);

  return <p>Resize tracker</p>;
};
